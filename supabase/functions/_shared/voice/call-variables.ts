// Dynamic variables for the ElevenLabs agent (first message, prompt, tools).
//
// EL rejects a conversation at start when a {{var}} used by the agent is not
// sent with the call — the agent's dynamic_variable_placeholders do NOT cover
// real calls (29/09 test: "Missing required dynamic variables in first
// message: debtor_name, company_name, agent_name", call dropped in 2s).
// So every call must send the full set; these defaults fill what we don't know.
import { phoneVariants } from "../phone.ts";
import { discountPctFor } from "../payment-links.ts";
import { spokenAreaAndEnding, spokenPhone, supportDigits } from "../handoff.ts";

export const DEFAULT_DYNAMIC_VARIABLES: Record<string, string> = {
  company_name: "nossa empresa",
  agent_name: "Bia",
  debtor_name: "cliente",
  debtor_doc_last4: "----",
  valor_formatado: "(valor a confirmar)",
  vencimento_br: "(data a confirmar)",
  dias_atraso: "0",
  origem_debito: "débito",
  descricao: "",
  desconto_pct: "0",
  max_parcelas: "1",
  valor_min_parcela_formatado: "R$ 50,00",
  first_due_min_days: "3",
  first_due_max_days: "10",
  support_phone: "",
  customer_name: "cliente",
  caller_phone: "",
  open_conversations: "0",
  has_history: "não",
  debt_id: "",
  // Used by the registrar_acordo tool header; only campaign calls send it.
  campaign_contact_id: "",
  // POPMED payment rule (see collection-guardrails): filled from the Carteira.
  parcelas_em_atraso: "0",
  valor_a_pagar_formatado: "(valor a confirmar)",
  regra_pagamento:
    "Não há dívida em aberto no sistema para este número. Não cite valores nem condições; passe o atendimento para a equipe.",
  // Team WhatsApp dictated digit by digit (HANDOFF_RULE_VOICE); filled from
  // company_settings.support_phone.
  whatsapp_equipe_falado: "o WhatsApp da nossa equipe, que vamos te enviar por mensagem",
  // "DDD quarenta e oito, final cinco, quatro, quatro, cinco" (HANDOFF_RULE_VOICE).
  whatsapp_equipe_aviso: "o DDD da nossa empresa",
  // Agent's first message ({{saudacao}}), built per call so it sounds natural
  // with or without the customer's name.
  saudacao: greeting(null, "Bia", "nossa empresa"),
};

/** "Bom dia" / "Boa tarde" / "Boa noite" in São Paulo time. */
export function greetingOfDay(now = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "numeric", hourCycle: "h23" }).format(now),
  );
  return hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
}

// Short on purpose: the first seconds of audio on a BR mobile often get lost
// (30/09 test: greeting unheard, customer said "alô" three times). A short
// "Alô?" opener invites a reply; the agent introduces itself and gives the
// recording notice in its next turn (collection-guardrails, step 1).
// Gender-neutral on purpose: "é a Monik?" assumed a woman.
function greeting(firstName: string | null, _agent: string, _company: string, now = new Date()): string {
  return firstName
    ? `Alô? ${greetingOfDay(now)}! Estou falando com ${firstName}?`
    : `Alô? ${greetingOfDay(now)}, tudo bem?`;
}

/** "Bia cobrança" → "Bia": the persona name doubles as a label in the app. */
export function spokenAgentName(personaName: string | null | undefined): string {
  return personaName?.trim().split(/\s+/)[0] || DEFAULT_DYNAMIC_VARIABLES.agent_name;
}

/** "MONIK MENDES" → "Monik": first name, spoken naturally. */
function spokenFirstName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  if (!first) return null;
  return first.charAt(0).toLocaleUpperCase("pt-BR") + first.slice(1).toLocaleLowerCase("pt-BR");
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

type OpenDebt = { id: string; valor_atual: number | null; vencimento: string | null };

