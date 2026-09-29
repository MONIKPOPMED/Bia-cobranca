// Webhook público chamado pelo Twilio quando uma chamada entra (ou sai
// como outbound-api). Retorna TwiML conforme inbound_behavior do número.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  getPublicUrl,
  isWebhookVerificationDisabled,
  validateTwilioSignatureAny,
} from "../_shared/webhook-security.ts";
import { resolveWebhookAuthTokens } from "../_shared/twilio/config.ts";
import { resolveCredentialsForAccount } from "../_shared/elevenlabs/client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

const VOICEMAIL_TWIML = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="pt-BR" voice="Polly.Camila">No momento não podemos atender. Deixe seu recado após o sinal.</Say>
  <Record maxLength="120" playBeep="true" />
  <Hangup/>
</Response>`;

const BUSY_TWIML = `<?xml version="1.0" encoding="UTF-8"?>
<Response><Say language="pt-BR" voice="Polly.Camila">Desculpe, todos os atendentes estão ocupados.</Say><Hangup/></Response>`;

// ── ElevenLabs helpers ────────────────────────────────────────────

async function resolveElAgentId(
  supabase: any,
  personaId: string | null,
): Promise<string | null> {
  if (!personaId) return null;
  const { data } = await supabase
    .from("agent_personas")
    .select("elevenlabs_agent_id")
    .eq("id", personaId)
    .maybeSingle();
  return (data?.elevenlabs_agent_id as string | null) ?? null;
}

async function buildElTwiML(
  supabase: any,
  accountId: string,
  elAgentId: string,
  from: string,
  to: string,
  direction: string,
  callId: string,
  callSid: string,
): Promise<string> {
  // The persona's EL agent lives in the workspace's ElevenLabs account (vault
  // key, same as elevenlabs-agent-sync) — the global env key may belong to a
  // different EL account or be unset, which made get_signed_url fail and
  // every AI call fall through to the voicemail prompt.
  let apiKey = "";
  try {
    apiKey = (await resolveCredentialsForAccount(supabase, accountId)).apiKey;
  } catch (err) {
    console.warn("[twilio-incoming] ElevenLabs key not configured for account", accountId, err);
    return VOICEMAIL_TWIML;
  }

  try {
    // EL's "Register Twilio calls" flow for calls on our own Twilio account:
    // POST /v1/convai/twilio/register-call returns the TwiML that connects
    // this call to the agent — we hand it to Twilio verbatim.
    // https://elevenlabs.io/docs/eleven-agents/phone-numbers/twilio-integration/register-call
    //
    // Pointing <Connect><Stream> straight at a get_signed_url WSS doesn't
    // work: that socket speaks EL's client protocol, not Twilio Media
    // Streams, so EL closed it and the call hung up ~1s after answer.
    //
    // Requires the agent's input/output audio format = ulaw_8000
    // (set by elevenlabs-agent-sync).
    const isOutbound = direction.startsWith("outbound");
    const registerRes = await fetch("https://api.elevenlabs.io/v1/convai/twilio/register-call", {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: elAgentId,
        from_number: from,
        to_number: to,
        direction: isOutbound ? "outbound" : "inbound",
        conversation_initiation_client_data: {
          dynamic_variables: {
            call_id: callId,
            call_sid: callSid,
            // The customer's number: who we dialed (outbound) or who called us.
            caller_id: isOutbound ? to : from,
          },
        },
      }),
    });
    // Documented as a string response: accept raw XML or a JSON-encoded string.
    let twiml = await registerRes.text().catch(() => "");
    if (twiml.trimStart().startsWith('"')) {
      try {
        twiml = JSON.parse(twiml);
      } catch {
        // leave as-is; the <Response check below rejects it
      }
    }
    if (!registerRes.ok || !twiml.includes("<Response")) {
      console.error(
        `[twilio-incoming] EL register-call failed ${registerRes.status}: ${twiml.slice(0, 300)}`,
      );
      return VOICEMAIL_TWIML;
    }

    console.log(
      `[twilio-incoming] EL register-call ok agent=${elAgentId} direction=${direction}`,
    );
    return twiml;
  } catch (err) {
    console.error("[twilio-incoming] EL buildTwiML exception", err);
    return VOICEMAIL_TWIML;
  }
}

// ── ConversationRelay fallback ─────────────────────────────────────

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case '"': return "&quot;";
      case "'": return "&apos;";
      default: return c;
    }
  });
}

function buildAiAnswerTwiML(
  callId: string,
  personaId: string | null,
  voiceId: string,
  welcomeGreeting: string,
) {
  // Twilio <ConversationRelay>: Twilio hosts STT (Deepgram) + TTS (ElevenLabs)
  // and forwards transcribed turns to our edge function over WebSocket.
  // See supabase/functions/twilio-conversation-relay/index.ts for the handler.
  //
  // welcomeGreeting is spoken immediately on call connect — required for
  // outbound because the customer picks up and won't speak first. For inbound
  // it works as the opening line.
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const wsHost = supabaseUrl.replace(/^https:\/\//, "");
  if (!wsHost) return VOICEMAIL_TWIML;

  const wsUrl = `wss://${wsHost}/functions/v1/twilio-conversation-relay?callId=${encodeURIComponent(callId)}`;
  const greet = escapeXml(welcomeGreeting);

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay
      url="${wsUrl}"
      welcomeGreeting="${greet}"
      ttsProvider="ElevenLabs"
      transcriptionProvider="Deepgram"
      voice="${voiceId}"
      language="pt-BR"
      ttsLanguage="pt-BR"
      transcriptionLanguage="pt-BR"
      speechModel="nova-3-general"
      interruptible="any"
      dtmfDetection="true">
      <Parameter name="callId" value="${callId}"/>
      ${personaId ? `<Parameter name="personaId" value="${personaId}"/>` : ""}
    </ConversationRelay>
  </Connect>
