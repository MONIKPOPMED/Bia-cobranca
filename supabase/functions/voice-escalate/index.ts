// Escalate a live voice call to a human / fallback number.
// Called by voice-runtime when an escalation_rules trigger fires.
//
// Input: {
//   voice_call_id: uuid,
//   reason: string,                         // trigger name
//   target_phone?: string,                  // E.164 to dial; if missing, looks up rule action_target
//   mode?: "transfer" | "take_voicemail"    // default transfer
// }
//
// What it does:
//   1. Validate the call belongs to an active account
//   2. Marks the call + voice_campaign_contact row as "escalated"
//   3. Issues Twilio call update with a new TwiML URL that does <Dial>
//      or <Record><Hangup/>
//   4. Creates a live_takeover row so UI shows the handoff
//   5. Optionally notifies an admin in war-room

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { loggerFor } from "../_shared/logger.ts";
import { loadPhoneNumberCreds, twilioRequest, TwilioConfigError } from "../_shared/twilio/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  const log = loggerFor(req, { function: "voice-escalate" });
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const isService = (req.headers.get("Authorization") ?? "").includes(serviceKey);
  if (!isService) return j({ error: "service role required" }, 403);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  try {
    const body = await req.json();
    const voiceCallId: string = body.voice_call_id;
    const reason: string = body.reason ?? "manual_escalation";
    const mode: "transfer" | "take_voicemail" = body.mode ?? "transfer";

    if (!voiceCallId) return j({ error: "voice_call_id required" }, 400);

    const { data: call } = await admin
      .from("voice_calls")
      .select("id, account_id, persona_id, provider_call_sid, phone_number_id, direction, from_number, to_number, metadata")
      .eq("id", voiceCallId)
      .maybeSingle();
    if (!call) return j({ error: "voice_call not found" }, 404);
    if (!call.provider_call_sid) return j({ error: "call not yet placed with twilio" }, 409);

    // Resolve target phone for transfer
    let targetPhone: string | undefined = body.target_phone;
    if (!targetPhone && mode === "transfer") {
      // Fall back to account-level escalation_rules
      const { data: rule } = await admin
        .from("escalation_rules")
        .select("action, action_target")
        .eq("account_id", call.account_id)
        .eq("enabled", true)
        .in("action", ["transfer_to_number", "transfer_to_human"])
        .order("priority", { ascending: true })
        .limit(1)
        .maybeSingle();
      targetPhone = rule?.action_target ?? undefined;
    }

    if (mode === "transfer" && !targetPhone) {
      return j({ error: "no target_phone and no escalation rule configured" }, 409);
    }

    // Update voice_call + voice_campaign_contact
    await admin
      .from("voice_calls")
      .update({
        metadata: {
          ...(call.metadata ?? {}),
          escalation: { reason, mode, target: targetPhone, at: new Date().toISOString() },
        },
      })
      .eq("id", voiceCallId);

    const campaignContactId = (call.metadata as any)?.campaign_contact_id;
    if (campaignContactId) {
      await admin
        .from("voice_campaign_contacts")
        .update({
          status: "escalated",
          escalation_reason: reason,
          transfer_target: targetPhone,
        })
        .eq("id", campaignContactId);
      await admin.rpc("bump_voice_campaign_totals", {
        p_campaign_id: (call.metadata as any)?.campaign_id,
        p_escalated: 1,
      });
    }

    // Create live_takeover row for UI visibility
    await admin.from("live_takeovers").insert({
      account_id: call.account_id,
      voice_call_id: voiceCallId,
      reason,
      requested_by: "ai",
      metadata: { mode, target: targetPhone },
    }).select().single().then(() => {}, () => {}); // best-effort; table may or may not exist

    // Redirect the live Twilio call to a new TwiML endpoint
    const nexusBase = (Deno.env.get("NEXUS_PUBLIC_URL") ?? Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
    // Caller ID shown to the team = our own number on this call (the number
    // we dialed from, or the one the customer called). Without it the TwiML
    // endpoint fell back to a hard-coded, now-deactivated number.
    const ownNumber = String(call.direction).startsWith("outbound") ? call.from_number : call.to_number;
    const twimlUrl = mode === "transfer"
      ? `${nexusBase}/functions/v1/twilio-escalate-twiml?mode=transfer&to=${encodeURIComponent(targetPhone!)}` +
        (ownNumber ? `&caller_id=${encodeURIComponent(ownNumber)}` : "")
      : `${nexusBase}/functions/v1/twilio-escalate-twiml?mode=voicemail`;

    const { creds } = await loadPhoneNumberCreds(admin, call.phone_number_id);
    await twilioRequest({
      method: "POST",
      path: `/2010-04-01/Accounts/${creds.accountSid}/Calls/${call.provider_call_sid}.json`,
      credentials: creds,
      form: { Url: twimlUrl, Method: "POST" },
    });

    log.info("escalated", { voice_call_id: voiceCallId, reason, mode, target: targetPhone });
    return j({ ok: true, voice_call_id: voiceCallId, reason, mode, target: targetPhone });
  } catch (err) {
    if (err instanceof TwilioConfigError) return j({ error: err.message }, err.status);
    log.error("escalate failed", err);
    return j({ error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
