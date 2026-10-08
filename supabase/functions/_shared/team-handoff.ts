// POPMED handoff (07/10): when the Bia can't solve a case, the team's
// WhatsApp (company_settings.support_phone) gets a summary and calls the
// customer. Sent from the account's connected Evolution (WhatsApp) number.
import { sendText } from "./evolution/index.ts";
import { formatBrPhone, supportDigits } from "./handoff.ts";
import { phoneVariants } from "./phone.ts";

export type EvolutionSender = { url: string; apiKey: string; instanceName: string };

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** The account's connected WhatsApp (Evolution) sender, or null. */
// deno-lint-ignore no-explicit-any
export async function loadWhatsAppSender(admin: any, accountId: string): Promise<EvolutionSender | null> {
  const { data: channel } = await admin
    .from("channels")
    .select("config")
    .eq("account_id", accountId)
    .eq("channel_type", "whatsapp")
    .eq("enabled", true)
    .maybeSingle();
  const cfg = (channel?.config ?? {}) as Record<string, string>;
  if (cfg.evolution_instance_status !== "connected" || !cfg.evolution_url || !cfg.evolution_api_key || !cfg.evolution_instance_name) {
    return null;
  }
  return { url: cfg.evolution_url, apiKey: cfg.evolution_api_key, instanceName: cfg.evolution_instance_name };
}

/** Team WhatsApp digits from company_settings.support_phone, or null. */
// deno-lint-ignore no-explicit-any
export async function loadTeamWhatsApp(admin: any, accountId: string): Promise<string | null> {
  const { data } = await admin.from("company_settings").select("support_phone").eq("account_id", accountId).maybeSingle();
  return supportDigits(data?.support_phone);
}

/**
 * Sends the case summary to the team's WhatsApp. Returns false when there is
 * no team number or no connected WhatsApp to send from.
 */
export async function notifyTeam(
  // deno-lint-ignore no-explicit-any
  admin: any,
  opts: {
    accountId: string;
    origin: "WhatsApp" | "Ligação";
    customerPhone: string;
    contactId?: string | null;
    reason?: string | null;
    lastMessages?: string[];
    sender?: EvolutionSender | null;
  },
): Promise<boolean> {
  const [team, sender] = await Promise.all([
    loadTeamWhatsApp(admin, opts.accountId),
    opts.sender ? Promise.resolve(opts.sender) : loadWhatsAppSender(admin, opts.accountId),
  ]);
  if (!team || !sender) {
    console.warn("[team-handoff] missing team number or WhatsApp sender", { accountId: opts.accountId, team: !!team, sender: !!sender });
    return false;
  }

  let contact: { id: string; name: string | null; phone_number: string | null } | null = null;
  if (opts.contactId) {
    ({ data: contact } = await admin.from("contacts").select("id, name, phone_number").eq("id", opts.contactId).maybeSingle());
  } else if (opts.customerPhone) {
    const { data } = await admin
      .from("contacts")
      .select("id, name, phone_number")
      .eq("account_id", opts.accountId)
      .in("phone_number", phoneVariants(opts.customerPhone))
      .limit(1);
    contact = data?.[0] ?? null;
  }
  const { data: debts } = contact
    ? await admin.from("debts").select("valor_atual").eq("account_id", opts.accountId).eq("contact_id", contact.id).in("status", ["aberto", "em_negociacao"])
    : { data: [] };
  const open = (debts ?? []) as Array<{ valor_atual: number | null }>;
  const total = open.reduce((sum, d) => sum + Number(d.valor_atual ?? 0), 0);
  const customerDigits = String(contact?.phone_number ?? opts.customerPhone).replace(/\D/g, "");

  const lines = [
    `🔔 Caso para a equipe — a Bia não conseguiu resolver (${opts.origin})`,
    // Full name exactly as in the Carteira (the Bia only speaks the first name).
    `Nome completo: ${contact?.name?.trim() || "não cadastrado na Carteira"}`,
    `WhatsApp: ${formatBrPhone(customerDigits)} — https://wa.me/${customerDigits}`,
    open.length ? `Mensalidades em aberto: ${open.length} (total ${brl(total)})` : "Sem dívida em aberto no sistema.",
  ];
  if (opts.reason) lines.push(`Motivo: ${opts.reason.trim().slice(0, 300)}`);
  if (opts.lastMessages?.length) lines.push("", "Últimas mensagens:", ...opts.lastMessages);
  lines.push("", "Por favor, chame o cliente para dar continuidade.");

  await sendText({ ...sender, number: team, text: lines.join("\n") });
  return true;
}
