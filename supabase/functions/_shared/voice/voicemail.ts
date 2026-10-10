// What the Bia does when a campaign call lands on voicemail (POPMED, 10/10):
// leave a short neutral message and follow up on WhatsApp. Twilio's
// answering-machine detection (MachineDetection=DetectMessageEnd, set by
// placeTwilioOutboundCall) reports who answered in `AnsweredBy`.
//
// The spoken message uses Twilio's own TTS — the ElevenLabs agent is not
// connected on these calls.
import { sendText } from "../evolution/index.ts";
import { phoneVariants } from "../phone.ts";
import { loadWhatsAppSender } from "../team-handoff.ts";
import { spokenAgentName } from "./call-variables.ts";

/** Twilio AnsweredBy values that mean "not a person". */
export function isAnsweringMachine(answeredBy: string | null | undefined): boolean {
  return /^(machine|fax)/.test(String(answeredBy ?? ""));
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]!));
}

const WHATSAPP_COOLDOWN_HOURS = 24;

/**
 * Returns the TwiML that leaves the message and, at most once per customer
 * every 24h, sends the WhatsApp follow-up. Never throws: the call must get
 * valid TwiML even if the WhatsApp part fails.
 */
export async function leaveVoicemail(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  opts: { accountId: string; personaId: string | null; customerPhone: string; voiceCallId: string | null; answeredBy: string },
): Promise<string> {
  let company = "nossa empresa";
  let agent = "Bia";
  let whatsappSent = false;
  let whatsappSkipped: string | null = null;

  try {
    const [{ data: settings }, { data: account }, { data: persona }, { data: contacts }] = await Promise.all([
      supabase.from("company_settings").select("company_name").eq("account_id", opts.accountId).maybeSingle(),
      supabase.from("accounts").select("name").eq("id", opts.accountId).maybeSingle(),
      opts.personaId
        ? supabase.from("agent_personas").select("name").eq("id", opts.personaId).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("contacts")
        .select("name, phone_number")
        .eq("account_id", opts.accountId)
        .in("phone_number", phoneVariants(opts.customerPhone))
        .limit(1),
    ]);
    company = settings?.company_name || account?.name || company;
    agent = spokenAgentName(persona?.name);

    // One WhatsApp follow-up per customer per day, even if the campaign retries.
    const since = new Date(Date.now() - WHATSAPP_COOLDOWN_HOURS * 3600 * 1000).toISOString();
    const { count: recent } = await supabase
      .from("voice_calls")
      .select("id", { count: "exact", head: true })
      .eq("account_id", opts.accountId)
      .eq("to_number", opts.customerPhone)
      .gte("started_at", since)
      .eq("metadata->voicemail->>whatsapp_sent", "true");

    const sender = await loadWhatsAppSender(supabase, opts.accountId);
    if ((recent ?? 0) > 0) whatsappSkipped = "ja_enviado_24h";
    else if (!sender) whatsappSkipped = "whatsapp_desconectado";
    else {
      const first = (contacts?.[0]?.name as string | undefined)?.trim().split(/\s+/)[0];
      const hello = first ? `Oi, ${first.charAt(0).toUpperCase()}${first.slice(1).toLowerCase()}!` : "Oi!";
      await sendText({
        ...sender,
        number: contacts?.[0]?.phone_number ?? opts.customerPhone,
        text: `${hello} Aqui é a ${agent}, da ${company}. Tentei falar com você por telefone agora há pouco e não consegui. Posso continuar por aqui?`,
      });
      whatsappSent = true;
    }
  } catch (err) {
    console.error("[voicemail] follow-up failed", err);
    whatsappSkipped = whatsappSkipped ?? "erro";
  }

  if (opts.voiceCallId) {
    try {
      const { data: row } = await supabase.from("voice_calls").select("metadata").eq("id", opts.voiceCallId).maybeSingle();
      await supabase
        .from("voice_calls")
        .update({
          metadata: {
            ...(row?.metadata ?? {}),
            voicemail: {
              answered_by: opts.answeredBy,
              left_message: true,
              whatsapp_sent: whatsappSent,
              whatsapp_skipped: whatsappSkipped,
              at: new Date().toISOString(),
            },
          },
        })
        .eq("id", opts.voiceCallId);
    } catch (err) {
      console.warn("[voicemail] could not record outcome", err);
    }
  }
  console.log(`[voicemail] call=${opts.voiceCallId} answered_by=${opts.answeredBy} whatsapp_sent=${whatsappSent} skipped=${whatsappSkipped}`);

  const spoken = `Olá! Aqui é a ${agent}, da ${company}. Vamos te enviar uma mensagem pelo WhatsApp. Até logo!`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response><Say language="pt-BR" voice="Polly.Camila">${escapeXml(spoken)}</Say><Hangup/></Response>`;
}
