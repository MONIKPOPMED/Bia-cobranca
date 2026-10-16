// Payment receipts (POPMED, 16/10): the Bia always asks the customer for the
// receipt; when the customer sends a photo or PDF on WhatsApp, it is
// forwarded to the "Financeiro Popmed" WhatsApp group (the Bia's number is a
// member) with who sent it and what is open, and the customer gets a short
// confirmation.
//
// The group is found by name and its id cached on
// channels.config.finance_group_id; another name can be set in
// channels.config.finance_group_name.

import { findGroupIdByName, getMediaBase64, sendMedia, sendText } from "./evolution/index.ts";
import { formatBrPhone } from "./handoff.ts";
import { recordOutgoingWhatsApp } from "./whatsapp-history.ts";

const DEFAULT_GROUP_NAME = "Financeiro Popmed";

const CONFIRMATION =
  "Recebi seu comprovante, obrigada! Já encaminhei para o nosso financeiro conferir. Posso te ajudar em mais alguma coisa?";

function brl(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

/** Never throws: a failure here must not break receiving the message. */
export async function forwardReceiptToFinance(
  // deno-lint-ignore no-explicit-any
  admin: any,
  opts: {
    accountId: string;
    conversationId: string;
    inboxId: string;
    contactId: string;
    /** The customer's WhatsApp (as the reply number). */
    customerNumber: string;
    messageId: string;
    mediaType: "image" | "document";
    caption: string;
    fileName?: string;
    mimetype?: string;
    /** false when the team took over the conversation: forward, but don't answer. */
    replyToCustomer: boolean;
  },
): Promise<{ forwarded: boolean; error?: string }> {
  try {
    const { data: inbox } = await admin.from("inboxes").select("channel_id").eq("id", opts.inboxId).maybeSingle();
    const { data: channel } = inbox?.channel_id
      ? await admin.from("channels").select("id, config").eq("id", inbox.channel_id).maybeSingle()
      : { data: null };
    // deno-lint-ignore no-explicit-any
    const cfg = (channel?.config ?? {}) as Record<string, any>;
    if (!cfg.evolution_url || !cfg.evolution_api_key || !cfg.evolution_instance_name) {
      return { forwarded: false, error: "WhatsApp não configurado" };
    }
    const evo = { url: cfg.evolution_url, apiKey: cfg.evolution_api_key, instanceName: cfg.evolution_instance_name };

    let groupId: string | null = cfg.finance_group_id ?? null;
    if (!groupId) {
      groupId = await findGroupIdByName({ ...evo, name: cfg.finance_group_name || DEFAULT_GROUP_NAME });
      if (!groupId) return { forwarded: false, error: `Grupo "${cfg.finance_group_name || DEFAULT_GROUP_NAME}" não encontrado` };
      await admin.from("channels").update({ config: { ...cfg, finance_group_id: groupId } }).eq("id", channel.id);
    }

    const [{ data: contact }, { data: debts }] = await Promise.all([
      admin.from("contacts").select("name, phone_number").eq("id", opts.contactId).maybeSingle(),
      admin
        .from("debts")
        .select("valor_atual, vencimento")
        .eq("contact_id", opts.contactId)
        .in("status", ["aberto", "em_negociacao"])
        .order("vencimento", { ascending: true }),
    ]);
    const open = (debts ?? []) as Array<{ valor_atual: number | null; vencimento: string | null }>;
    const total = open.reduce((s, d) => s + Number(d.valor_atual ?? 0), 0);
    const due = open.map((d) => d.vencimento).filter(Boolean).map((v) => {
      const [y, m, dd] = String(v).slice(0, 10).split("-");
      return `${dd}/${m}/${y}`;
    });
    const digits = String(contact?.phone_number ?? opts.customerNumber).replace(/\D/g, "");
    const when = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

    const caption = [
      "🧾 *Comprovante recebido pela Bia*",
      `Cliente: ${contact?.name ?? "não identificado"}`,
      `WhatsApp: ${digits ? formatBrPhone(digits) : "—"}`,
      open.length
        ? `Em aberto na carteira: ${open.length} mensalidade${open.length === 1 ? "" : "s"}, ${brl(total)} (venc. ${due.join(", ")})`
        : "Em aberto na carteira: nada registrado",
      opts.caption ? `Mensagem do cliente: ${opts.caption.slice(0, 300)}` : null,
      `Recebido em: ${when}`,
      "Conferir o pagamento e dar baixa.",
    ].filter(Boolean).join("\n");

    const media = await getMediaBase64({ ...evo, messageId: opts.messageId });
    await sendMedia({
      ...evo,
      number: groupId,
      mediaUrl: media.base64,
      mediaType: opts.mediaType,
      caption,
      fileName: opts.fileName ?? media.fileName ?? (opts.mediaType === "document" ? "comprovante.pdf" : undefined),
      mimetype: opts.mimetype ?? media.mimetype,
    });
    console.log(`[finance-receipt] forwarded conv=${opts.conversationId} type=${opts.mediaType}`);

    if (opts.replyToCustomer) {
      const sent = await sendText({ ...evo, number: opts.customerNumber, text: CONFIRMATION });
      await recordOutgoingWhatsApp(admin, {
        accountId: opts.accountId,
        contactId: opts.contactId,
        phone: opts.customerNumber,
        text: CONFIRMATION,
        messageId: sent.messageId ?? null,
        kind: "receipt_confirmation",
      });
    }
    return { forwarded: true };
  } catch (err) {
    console.error("[finance-receipt] forward failed", err);
    return { forwarded: false, error: err instanceof Error ? err.message.slice(0, 200) : String(err) };
  }
}
