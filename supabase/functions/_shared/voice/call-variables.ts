// Dynamic variables for the ElevenLabs agent (first message, prompt, tools).
//
// EL rejects a conversation at start when a {{var}} used by the agent is not
// sent with the call — the agent's dynamic_variable_placeholders do NOT cover
// real calls (29/09 test: "Missing required dynamic variables in first
// message: debtor_name, company_name, agent_name", call dropped in 2s).
// So every call must send the full set; these defaults fill what we don't know.
import { phoneVariants } from "../phone.ts";

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
};

/** "Bia cobrança" → "Bia": the persona name doubles as a label in the app. */
export function spokenAgentName(personaName: string | null | undefined): string {
  return personaName?.trim().split(/\s+/)[0] || DEFAULT_DYNAMIC_VARIABLES.agent_name;
}

/**
 * Full variable set for one call: defaults + company, agent and — when the
 * customer's phone is in the Carteira — the customer's first name.
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
      .select("name")
      .eq("account_id", opts.accountId)
      .in("phone_number", phoneVariants(opts.customerPhone))
      .limit(1),
  ]);

  const company = settings?.company_name || account?.name;
  if (company) vars.company_name = company;
  if (settings?.support_phone) vars.support_phone = settings.support_phone;
  vars.agent_name = spokenAgentName(persona?.name);

  const firstName = (contacts?.[0]?.name as string | undefined)?.trim().split(/\s+/)[0];
  if (firstName) {
    vars.debtor_name = firstName;
    vars.customer_name = firstName;
  }
  return vars;
}