</Response>`;
}

// Default pt-BR voice when persona hasn't pinned one. Allow override via env.
const DEFAULT_VOICE_ID = () =>
  Deno.env.get("ELEVENLABS_DEFAULT_VOICE_ID") ?? "UgBBYS2sOqTuMpoF3BR0";

function buildForwardTwiML(forwardTo: string, callerId: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${escapeXml(callerId)}">
    <Number>${escapeXml(forwardTo)}</Number>
  </Dial>
</Response>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const formData = await req.formData();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // HMAC: Twilio signs url + sorted POST params with the Auth Token of the
    // account that placed/received the call (the workspace's vault creds,
    // not necessarily the global env token). The request arrives at our edge
    // function via Supabase's proxy, where req.url has a different host than
    // the URL Twilio was configured with. Try the reconstructed URL first,
    // fall back to the canonical SUPABASE_URL-based one.
    if (!isWebhookVerificationDisabled()) {
      const signature = req.headers.get("x-twilio-signature");
      const supabaseBase = supabaseUrl.replace(/\/$/, "");
      const canonicalUrl = `${supabaseBase}/functions/v1/twilio-incoming`;
      const candidates = [getPublicUrl(req), canonicalUrl];
      const authTokens = await resolveWebhookAuthTokens(supabase, formData);
      const matched = await validateTwilioSignatureAny({
        urls: candidates,
        authTokens,
        form: formData,
        signature,
      });
      if (!matched) {
        console.warn(
          `[twilio-incoming] HMAC mismatch. tried=${candidates.join(",")} tokens=${authTokens.length} sig=${signature?.slice(0, 16)}…`,
        );
        return new Response("Forbidden", { status: 403, headers: corsHeaders });
      }
    }

    const callSid = formData.get("CallSid")?.toString() ?? "";
    const from = formData.get("From")?.toString() ?? "";
    const to = formData.get("To")?.toString() ?? "";
    const direction = formData.get("Direction")?.toString() ?? "inbound";

    // For inbound calls (customer → us), our Twilio number is `To`.
    // For outbound-api calls (we dial customer), our Twilio number is `From`.
    const ownE164 = direction.startsWith("outbound") ? from : to;

    console.log(
      `[twilio-incoming] callSid=${callSid} direction=${direction} from=${from} to=${to} ownE164=${ownE164}`,
    );

    const { data: phoneNumber, error: phoneErr } = await supabase
      .from("phone_numbers")
      .select("id, account_id, inbox_id, pinned_persona_id, inbound_behavior, enabled, provider_config")
      .eq("e164", ownE164)
      .maybeSingle();
    console.log(
      `[twilio-incoming] phone_number lookup: found=${!!phoneNumber} enabled=${phoneNumber?.enabled} behavior=${phoneNumber?.inbound_behavior} persona=${phoneNumber?.pinned_persona_id} err=${phoneErr?.message ?? "none"}`,
    );

    if (phoneErr || !phoneNumber || !phoneNumber.enabled) {
      return new Response(BUSY_TWIML, {
        headers: { "Content-Type": "text/xml; charset=utf-8" },
      });
    }

    // For outbound-api, voice-outbound already created the voice_calls row
    // before dialing. Look it up by CallSid to avoid duplicating.
    let call: { id: string } | null = null;
    if (direction.startsWith("outbound")) {
      const { data: existing } = await supabase
        .from("voice_calls")
        .select("id")
        .eq("provider_call_sid", callSid)
        .maybeSingle();
      if (existing) call = existing;
    }

    if (!call) {
      const { data: created } = await supabase
        .from("voice_calls")
        .insert({
          account_id: phoneNumber.account_id,
          phone_number_id: phoneNumber.id,
          persona_id: phoneNumber.pinned_persona_id,
          direction: direction.startsWith("outbound") ? "outbound" : "inbound",
          status: "ringing",
          provider: "twilio",
          provider_call_sid: callSid,
          from_number: from,
          to_number: to,
          started_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      call = created;
    }

    const callId = call?.id ?? callSid;
    const cfg = (phoneNumber.provider_config ?? {}) as Record<string, unknown>;
    const forwardTo = typeof cfg.forward_to === "string" ? cfg.forward_to : "";

    // Resolve voice + greeting for this call. Both come from the pinned
    // persona when available; env provides defaults for the trial case.
    let voiceId = DEFAULT_VOICE_ID();
    if (typeof cfg.voice_id === "string" && cfg.voice_id) {
      voiceId = cfg.voice_id;
    }
    let welcomeGreeting = "Olá, em que posso ajudar?";
    if (phoneNumber.pinned_persona_id) {
      const { data: persona } = await supabase
        .from("agent_personas")
        .select("name, voice_clone_id, voice_provider")
        .eq("id", phoneNumber.pinned_persona_id)
        .maybeSingle();
      if (persona) {
        if (persona.voice_provider === "elevenlabs" && persona.voice_clone_id) {
          voiceId = persona.voice_clone_id;
        }
        if (persona.name) {
          welcomeGreeting = `Olá! Aqui é ${persona.name}. Em que posso ajudar?`;
        }
      }
    }

    // inbound_behavior describes what happens when someone calls US. On an
    // outbound-api call we dialed the customer to talk, so "voicemail" would
    // play our own "deixe seu recado" prompt to them. Caller-ID-only numbers
    // are always stored as voicemail (they never receive inbound), which made
    // every outbound call from them hit the voicemail prompt.
    const behavior = direction.startsWith("outbound") && phoneNumber.inbound_behavior === "voicemail"
      ? "ai_answer"
      : phoneNumber.inbound_behavior;

    let twiml: string;
    switch (behavior) {
      case "ai_answer":
      case "suggest": {
        // Prefer ElevenLabs Conversational AI if the persona has a synced agent.
        const elAgentId = await resolveElAgentId(supabase, phoneNumber.pinned_persona_id);
        if (elAgentId) {
          twiml = await buildElTwiML(
            supabase,
            phoneNumber.account_id,
            elAgentId,
            from,
            to,
            direction,
            callId,
            callSid,
          );
        } else {
          // Fallback: ConversationRelay (Twilio-hosted STT+TTS).
          twiml = buildAiAnswerTwiML(callId, phoneNumber.pinned_persona_id, voiceId, welcomeGreeting);
        }
        break;
      }
      case "forward_to_agent":
        twiml = forwardTo ? buildForwardTwiML(forwardTo, ownE164) : VOICEMAIL_TWIML;
        break;
      case "voicemail":
      default:
        twiml = VOICEMAIL_TWIML;
        break;
    }
    console.log(
      `[twilio-incoming] emitting TwiML (${behavior}, voice=${voiceId}, callId=${callId}):\n${twiml.slice(0, 500)}`,
    );

    return new Response(twiml, {
      headers: { ...corsHeaders, "Content-Type": "text/xml; charset=utf-8" },
    });
  } catch (e) {
    console.error("[twilio-incoming] error", e);
    return new Response(BUSY_TWIML, {
      headers: { ...corsHeaders, "Content-Type": "text/xml; charset=utf-8" },
    });
  }
});
