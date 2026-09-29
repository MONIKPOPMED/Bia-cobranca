// Post-call webhook from ElevenLabs.
//
// Esta função AGORA é apenas um trigger leve: quando recebe call_end /
// post_call_transcription do EL, ela apenas dispara `voice-call-finalize`
// que é a fonte canônica do pipeline pós-chamada (puxa transcript, áudio,
// extrai acordo, etc).
//
// Mesmo se este webhook não chegar, o pg_cron `voice-calls-finalize-pending-2m`
// vai processar a chamada igualmente — portanto este webhook é best-effort.
//
// verify_jwt = false.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ ok: false }, 405);

  const secret = Deno.env.get("ELEVENLABS_WEBHOOK_SECRET") ?? "";
  let payload: any;

  if (secret) {
    const sigHeader =
      req.headers.get("elevenlabs-signature") ??
      req.headers.get("ElevenLabs-Signature") ??
      req.headers.get("x-elevenlabs-signature") ??
      "";
    const rawBody = await req.text();
    const ok = await verifyElevenLabsSignature(rawBody, sigHeader, secret);
    if (!ok) {
      console.warn("[el-events] signature mismatch — ignoring");
      // Não bloqueia: cron pega depois. Só loga.
      return j({ ok: true, ignored: "bad signature" });
    }
    try { payload = JSON.parse(rawBody); }
    catch { return j({ ok: false, error: "invalid JSON" }, 400); }
  } else {
    try { payload = await req.json(); }
    catch { return j({ ok: false, error: "invalid JSON" }, 400); }
  }

  try { await handleEvent(payload); }
  catch (err) { console.error("[el-events] handler failed", err); }

  return j({ ok: true });
});

async function handleEvent(payload: any) {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const eventType = payload.type ?? payload.event_type ?? "";
  const callId = payload.call_id ?? payload.conversation_id ?? payload.data?.conversation_id;

  console.log(`[el-events] type=${eventType} callId=${callId}`);

  // Eventos finais que acionam a finalização
  if (
    eventType === "call_end" ||
    eventType === "post_call_transcription" ||
    eventType === "conversation_ended"
  ) {
    if (!callId) {
      console.warn("[el-events] no callId in payload");
      return;
    }

    let { data: call } = await admin
      .from("voice_calls")
      .select("id, source_id")
      .or(`source_id.eq.${callId},provider_call_sid.eq.${callId}`)
      .maybeSingle();

    // Calls connected via register-call (twilio-incoming) never store the EL
    // conversation_id; they pass our voice_calls.id and the Twilio CallSid as
    // dynamic variables, which EL echoes back in the webhook.
    if (!call) {
      const dyn = payload.data?.conversation_initiation_client_data?.dynamic_variables ?? {};
      const voiceCallId = dyn.call_id ?? dyn.voice_call_id;
      const callSid = dyn.call_sid ?? payload.data?.metadata?.phone_call?.call_sid;
      if (voiceCallId && /^[0-9a-f-]{36}$/i.test(String(voiceCallId))) {
        ({ data: call } = await admin
          .from("voice_calls").select("id, source_id").eq("id", voiceCallId).maybeSingle());
      }
      if (!call && callSid) {
        ({ data: call } = await admin
          .from("voice_calls").select("id, source_id").eq("provider_call_sid", String(callSid)).maybeSingle());
      }
    }

    if (!call) {
      console.warn(`[el-events] no voice_call for ${callId} — cron will retry later`);
      return;
    }

    // voice-call-finalize fetches transcript/audio by source_id.
    if (!call.source_id && payload.data?.conversation_id) {
      await admin
        .from("voice_calls")
        .update({ source_id: payload.data.conversation_id })
        .eq("id", call.id);
    }

    // Delega tudo pra voice-call-finalize
    const baseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    try {
      const r = await fetch(`${baseUrl}/functions/v1/voice-call-finalize`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ voice_call_id: call.id }),
      });
      const data = await r.json().catch(() => ({}));
      console.log(`[el-events] finalize call=${call.id} ok=${data?.ok} arr=${data?.extract?.arrangement_id ?? "—"}`);
    } catch (err) {
      console.error("[el-events] finalize invoke failed", err);
    }
  }
}

async function verifyElevenLabsSignature(
  body: string,
  header: string,
  secret: string,
): Promise<boolean> {
  const parts = header.split(",");
  const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2) ?? "";
  const sigHex = parts.find((p) => p.startsWith("v0="))?.slice(3) ?? "";
  if (!timestamp || !sigHex) return false;

  const payload = `${timestamp}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const computed = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return computed === sigHex.toLowerCase();
}

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
