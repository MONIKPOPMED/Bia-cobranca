import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

type AdminClient = SupabaseClient<Database>;
type ClaimedRecipient = Database["public"]["Tables"]["whatsapp_campaign_recipients"]["Row"];

const AI_MODEL = "openai/gpt-6-astra";
const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/responses";

export async function createCampaign(admin: AdminClient, userId: string, input: {
  accountId: string;
  name: string;
  audienceMode: "selected" | "all_open";
  contactIds: string[];
  scheduledFor: string | null;
}) {
  const name = input.name.trim();
  if (!name) throw new Error("Informe o nome da campanha");
  if (input.audienceMode === "selected" && input.contactIds.length === 0) throw new Error("Selecione ao menos um devedor");

  const { data: isAdmin, error: roleError } = await admin.rpc("has_role", { _user_id: userId, _account_id: input.accountId, _role: "admin" });
  if (roleError || !isAdmin) throw new Error("Apenas administradores podem criar campanhas");

  const { data: channel } = await admin.from("channels").select("id, config, enabled").eq("account_id", input.accountId).eq("channel_type", "whatsapp").eq("enabled", true).maybeSingle();
  const config = asObject(channel?.config);
  if (!channel || config.evolution_instance_status !== "connected") throw new Error("Conecte o WhatsApp antes de criar a campanha");
  const { data: inbox } = await admin.from("inboxes").select("id").eq("channel_id", channel.id).maybeSingle();
  if (!inbox) throw new Error("Caixa do WhatsApp não encontrada");
  const { data: deployment } = await admin.from("agent_persona_deployments").select("persona_id").eq("account_id", input.accountId).eq("inbox_id", inbox.id).eq("enabled", true).eq("autonomy", "auto").maybeSingle();
  if (!deployment) throw new Error("Ative a Bia no WhatsApp antes de criar a campanha");

  let debtQuery = admin.from("debts").select("id, contact_id, valor_atual, vencimento, origem, descricao, contact:contacts!inner(id, name, phone_number, blocked)").eq("account_id", input.accountId).in("status", ["aberto", "em_negociacao"]);
  if (input.audienceMode === "selected") debtQuery = debtQuery.in("contact_id", input.contactIds);
  const { data: debts, error: debtsError } = await debtQuery.order("vencimento", { ascending: true }).limit(5000);
  if (debtsError) throw new Error(debtsError.message);

  const { data: dncRows } = await admin.from("dnc_list").select("phone_number, phone_e164").eq("account_id", input.accountId);
  const dnc = new Set((dncRows ?? []).flatMap((row) => [normalizePhone(row.phone_number), normalizePhone(row.phone_e164)]).filter(Boolean));
  type DebtRow = NonNullable<typeof debts>[number];
  const grouped = new Map<string, { contact: { id: string; name: string | null; phone_number: string | null; blocked: boolean }; debts: DebtRow[] }>();
  let skipped = 0;
  for (const debt of debts ?? []) {
    const contact = Array.isArray(debt.contact) ? debt.contact[0] : debt.contact;
    const phone = normalizePhone(contact?.phone_number ?? null);
    if (!contact || contact.blocked || phone.length < 10 || phone.length > 15 || dnc.has(phone)) { skipped += 1; continue; }
    const current: { contact: typeof contact; debts: DebtRow[] } = grouped.get(contact.id) ?? { contact, debts: [] };
    current.debts.push(debt);
    grouped.set(contact.id, current);
  }
  if (grouped.size === 0) throw new Error("Nenhum devedor elegível com dívida aberta e WhatsApp válido");

  const now = new Date();
  const scheduledDate = input.scheduledFor ? new Date(input.scheduledFor) : null;
  if (scheduledDate && Number.isNaN(scheduledDate.getTime())) throw new Error("Data de agendamento inválida");
  const startsAt = scheduledDate && scheduledDate > now ? scheduledDate : now;
  const status = scheduledDate && scheduledDate > now ? "scheduled" : "running";
  const { data: campaign, error: campaignError } = await admin.from("whatsapp_campaigns").insert({
    account_id: input.accountId,
    inbox_id: inbox.id,
    persona_id: deployment.persona_id,
    name,
    audience_mode: input.audienceMode,
    status,
    scheduled_for: scheduledDate?.toISOString() ?? null,
    daily_limit: 100,
    contact_count: grouped.size,
    skipped_count: skipped,
    created_by_id: userId,
    started_at: status === "running" ? now.toISOString() : null,
  }).select("id").single();
  if (campaignError || !campaign) throw new Error(campaignError?.message ?? "Não foi possível criar a campanha");

  const recipients = Array.from(grouped.values()).map(({ contact, debts: contactDebts }) => ({
    campaign_id: campaign.id,
    account_id: input.accountId,
    contact_id: contact.id,
    phone_number: normalizePhone(contact.phone_number),
    debt_ids: contactDebts.map((debt) => debt.id),
    debt_data: {
      debtor_name: contact.name ?? "cliente",
      total_open: contactDebts.reduce((sum, debt) => sum + Number(debt.valor_atual ?? 0), 0),
      nearest_due_date: contactDebts.map((debt) => debt.vencimento).sort()[0] ?? null,
      descriptions: contactDebts.map((debt) => debt.descricao || debt.origem).filter(Boolean).slice(0, 5),
      debt_count: contactDebts.length,
    } as Json,
    dispatch_after: startsAt.toISOString(),
  }));
  const { error: recipientsError } = await admin.from("whatsapp_campaign_recipients").insert(recipients);
  if (recipientsError) {
    await admin.from("whatsapp_campaigns").update({ status: "failed", last_error: recipientsError.message, finished_at: new Date().toISOString() }).eq("id", campaign.id);
    throw new Error(recipientsError.message);
  }
  return { campaignId: campaign.id, queued: recipients.length, skipped, status };
}