/** Values + the spoken payment rule for the customer's open debts. */
export function debtVariables(open: OpenDebt[], now = new Date()): Record<string, string> {
  if (open.length === 0) return {};
  const total = open.reduce((sum, d) => sum + Number(d.valor_atual ?? 0), 0);
  const pct = discountPctFor(open.length);
  const toPay = Math.round(total * (100 - pct)) / 100;
  const oldest = open.find((d) => d.vencimento)?.vencimento ?? null;
  const daysLate = oldest
    ? Math.max(0, Math.floor((now.getTime() - new Date(oldest).getTime()) / 86_400_000))
    : 0;
  const n = open.length;
  const parcelas = n === 1 ? "1 mensalidade" : `${n} mensalidades`;

  const rule = pct > 0
    ? `O cliente tem ${parcelas} em atraso, total de ${brl(total)}. Pagando à vista hoje, ` +
      `por PIX ou cartão, tem ${pct}% de desconto: paga ${brl(toPay)}. Pode mencionar esse desconto.`
    : `O cliente tem ${parcelas} em atraso. O valor a pagar é ${brl(total)}, à vista, por PIX ou cartão. ` +
      `NÃO existe desconto neste caso — não fale em desconto de forma alguma, nem "zero por cento"; diga só o valor.`;

  return {
    valor_formatado: brl(total),
    valor_a_pagar_formatado: brl(toPay),
    vencimento_br: oldest ? brDate(oldest) : DEFAULT_DYNAMIC_VARIABLES.vencimento_br,
    dias_atraso: String(daysLate),
    desconto_pct: String(pct),
    max_parcelas: "1",
    parcelas_em_atraso: String(n),
    regra_pagamento: rule,
    debt_id: open[0].id,
  };
}

/**
 * Full variable set for one call: defaults + company, agent and — when the
 * customer's phone is in the Carteira — the customer's first name and debts.
 */
export async function buildCallDynamicVariables(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  opts: { accountId: string; personaId: string | null; customerPhone: string },
): Promise<Record<string, string>> {
  const vars: Record<string, string> = { ...DEFAULT_DYNAMIC_VARIABLES, caller_phone: opts.customerPhone };

  const [{ data: settings }, { data: account }, { data: persona }, { data: contacts }] = await Promise.all([
    supabase.from("company_settings").select("company_name, support_phone").eq("account_id", opts.accountId).maybeSingle(),
    supabase.from("accounts").select("name").eq("id", opts.accountId).maybeSingle(),
    opts.personaId
      ? supabase.from("agent_personas").select("name").eq("id", opts.personaId).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("contacts")
      .select("id, name")
      .eq("account_id", opts.accountId)
      .in("phone_number", phoneVariants(opts.customerPhone))
      .limit(1),
  ]);

  const company = settings?.company_name || account?.name;
  if (company) vars.company_name = company;
  if (settings?.support_phone) vars.support_phone = settings.support_phone;
  const teamDigits = supportDigits(settings?.support_phone);
  if (teamDigits) {
    vars.whatsapp_equipe_falado = spokenPhone(teamDigits);
    vars.whatsapp_equipe_aviso = spokenAreaAndEnding(teamDigits);
  }
  vars.agent_name = spokenAgentName(persona?.name);

  const contact = contacts?.[0] as { id: string; name: string | null } | undefined;
  const firstName = spokenFirstName(contact?.name);
  if (firstName) {
    vars.debtor_name = firstName;
    vars.customer_name = firstName;
  }

  if (contact?.id) {
    const { data: debts } = await supabase
      .from("debts")
      .select("id, valor_atual, vencimento")
      .eq("account_id", opts.accountId)
      .eq("contact_id", contact.id)
      .in("status", ["aberto", "em_negociacao"])
      .order("vencimento", { ascending: true })
      .limit(50);
    Object.assign(vars, debtVariables((debts ?? []) as OpenDebt[]));
  }
  vars.saudacao = greeting(firstName, vars.agent_name, vars.company_name);
  return vars;
}
