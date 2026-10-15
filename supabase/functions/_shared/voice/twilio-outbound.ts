// Places an outbound call through our own Twilio account, answered by
// twilio-incoming (→ ElevenLabs register-call → Bia). Same Twilio parameters
// as voice-outbound (manual "Ligar" button), which is the path proven on the
// Verified-Caller-ID number (+5548996056774). Used by campaigns when the
// number is not imported into ElevenLabs.
import { loadPhoneNumberCreds, twilioRequest } from "../twilio/index.ts";

export async function placeTwilioOutboundCall(
  // deno-lint-ignore no-explicit-any
  admin: any,
  opts: { phoneNumberId: string; from: string; to: string; timeoutSeconds?: number; detectVoicemail?: boolean },
): Promise<{ callSid: string }> {
  const base = Deno.env.get("SUPABASE_URL")!.replace(/\/$/, "");
  const { creds } = await loadPhoneNumberCreds(admin, opts.phoneNumberId);
  // deno-lint-ignore no-explicit-any
  const data: any = await twilioRequest({
    method: "POST",
    path: `/2010-04-01/Accounts/${creds.accountSid}/Calls.json`,
    credentials: creds,
    form: {
      To: opts.to,
      From: opts.from,
      Url: `${base}/functions/v1/twilio-incoming`,
      // BR mobiles start ringing several seconds after Twilio dials.
      Timeout: String(opts.timeoutSeconds ?? 60),
      StatusCallback: `${base}/functions/v1/twilio-status`,
      // One StatusCallbackEvent parameter per event (a single spaced string
      // is rejected with warning 21626).
      StatusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      Record: "true",
      RecordingStatusCallback: `${base}/functions/v1/twilio-recording-callback`,
      RecordingStatusCallbackEvent: "completed",
      RecordingChannels: "dual",
      // Answering-machine detection, ASYNCHRONOUS: the Bia is connected as
      // soon as the call is answered and Twilio reports who answered later,
      // to twilio-status?amd=1. On voicemail twilio-status redirects the
      // live call to the short message + WhatsApp follow-up.
      // The synchronous mode (10/10) held the line silent for 5–10 s until
      // the person stopped talking — customers hung up (15/10 test).
      ...(opts.detectVoicemail
        ? {
          MachineDetection: "DetectMessageEnd",
          MachineDetectionTimeout: "30",
          AsyncAmd: "true",
          AsyncAmdStatusCallback: `${base}/functions/v1/twilio-status?amd=1`,
          AsyncAmdStatusCallbackMethod: "POST",
        }
        : {}),
    },
  });
  if (!data?.sid) throw new Error("Twilio did not return a call SID");
  return { callSid: data.sid };
}
