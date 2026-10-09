// deno-lint-ignore-file no-explicit-any
//
// voice-call-finalize
// -------------------
// Polls ElevenLabs Convai API for a finished conversation and persists
// transcript + audio + summary into our voice_calls table. Then triggers
// collection-extract-arrangement which creates a payment_arrangement when
// the agent closed a deal.
//
// Body: { voice_call_id: uuid, force?: boolean }
//
// Idempotent: if status='completed' and recording_storage_path is set and
// transcript already populated → returns early (unless force=true).
//
// This is the canonical post-call pipeline. The webhook elevenlabs-events
// is now a thin trigger that just calls this; cron also calls it for any
// stuck calls.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { resolveCredentialsForAccount } from "../_shared/elevenlabs/client.ts";
import { notifyTeam } from "../_shared/team-handoff.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "voice-recordings";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: { voice_call_id?: string; force?: boolean };
  try { body = await req.json(); } catch { return j({ error: "bad JSON" }, 400); }
  if (!body.voice_call_id) return j({ error: "voice_call_id required" }, 400);

  const force = body.force === true;

  const { data: call, error } = await admin
    .from("voice_calls")
    .select(
      "id, account_id, source_id, provider_call_sid, status, recording_storage_path, transcript, transcription_status, metadata, started_at, debt_id, direction, from_number, to_number",
    )
    .eq("id", body.voice_call_id)
    .maybeSingle();

  if (error || !call) return j({ error: "voice_call not found" }, 404);

  const conversationId = (call.source_id as string | null) ?? null;
  if (!conversationId) {
    return j({ error: "no source_id (EL conversation_id) — cannot finalize" }, 422);
  }

  const transcriptIsEmpty =
    !call.transcript ||
    (Array.isArray(call.transcript) && (call.transcript as any[]).length === 0);

  // Idempotência
  if (
    !force &&
    call.status === "completed" &&
    call.recording_storage_path &&
    !transcriptIsEmpty
  ) {
    return j({ ok: true, skipped: true, reason: "already finalized" });
  }

  // ── Resolve EL key da account ────────────────────────────────
  let elKey: string;
  try {
    const creds = await resolveCredentialsForAccount(admin, call.account_id);
    elKey = creds.apiKey;
  } catch (err) {
    console.error("[voice-call-finalize] resolveCredentialsForAccount failed", err);
    return j({ error: "ElevenLabs key not configured for account" }, 503);
  }

  // ── 1. Pull conversation metadata + transcript ──────────────
  let convData: any = null;
  try {
    const r = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(conversationId)}`,
      { headers: { "xi-api-key": elKey } },
    );
    if (r.status === 404) {
      // Conversa pode ainda não ter terminado
      return j({ ok: false, reason: "conversation not found in EL yet", retry_later: true }, 202);
    }
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      console.error("[voice-call-finalize] EL convo fetch failed", r.status, t.slice(0, 300));
      return j({ error: `EL fetch failed: ${r.status}` }, 502);
    }
    convData = await r.json();
  } catch (err) {
    console.error("[voice-call-finalize] EL convo fetch exception", err);
    return j({ error: "EL fetch exception" }, 502);
  }

  // EL response shape (resumo):
  // {
  //   conversation_id, agent_id, status: 'in-progress'|'processing'|'done'|'failed',
  //   transcript: [{ role, message, time_in_call_secs, ... }],
  //   metadata: { call_duration_secs, start_time_unix_secs, ... },
  //   analysis: { transcript_summary, call_successful, ... },
  // }
  const elStatus = (convData.status ?? "").toString().toLowerCase();
  const transcriptArr: any[] = Array.isArray(convData.transcript) ? convData.transcript : [];
  const summary: string | null =
    convData.analysis?.transcript_summary ??
    convData.transcript_summary ??
    convData.metadata?.summary ??
    null;
  const durationSec: number | null =
    convData.metadata?.call_duration_secs ??
    convData.duration_seconds ??
    null;

  // Se EL ainda está processando: marca como completed com o que temos
  // mas marca pra o cron tentar de novo.
  const stillProcessing = elStatus === "in-progress" || elStatus === "processing";
  if (stillProcessing && transcriptArr.length === 0) {
    await admin
      .from("voice_calls")
      .update({
        metadata: { ...(call.metadata as any), el_status: elStatus, last_finalize_attempt: new Date().toISOString() },
      })
      .eq("id", call.id);
    return j({ ok: false, reason: "EL still processing", retry_later: true, el_status: elStatus }, 202);
  }

  // ── 2. Pull audio (best-effort) ──────────────────────────────
  let recordingStoragePath: string | null = call.recording_storage_path ?? null;
  let recordingSignedUrl: string | null = null;

  if (!recordingStoragePath) {
    try {
      const ar = await fetch(
        `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(conversationId)}/audio`,
        { headers: { "xi-api-key": elKey } },
      );
      if (ar.ok) {
        const blob = await ar.blob();
        const ym = new Date().toISOString().slice(0, 7);
        const path = `${call.account_id}/${ym}/${call.id}.mp3`;
        const { error: upErr } = await admin.storage
          .from(BUCKET)
          .upload(path, blob, {
            contentType: ar.headers.get("content-type") ?? "audio/mpeg",
            upsert: true,
            cacheControl: "3600",
          });
        if (upErr) {
          console.warn("[voice-call-finalize] upload failed", upErr);
        } else {
          recordingStoragePath = `${BUCKET}/${path}`;
          const { data: signed } = await admin.storage
            .from(BUCKET)
            .createSignedUrl(path, 60 * 60 * 24 * 7);
          recordingSignedUrl = signed?.signedUrl ?? null;
        }
      } else {
        console.warn("[voice-call-finalize] audio fetch", ar.status);
      }
    } catch (err) {
      console.warn("[voice-call-finalize] audio fetch exception", err);
    }
  }

  // ── 3. Update voice_calls ────────────────────────────────────
  const updates: Record<string, any> = {
    status: "completed",
    metadata: {
      ...(call.metadata as any),
      summary,
      el_status: elStatus,
      // Why EL ended the conversation (e.g. missing dynamic variable,
      // client disconnected) — the only clue when a call drops in seconds.
      el_termination_reason: convData.metadata?.termination_reason ?? null,
      el_error: convData.metadata?.error ?? null,
      finalized_at: new Date().toISOString(),
    },
  };
  if (transcriptArr.length > 0) updates.transcript = transcriptArr;
  if (durationSec) updates.duration_seconds = durationSec;
  if (recordingStoragePath) {
    updates.recording_storage_path = recordingStoragePath;
    updates.transcription_status = "done";
    updates.transcription_provider = "elevenlabs";
    updates.transcription_completed_at = new Date().toISOString();
  }
  if (recordingSignedUrl) updates.recording_url = recordingSignedUrl;

  const { error: updErr } = await admin
    .from("voice_calls")
    .update(updates)
    .eq("id", call.id);
  if (updErr) {
    console.error("[voice-call-finalize] update voice_calls failed", updErr);
    return j({ error: "db update failed" }, 500);
  }

  // ── 3b. Safety net for the team handoff ─────────────────────
  // 09/10 campaign test: the agent said "vou passar seu caso para alguém da
  // nossa equipe…" but never called passar_para_equipe, so the team was not
  // told. If the transcript shows the handoff and the tool didn't record one,
  // notify the team here.
  if (!(call.metadata as any)?.handoff) {
    const agentSaid = transcriptArr
      .filter((t: any) => (t.role ?? t.speaker) === "agent")
      .map((t: any) => String(t.message ?? t.text ?? ""))
      .join(" ");
    if (/passar (o |seu )?(caso|atendimento) para algu[eé]m da (nossa )?equipe/i.test(agentSaid)) {
      const lastMessages = transcriptArr
        .filter((t: any) => String(t.message ?? "").trim() && String(t.message).trim() !== "...")
        .slice(-6)
        .map((t: any) => `${(t.role ?? t.speaker) === "agent" ? "Bia" : "Cliente"}: ${String(t.message).trim().slice(0, 300)}`);
      const customerPhone = String(call.direction ?? "").startsWith("outbound") ? call.to_number : call.from_number;
      let notified = false;
      try {
        notified = await notifyTeam(admin, {
          accountId: call.account_id,
          origin: "Ligação",
          customerPhone: customerPhone ?? "",
          contactId: (call.metadata as any)?.contact_id ?? null,
          reason: "A Bia passou o caso para a equipe nesta ligação (detectado na transcrição).",
          lastMessages,
        });
      } catch (err) {
        console.error("[voice-call-finalize] handoff safety net failed", err);
      }
      await admin
        .from("voice_calls")
        .update({ metadata: { ...updates.metadata, handoff: { via: "transcricao", team_notified: notified, at: new Date().toISOString() } } })
        .eq("id", call.id);
      console.log(`[voice-call-finalize] handoff safety net call=${call.id} team_notified=${notified}`);
    }
  }

  // ── 4. Extract arrangement (chama a outra fn) ────────────────
  const transcriptText = transcriptArr
    .map((t: any) => {
      const role = t.role ?? t.speaker ?? "";
      const content = t.message ?? t.text ?? t.content ?? "";
      return `${role}: ${content}`;
    })
    .filter(Boolean)
    .join("\n");

  let extractResult: any = null;
  try {
    const baseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const r = await fetch(`${baseUrl}/functions/v1/collection-extract-arrangement`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        voice_call_id: call.id,
        transcript: transcriptText,
        summary,
      }),
    });
    extractResult = await r.json().catch(() => ({}));
  } catch (err) {
    console.warn("[voice-call-finalize] extract failed", err);
  }

  console.log(
    `[voice-call-finalize] call=${call.id} convo=${conversationId} transcript=${transcriptArr.length}msgs audio=${recordingStoragePath ? "ok" : "—"} arr=${extractResult?.arrangement_id ?? "—"} outcome=${extractResult?.outcome ?? "—"}`,
  );

  return j({
    ok: true,
    voice_call_id: call.id,
    transcript_messages: transcriptArr.length,
    duration_seconds: durationSec,
    recording_storage_path: recordingStoragePath,
    summary,
    extract: extractResult,
  });
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
