// Messages the Bia sends on WhatsApp outside the chat flow (call follow-up,
// payment link after a call) go straight through Evolution, and
// evolution-incoming ignores our own (fromMe) messages — so they never
// reached the conversation history. When the customer answered "Sim" to
// "Posso continuar por aqui?", the Bia didn't know what the "Sim" was about
// and handed off to the team (15/10). Record them like the WhatsApp
// campaign does (src/lib/whatsapp-campaigns.server.ts).

/** Saves an outgoing WhatsApp message in the customer's conversation. Never throws. */
export async function recordOutgoingWhatsApp(
  // deno-lint-ignore no-explicit-any
  admin: any,
  opts: {
    accountId: string;
    contactId: string;
    phone: string;
    text: string;
    personaId?: string | null;
    messageId?: string | null;
    kind: string;
  },
): Promise<void> {
  try {
    const { data: channel } = await admin
      .from("channels")
      .select("id")
      .eq("account_id", opts.accountId)
      .eq("channel_type", "whatsapp")
      .eq("enabled", true)
      .maybeSingle();
    if (!channel) return;
    const { data: inbox } = await admin.from("inboxes").select("id").eq("channel_id", channel.id).maybeSingle();
    if (!inbox) return;

    await admin.from("contact_inboxes").upsert(
      { contact_id: opts.contactId, inbox_id: inbox.id, source_id: `evolution:whatsapp:${opts.phone.replace(/\D/g, "")}` },
      { onConflict: "contact_id,inbox_id", ignoreDuplicates: true },
    );
    const { data: conversationId, error: convErr } = await admin.rpc("get_or_create_open_conversation", {
      p_account_id: opts.accountId,
      p_contact_id: opts.contactId,
      p_inbox_id: inbox.id,
    });
    if (convErr || !conversationId) {
      console.warn("[whatsapp-history] no conversation", convErr?.message);
      return;
    }
    const { error } = await admin.from("messages").insert({
      account_id: opts.accountId,
      inbox_id: inbox.id,
      conversation_id: conversationId,
      content: opts.text,
      message_type: 1,
      sender_type: "AgentBot",
      sender_id: opts.personaId ?? null,
      content_type: 0,
      private: false,
      source_id: opts.messageId ?? null,
      content_attributes: { kind: opts.kind },
    });
    if (error) console.warn("[whatsapp-history] insert failed", error.message);
  } catch (err) {
    console.warn("[whatsapp-history] could not record message", err);
  }
}
