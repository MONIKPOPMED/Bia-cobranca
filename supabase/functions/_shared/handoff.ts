// Como a Bia passa o atendimento para a equipe — anexado depois do prompt da
// persona para valer mesmo com prompt customizado.
//
// Regra da POPMED (07/10): quando a Bia não resolve, a equipe assume pelo
// WhatsApp do número de suporte (company_settings.support_phone, hoje
// +5548996975445): recebe um resumo (_shared/team-handoff.ts) e chama o cliente.
//   - Ligação: sem transferência; ferramenta passar_para_equipe
//     (voice-transfer-tool) avisa a equipe e a Bia encerra a ligação.
//   - WhatsApp: a Bia marca a resposta com HANDOFF_MARKER; o
//     persona-auto-reply avisa a equipe e pausa a Bia na conversa.

export const SUPPORT_HOURS_TEXT =
  "de segunda a sexta-feira, exceto feriados, das 9h às 12h30 e das 13h30 às 17h";

/**
 * Whether the team is answering now (SUPPORT_HOURS_TEXT, São Paulo time).
 * Holidays are not known here — a transfer on a holiday may go unanswered.
 */
export function isWithinSupportHours(now = new Date()): boolean {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    }).formatToParts(now).map((p) => [p.type, p.value]),
  );
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return (minutes >= 9 * 60 && minutes < 12 * 60 + 30) || (minutes >= 13 * 60 + 30 && minutes < 17 * 60);
}

const NEVER_HUMAN =
  `- NUNCA diga "atendente humano", "humano", "pessoa real", nem que você é uma IA/robô. Diga "alguém da nossa equipe".`;

const WHEN = `- Tente resolver tudo você mesma. Só passe para a equipe quando não conseguir: o cliente contesta a cobrança ou o valor, pede cancelamento, pede algo fora das regras, ou insiste em falar com alguém.`;

/** Ligação (elevenlabs-agent-sync / elevenlabs-personalization). */
export const HANDOFF_RULE_VOICE = `# QUANDO NÃO CONSEGUIR RESOLVER (LIGAÇÃO)
${WHEN}
${NEVER_HUMAN}
- Não transfira a ligação e não peça para anotar número. Diga que vai passar o caso para alguém da nossa equipe, que vai continuar o atendimento pelo WhatsApp, no horário de atendimento (${SUPPORT_HOURS_TEXT}).
- Chame a ferramenta \`passar_para_equipe\` com um resumo curto do que o cliente precisa. Depois despeça-se e chame \`end_call\`.`;

/** Marca que o persona-auto-reply procura na resposta do WhatsApp. */
export const HANDOFF_MARKER = "[[EQUIPE]]";

/** WhatsApp (persona-auto-reply). */
export const HANDOFF_RULE_WHATSAPP = `# QUANDO PASSAR O ATENDIMENTO PARA A EQUIPE (WHATSAPP)
${WHEN}
${NEVER_HUMAN}
- Diga que vai passar o atendimento para alguém da nossa equipe, que vai continuar com o cliente pelo WhatsApp, e informe o horário de atendimento: ${SUPPORT_HOURS_TEXT}.
- NÃO escreva o número da equipe. Termine essa mensagem com o marcador ${HANDOFF_MARKER} — o sistema avisa a equipe, que chama o cliente, e você para de responder nesta conversa.`;

/** "+5548996975445" → "5548996975445" (null if not a plausible E.164). */
export function supportDigits(phone: string | null | undefined): string | null {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

/** "5548996975445" → "(48) 99697-5445". */
export function formatBrPhone(digits: string): string {
  const local = digits.startsWith("55") ? digits.slice(2) : digits;
  const ddd = local.slice(0, 2);
  const rest = local.slice(2);
  return rest.length >= 8 ? `(${ddd}) ${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}` : `+${digits}`;
}

const DIGIT_WORDS = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];

/**
 * "5548996975445" → "quatro, oito... nove, nove, seis, nove, sete... cinco, quatro, quatro, cinco".
 * Digit by digit so the TTS doesn't read "noventa e nove mil…".
 */
export function spokenPhone(digits: string): string {
  const local = digits.startsWith("55") ? digits.slice(2) : digits;
  const groups = [local.slice(0, 2), local.slice(2, local.length - 4), local.slice(-4)].filter(Boolean);
  return groups.map((g) => [...g].map((d) => DIGIT_WORDS[Number(d)]).join(", ")).join("... ");
}
