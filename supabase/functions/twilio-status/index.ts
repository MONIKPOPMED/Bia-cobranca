// Webhook público chamado pelo Twilio em status callbacks
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  getPublicUrl,
  isWebhookVerificationDisabled,
  validateTwilioSignatureAny,
} from "../_shared/webhook-security.ts";
import { resolveWebhookAuthTokens } from "../_shared/twilio/config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

const STATUS_MAP: Record<string, string> = {
  queued: "queued",
  initiated: "queued",
  ringing: "ringing",
  "in-progress": "in_progress",
  completed: "completed",
  busy: "busy",
  failed: "failed",
  "no-answer": "no_answer",
  canceled: "canceled",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const formData = await req.formData();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    if (!isWebhookVerificationDisabled()) {
      const ok = await validateTwilioSignatureAny({
        urls: [getPublicUrl(req), `${supabaseUrl.replace(/\/$/, "")}/functions/v1/twilio-status`],
        authTokens: await resolveWebhookAuthTokens(supabase, formData),
        form: formData,
        signature: req.headers.get("x-twilio-signature"),
      });
      if (!ok) {
        return new Response("Forbidden", { status: 403, headers: corsHeaders });
      }
    }

    const callSid = formData.get("CallSid")?.toString() ?? "";
    const callStatus = formData.get("CallStatus")?.toString() ?? "";
    const duration = parseInt(formData.get("CallDuration")?.toString() ?? "0", 10);
    const recordingUrl = formData.get("RecordingUrl")?.toString();

    if (!callSid) {
      return new Response("missing CallSid", { status: 400, headers: corsHeaders });
    }

    const mapped = STATUS_MAP[callStatus] ?? "in_progress";
    const updates: Record<string, unknown> = { status: mapped };
    if (duration > 0) updates.duration_seconds = duration;
    if (recordingUrl) updates.recording_url = recordingUrl;
    if (mapped === "completed" || mapped === "failed" || mapped === "busy" || mapped === "no_answer" || mapped === "canceled") {
      updates.ended_at = new Date().toISOString();
    }

    // Why the carrier ended the call (e.g. SIP 603 = declined, 480 =
    // unavailable). Twilio sends it here and nowhere else; without it a
    // "no_answer" after 3s is impossible to tell apart from a real no-answer.
    const diag: Record<string, string> = {};
    for (const [field, key] of [
      ["SipResponseCode", "sip_response_code"],
      ["ErrorCode", "twilio_error_code"],
      ["ErrorMessage", "twilio_error_message"],
      ["AnsweredBy", "answered_by"],
    ] as const) {
      const v = formData.get(field)?.toString();
      if (v) diag[key] = v;
    }
    if (Object.keys(diag).length > 0) {
      const { data: current } = await supabase
        .from("voice_calls")
        .select("metadata")
        .eq("provider_call_sid", callSid)
        .maybeSingle();
      updates.metadata = {
        ...((current?.metadata as Record<string, unknown> | null) ?? {}),
        twilio_status: { ...diag, call_status: callStatus },
      };
    }

    const { data: updated, error } = await supabase
      .from("voice_calls")
      .update(updates)
      .eq("provider_call_sid", callSid)
      .select("id, source_id, recording_storage_path, transcription_status, metadata")
      .maybeSingle();

    if (error) console.error("[twilio-status] update error", error);

    // Quando a chamada termina (qualquer terminal status), dispara o
    // pipeline ElevenLabs — não espera o cron de 1min.
    // Fire-and-forget: não bloqueia a resposta ao Twilio.
    const isTerminal =
      mapped === "completed" || mapped === "no_answer" || mapped === "busy" || mapped === "canceled";
    // Campaign calls placed through Twilio (voice-campaign-dispatch →
    // dispatchViaTwilio) never had their contact row closed: it stayed
    // "placed" and the campaign stayed "running" forever (09/10 test).
    const campaignContactId = (updated?.metadata as any)?.campaign_contact_id;
    if (updated?.id && campaignContactId && (isTerminal || mapped === "failed")) {
      try {
        await closeCampaignContact(supabase, {
          contactRowId: campaignContactId,
          campaignId: (updated.metadata as any)?.campaign_id,
          answered: mapped === "completed",
          reason: mapped,
        });
      } catch (err) {
        console.error("[twilio-status] campaign contact update failed", err);
      }
    }

    if (updated?.id && isTerminal) {
      const baseUrl = supabaseUrl;
      const key = serviceKey;

      // Caminho ElevenLabs: tem source_id (conversation_id) → finalize busca
      // transcript + áudio na API da EL.
      if (updated.source_id) {
        fetch(`${baseUrl}/functions/v1/voice-call-finalize`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ voice_call_id: updated.id }),
        }).catch((err) => console.warn("[twilio-status] finalize trigger failed", err));
      }
      // Chamadas Twilio puras mantêm a gravação disponível, sem enviar áudio
      // ao Deepgram enquanto essa integração estiver desativada.
    }

    return new Response("ok", { headers: corsHeaders });
  } catch (e) {
    console.error("[twilio-status] error", e);
    return new Response("error", { status: 500, headers: corsHeaders });
  }
});

const IN_FLIGHT = ["queued", "placed", "ringing", "connected", "escalated"];

/**
 * Closes a campaign contact row when its call ends and completes the
 * campaign once nothing is left in flight (same rule as the dispatcher's
 * maybeCompleteCampaign). Idempotent: only rows still in flight move.
 */
async function closeCampaignContact(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  opts: { contactRowId: number | string; campaignId?: string; answered: boolean; reason: string },
) {
  const { data: closed } = await supabase
    .from("voice_campaign_contacts")
    .update({
      status: opts.answered ? "completed" : "failed",
      finished_at: new Date().toISOString(),
      ...(opts.answered ? {} : { last_error: `call ${opts.reason}` }),
    })
    .eq("id", opts.contactRowId)
    .in("status", IN_FLIGHT)
    .select("campaign_id")
    .maybeSingle();
  const campaignId = closed?.campaign_id ?? opts.campaignId;
  if (!closed || !campaignId) return;

  await supabase.rpc("bump_voice_campaign_totals", {
    p_campaign_id: campaignId,
    ...(opts.answered ? { p_connected: 1 } : { p_failed: 1 }),
  });

  const { count: pending } = await supabase
    .from("voice_campaign_contacts")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .in("status", IN_FLIGHT);
  if ((pending ?? 0) === 0) {
    await supabase
      .from("voice_campaigns")
      .update({ status: "completed", finished_at: new Date().toISOString() })
      .eq("id", campaignId)
      .eq("status", "running");
  }
}