export async function controlCampaign(admin: AdminClient, userId: string, campaignId: string, action: "pause" | "resume" | "cancel") {
  const { data: campaign } = await admin.from("whatsapp_campaigns").select("account_id").eq("id", campaignId).maybeSingle();
  if (!campaign) throw new Error("Campanha não encontrada");
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _account_id: campaign.account_id, _role: "admin" });
  if (!isAdmin) throw new Error("Apenas administradores podem controlar campanhas");
  const nextStatus = action === "pause" ? "paused" : action === "resume" ? "running" : "canceled";
  await admin.from("whatsapp_campaigns").update({ status: nextStatus, finished_at: action === "cancel" ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq("id", campaignId);
  if (action === "cancel") {
    await admin.from("whatsapp_campaign_recipients").update({ status: "skipped", skip_reason: "campaign_canceled" }).eq("campaign_id", campaignId).eq("status", "queued");
    await admin.rpc("refresh_whatsapp_campaign_totals", { p_campaign_id: campaignId });
  }
  return { status: nextStatus };
}

export async function dispatchCampaignBatch(admin: AdminClient, lovableApiKey: string) {
  // Collection messages only go out Mon–Fri 9h–18h (same window as the
  // calls, _shared/voice/guard.ts); queued customers wait for the next window.
  if (!isWithinSendingHours()) return { claimed: 0, sent: 0, failed: 0, requeued: 0, outside_hours: true };
  const { data: claimed, error } = await admin.rpc("claim_whatsapp_campaign_recipients", { p_limit: 2 });
  if (error) throw new Error(error.message);
  let sent = 0;
  let failed = 0;
  let requeued = 0;
  for (const row of claimed ?? []) {
    try {
      await dispatchOne(admin, lovableApiKey, row);
      sent += 1;
    } catch (error) {
      const failure = normalizeFailure(error);
      if (failure.pauseCampaign) await admin.from("whatsapp_campaigns").update({ status: "paused", last_error: failure.message }).eq("id", row.campaign_id);
      if (failure.retry && row.attempts < 3) {
        const delayMinutes = Math.min(60, 5 * 2 ** Math.max(0, row.attempts - 1));
        await admin.from("whatsapp_campaign_recipients").update({ status: "queued", last_error: failure.message, dispatch_after: new Date(Date.now() + delayMinutes * 60_000).toISOString() }).eq("id", row.id);
        requeued += 1;
      } else {
        await admin.from("whatsapp_campaign_recipients").update({ status: "failed", last_error: failure.message }).eq("id", row.id);
        failed += 1;
      }
    } finally {
      await admin.rpc("refresh_whatsapp_campaign_totals", { p_campaign_id: row.campaign_id });
    }
  }
  return { claimed: claimed?.length ?? 0, sent, failed, requeued };
}

async function dispatchOne(admin: AdminClient, lovableApiKey: string, row: ClaimedRecipient) {
  const { data: campaign } = await admin.from("whatsapp_campaigns").select("account_id, inbox_id, persona_id, status").eq("id", row.campaign_id).maybeSingle();
  if (!campaign || campaign.status !== "running") throw new Error("Campanha não está em execução");
  const [{ data: persona }, { data: settings }, { data: inbox }, { data: contact }] = await Promise.all([
    admin.from("agent_personas").select("name, system_prompt, enabled, status, elevenlabs_knowledge_base_ids").eq("id", campaign.persona_id).maybeSingle(),
    admin.from("company_settings").select("company_name, default_discount_pct, default_max_installments").eq("account_id", campaign.account_id).maybeSingle(),
    admin.from("inboxes").select("channel_id, channel_type").eq("id", campaign.inbox_id).maybeSingle(),
    admin.from("contacts").select("id, blocked").eq("id", row.contact_id).maybeSingle(),
  ]);
  if (!persona?.enabled || persona.status !== "active") throw new Error("A agente da campanha não está ativa");
  if (!contact || contact.blocked) throw new Error("O contato está bloqueado");
  if (inbox?.channel_type !== "whatsapp" || !inbox.channel_id) throw new Error("Canal de WhatsApp inválido");
  const { data: channel } = await admin.from("channels").select("config, enabled").eq("id", inbox.channel_id).maybeSingle();
  const config = asObject(channel?.config);
  if (!channel?.enabled || config.evolution_instance_status !== "connected") throw new Error("WhatsApp desconectado");

  const debt = asObject(row.debt_data);
  const message = await generateMessage(lovableApiKey, persona, settings, debt);
  await admin.from("whatsapp_campaign_recipients").update({ status: "sending", generated_message: message }).eq("id", row.id);
  await admin.from("contact_inboxes").upsert({ contact_id: row.contact_id, inbox_id: campaign.inbox_id, source_id: `evolution:whatsapp:${row.phone_number}` }, { onConflict: "contact_id,inbox_id", ignoreDuplicates: true });
  const { data: conversationId, error: conversationError } = await admin.rpc("get_or_create_open_conversation", { p_account_id: campaign.account_id, p_contact_id: row.contact_id, p_inbox_id: campaign.inbox_id });
  if (conversationError || !conversationId) throw new Error("Não foi possível abrir a conversa");
  const providerMessageId = await sendEvolutionText(config, row.phone_number, message).catch(async (error) => {
    // Session down ("Connection Closed"): mark the channel, alert the admins
    // and pause the campaign; the customer goes back to the queue.
    if (error instanceof ProviderError && isEvolutionConnectionFailure(error.message)) {
      await markWhatsAppSendFailure(admin, inbox.channel_id!, campaign.account_id, config, error.message);
      throw new WhatsAppDownError("WhatsApp desconectado: o servidor Evolution fechou a conexão. Reconecte em Canais e retome a campanha.");
    }
    throw error;
  });
  const now = new Date().toISOString();
  const { data: saved, error: messageError } = await admin.from("messages").insert({
    account_id: campaign.account_id,
    inbox_id: campaign.inbox_id,
    conversation_id: conversationId,
    content: message,
    message_type: 1,
    sender_type: "AgentBot",
    sender_id: campaign.persona_id,
    content_type: 0,
    private: false,
    source_id: providerMessageId,
    content_attributes: { kind: "whatsapp_collection_campaign", campaign_id: row.campaign_id, recipient_id: row.id },
  }).select("id").single();
  if (messageError || !saved) throw new Error("Mensagem enviada, mas o histórico não pôde ser registrado");
  await admin.from("conversations").update({ last_activity_at: now }).eq("id", conversationId);
  await admin.from("whatsapp_campaign_recipients").update({ status: "sent", conversation_id: conversationId, message_id: saved.id, provider_message_id: providerMessageId, sent_at: now }).eq("id", row.id);
}

async function generateMessage(key: string, persona: { name: string; system_prompt: string | null }, settings: { company_name: string | null; default_discount_pct: number | null; default_max_installments: number | null } | null, debt: Record<string, unknown>) {
  const total = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(debt.total_open ?? 0));
  const due = typeof debt.nearest_due_date === "string" ? new Date(`${debt.nearest_due_date}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "não informado";
  const descriptions = Array.isArray(debt.descriptions) ? debt.descriptions.join(", ") : "não informada";
  const response = await fetch(AI_GATEWAY, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "fetch" },
    body: JSON.stringify({
      model: AI_MODEL,
      stream: true,
      store: false,
      reasoning: { effort: "low", summary: "auto" },
      include: ["reasoning.encrypted_content"],
      instructions: `${persona.system_prompt ?? "Você é uma assistente de cobrança cordial."}\nCrie uma mensagem inicial em português do Brasil, com no máximo três frases. Comece com a saudação do horário e o primeiro nome do cliente. Identifique-se como ${persona.name}. Não exponha CPF, não ameace e nunca invente valores, datas, links ou condições. Não mande link nesta primeira mensagem. Convide o cliente a responder para regularizar.`,
      input: `Escreva apenas a mensagem final para ${String(debt.debtor_name ?? "cliente")}. Empresa: ${settings?.company_name ?? "empresa"}. Agora é ${greeting()}. Vencimento mais antigo: ${due}. Descrição: ${descriptions}. ${paymentRule(Number(debt.debt_count ?? 1), Number(debt.total_open ?? 0))}`,
    }),
  });
  if (!response.ok) throw new AiError(response.status, await safeGatewayError(response));
  if (!response.body) throw new AiError(500, "A IA não retornou conteúdo");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
      try {
        const event = JSON.parse(line.slice(6)) as { type?: string; delta?: string };
        if (event.type === "response.output_text.delta" && event.delta) text += event.delta;
      } catch { /* ignored event */ }
    }
  }
  const cleaned = text.trim().replace(/^["']|["']$/g, "");
  if (!cleaned) throw new AiError(500, "A IA não gerou a mensagem");
  return cleaned.slice(0, 1500);
}

async function sendEvolutionText(config: Record<string, unknown>, number: string, text: string) {
  const url = String(config.evolution_url ?? "").replace(/\/+$/, "");
  const apiKey = String(config.evolution_api_key ?? "");
  const instance = String(config.evolution_instance_name ?? "");
  if (!url || !apiKey || !instance) throw new Error("Credenciais do WhatsApp incompletas");
  const response = await fetch(`${url}/message/sendText/${encodeURIComponent(instance)}`, {
    method: "POST",
    headers: { apikey: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ number: normalizePhone(number), text }),
  });
  const raw = await response.text();
  if (!response.ok) throw new ProviderError(response.status, `Evolution ${response.status}: ${raw.slice(0, 240)}`);
  const parsed = raw ? JSON.parse(raw) as { key?: { id?: string }; messageId?: string; id?: string } : {};
  return parsed.key?.id ?? parsed.messageId ?? parsed.id ?? null;
}

// POPMED rule (30/09) — same as supabase/functions/_shared/payment-links.ts:
// only à vista (PIX or card), never installments; 1–2 overdue pay full and
// the Bia does not talk about discount; 3 or more get 10% off.
function paymentRule(count: number, total: number) {
  const brl = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
  const n = Math.max(1, count);
  const parcelas = n === 1 ? "1 mensalidade" : `${n} mensalidades`;
  const pct = n >= 3 ? 10 : 0;
  if (pct > 0) return `O cliente tem ${parcelas} em atraso, total de ${brl(total)}. Pagando à vista, por PIX ou cartão, tem ${pct}% de desconto: paga ${brl(Math.round(total * (100 - pct)) / 100)}. Não existe parcelamento.`;
  return `O cliente tem ${parcelas} em atraso, total de ${brl(total)}, à vista por PIX ou cartão. Não existe parcelamento. NÃO existe desconto neste caso: não fale em desconto de forma alguma.`;
}

function saoPauloNow() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(new Date());
  return { weekday: parts.find((p) => p.type === "weekday")?.value ?? "", hour: Number(parts.find((p) => p.type === "hour")?.value ?? 0) };
}

function isWithinSendingHours() {
  const { weekday, hour } = saoPauloNow();
  return !["Sat", "Sun"].includes(weekday) && hour >= 9 && hour < 18;
}

function greeting() {
  const { hour } = saoPauloNow();
  return hour < 12 ? "de manhã (bom dia)" : hour < 18 ? "de tarde (boa tarde)" : "de noite (boa noite)";
}

class AiError extends Error { constructor(public status: number, message: string) { super(message); } }
class ProviderError extends Error { constructor(public status: number, message: string) { super(message); } }
class WhatsAppDownError extends Error {}

// Same rule as supabase/functions/_shared/evolution/health.ts (edge functions).
function isEvolutionConnectionFailure(body: string) {
  return /Connection Closed|Connection Failure|not connected|instance does not exist/i.test(body);
}

async function markWhatsAppSendFailure(admin: AdminClient, channelId: string, accountId: string, config: Record<string, unknown>, message: string) {
  try {
    const previous = asObject(config.evolution_send_error as Json);
    const lastAlert = typeof previous.alerted_at === "string" ? new Date(previous.alerted_at).getTime() : 0;
    const now = new Date();
    const alert = now.getTime() - lastAlert > 6 * 3600 * 1000;
    const sendError = { at: now.toISOString(), message: message.slice(0, 300), alerted_at: alert ? now.toISOString() : previous.alerted_at ?? null };
    await admin.from("channels").update({ config: { ...config, evolution_send_error: sendError } as Json }).eq("id", channelId);
    if (!alert) return;
    const { data: admins } = await admin.from("user_roles").select("user_id").eq("account_id", accountId).eq("role", "admin");
    if (!admins?.length) return;
    await admin.from("notifications").insert(admins.map((a) => ({
      account_id: accountId,
      user_id: a.user_id,
      kind: "whatsapp_send_failed",
      title: "WhatsApp sem enviar mensagens",
      body: "O envio pelo WhatsApp da Bia falhou (conexão fechada). Abra Canais e clique em Reconectar.",
      link_to: "/channels",
      metadata: { channel_id: channelId, error: message.slice(0, 300) },
    })));
  } catch (error) {
    console.warn("[whatsapp-campaign] could not record send failure", error);
  }
}
function normalizeFailure(error: unknown) {
  const message = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
  if (error instanceof WhatsAppDownError) return { message, retry: true, pauseCampaign: true };
  if (error instanceof AiError) return { message, retry: error.status === 429 || error.status >= 500, pauseCampaign: [401, 402, 403].includes(error.status) };
  if (error instanceof ProviderError) return { message, retry: error.status === 429 || error.status >= 500, pauseCampaign: error.status === 401 || error.status === 403 };
  const blocked = /bloqueado|não está em execução/i.test(message);
  const disconnected = /desconectado|Credenciais|Canal de WhatsApp inválido/i.test(message);
  return { message, retry: !blocked && !disconnected, pauseCampaign: disconnected };
}
async function safeGatewayError(response: Response) {
  const raw = await response.text();
  try {
    const parsed = JSON.parse(raw) as { message?: string; error?: { message?: string } };
    return String(parsed.message ?? parsed.error?.message ?? `Falha da IA (${response.status})`).slice(0, 500);
  } catch { return `Falha da IA (${response.status})`; }
}
function normalizePhone(value: string | null) { return (value ?? "").replace(/\D/g, ""); }
function asObject(value: Json | null | undefined): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }