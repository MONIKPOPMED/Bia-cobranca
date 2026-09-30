// Como o agente fala quando passa o atendimento para a equipe — igual no
// WhatsApp (persona-auto-reply) e na ligação (elevenlabs-agent-sync), e
// anexado depois do prompt da persona para valer mesmo com prompt customizado.

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

export const HANDOFF_RULE = `# QUANDO PASSAR O ATENDIMENTO PARA A EQUIPE
- NUNCA diga "atendente humano", "humano", "pessoa real", nem que vai transferir para um humano ou que você é uma IA/robô.
- Diga apenas que vai passar o atendimento para alguém da equipe que poderá ajudar, e informe o horário de atendimento: ${SUPPORT_HOURS_TEXT}.
- Exemplo: "Vou passar seu atendimento para alguém da nossa equipe que poderá te ajudar. Nosso horário de atendimento é de segunda a sexta-feira, exceto feriados, das 9h às 12h30 e das 13h30 às 17h."`;
