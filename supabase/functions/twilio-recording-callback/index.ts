// Twilio RecordingStatusCallback — fires when a call recording is available.
// Payload (form-encoded): RecordingSid, RecordingUrl, RecordingDuration,
// RecordingStatus (in-progress|completed|failed), CallSid, AccountSid.
//
// We download the MP3 rendition into our `voice-recordings` bucket, patch
// the voice_calls row with `recording_storage_path` + mark transcription
// Recording is persisted for playback. Transcription is optional and is not
// triggered unless a transcription provider is explicitly enabled later.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import {
  getPublicUrl,
  isWebhookVerificationDisabled,
  validateTwilioSignatureAny,
} from "../_shared/webhook-security.ts";
import {
  loadPhoneNumberCreds,
  recordings as twilioRecordings,
  TwilioConfigError,
} from "../_shared/twilio/index.ts";
import { resolveWebhookAuthTokens } from "../_shared/twilio/config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("ok", { headers: corsHeaders });

  try {
    const formData = await req.formData();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    if (!isWebhookVerificationDisabled()) {
      const ok = await validateTwilioSignatureAny({
        urls: [
          getPublicUrl(req),
          `${supabaseUrl.replace(/\/$/, "")}/functions/v1/twilio-recording-callback`,
        ],
        authTokens: await resolveWebhookAuthTokens(admin, formData),
        form: formData,
        signature: req.headers.get("x-twilio-signature"),
      });
      if (!ok) return new Response("Forbidden", { status: 403, headers: corsHeaders });
    }

    const recordingSid = formData.get("RecordingSid")?.toString() ?? "";
    const callSid = formData.get("CallSid")?.toString() ?? "";
    const recordingStatus = formData.get("RecordingStatus")?.toString() ?? "";
    const duration = parseInt(formData.get("RecordingDuration")?.toString() ?? "0", 10);

    if (!recordingSid || !callSid) {
      return new Response("missing sids", { status: 400, headers: corsHeaders });
    }
    if (recordingStatus !== "completed") {
      return new Response("ok", { headers: corsHeaders });
    }

    // Find voice_calls row by call SID
    const { data: call } = await admin
      .from("voice_calls")
      .select("id, account_id, phone_number_id")
      .eq("provider_call_sid", callSid)
      .maybeSingle();
    if (!call) {
      console.warn("[twilio-recording-callback] no voice_calls for", callSid);
      return new Response("ok", { headers: corsHeaders });
    }

    // Resolve creds from the originating phone number
    let creds: any;
    try {
      const loaded = await loadPhoneNumberCreds(admin, call.phone_number_id);
      creds = loaded.creds;
    } catch (e) {
      if (e instanceof TwilioConfigError && e.status === 404) {
        console.warn("[twilio-recording-callback] phone_number missing for call", callSid);
        return new Response("ok", { headers: corsHeaders });
      }
      throw e;
    }

    const stored = await twilioRecordings.persistTwilioRecording({
      admin,
      credentials: creds,
      accountId: call.account_id,
      callSid,
      recordingSid,
    });

    const updates: Record<string, any> = {
      recording_sid: recordingSid,
      recording_duration_sec: duration || null,
    };
    if (stored) {
      updates.recording_storage_path = stored.storagePath;
      updates.recording_url = stored.signedUrl ?? null;
      updates.transcription_status = "idle";
    }

    await admin.from("voice_calls").update(updates).eq("id", call.id);

    return new Response("ok", { headers: corsHeaders });
  } catch (err) {
    console.error("[twilio-recording-callback] failed", err);
    return new Response("error", { status: 500, headers: corsHeaders });
  }
});
