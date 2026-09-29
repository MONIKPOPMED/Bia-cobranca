// Persona auto-reply for inbound messages.
//
// Hardened against loops: the previous version replied to every triggering
// message without checking the sender, the recency of prior replies, or the
// content. With Evolution echoing our own outbound messages back as inbound,
// it produced 100+ replies per minute to a single contact.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { sendText } from "../_shared/evolution/index.ts";
import { HANDOFF_RULE } from "../_shared/handoff.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

const GATEWAY = "https://ai.gateway.lovable.dev/v1/responses";
const MODEL = "openai/gpt-6-astra";
const CONTEXT_TURNS = 8;
// Don't send more than one auto-reply per N seconds in the same conversation.
const MIN_REPLY_GAP_SECONDS = 8;
// Hard daily cap per conversation (anti-loop circuit breaker).
const MAX_AUTO_REPLIES_PER_CONVERSATION_PER_HOUR = 30;

const SYSTEM_PROMPT_GUARDRAILS = `
INSTRUÇÕES OBRIGATÓRIAS:
- Responda em português do Brasil, em UMA mensagem curta (no máximo 2 frases).
- NUNCA use placeholders entre colchetes como [Nome do Cliente], [valor], [data], [Seu Nome], [Nome da Empresa]. Se você não tem o dado real, omita-o.
- NUNCA repita a saudação se já houver mensagens anteriores no histórico.
- Se a última mensagem do cliente estiver vazia ou for um placeholder como "[mensagem]", NÃO responda — retorne uma string vazia.
- Espere a resposta do cliente antes de avançar. Não envie várias perguntas seguidas.
`.trim();

const j = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method_not_allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return j({ error: "bad_json" }, 400); }

  const { accountId, conversationId, inboxId, triggeringMessageId } = body ?? {};
  if (!accountId || !conversationId || !triggeringMessageId) {
    return j({ error: "missing_params" }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 1) Load the triggering message; bail if it isn't a real Contact message.
  const { data: trigger } = await admin
    .from("messages")
    .select("id, sender_type, content, conversation_id, account_id")
    .eq("id", triggeringMessageId)
    .maybeSingle();
  if (!trigger) return j({ skipped: "trigger_not_found" });
  if (trigger.sender_type !== "Contact") return j({ skipped: "not_contact" });
  const txt = (trigger.content ?? "").trim();
  if (!txt || txt === "[mensagem]" || txt === "[mídia]") {
    return j({ skipped: "empty_or_placeholder" });
  }

  // 1.5) Human takeover guard — skip when operator paused the AI on this conversation.
  const { data: convFlags } = await admin
    .from("conversations")
    .select("additional_attributes")
    .eq("id", conversationId)
    .maybeSingle();
  if ((convFlags?.additional_attributes as any)?.ai_paused === true) {
    return j({ skipped: "ai_paused_by_operator" });
  }

  // 2) Rate-limit: most recent AgentBot reply within MIN_REPLY_GAP_SECONDS.
  const sinceGap = new Date(Date.now() - MIN_REPLY_GAP_SECONDS * 1000).toISOString();
  const { count: recentBotCount } = await admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("sender_type", "AgentBot")
    .gte("created_at", sinceGap);
  if ((recentBotCount ?? 0) > 0) {
    return j({ skipped: "rate_limited" });
  }

  // 3) Hourly circuit breaker.
  const sinceHour = new Date(Date.now() - 3600 * 1000).toISOString();
  const { count: hourCount } = await admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("sender_type", "AgentBot")
    .gte("created_at", sinceHour);
  if ((hourCount ?? 0) >= MAX_AUTO_REPLIES_PER_CONVERSATION_PER_HOUR) {
    console.warn(`[persona-auto-reply] hourly cap hit for conv ${conversationId}`);
    return j({ skipped: "hourly_cap" });
  }

  // 4) Resolve only an explicitly enabled automatic deployment for this inbox.
  let personaId: string | null = null;
  let systemPrompt = "Você é um agente de cobrança humano e cordial.";
  if (inboxId) {
    const { data: dep } = await admin
      .from("agent_persona_deployments")
      .select("persona_id, daily_message_budget, messages_sent_today")
      .eq("account_id", accountId)
      .eq("inbox_id", inboxId)
      .eq("enabled", true)
      .eq("autonomy", "auto")
      .maybeSingle();
    if (dep && dep.messages_sent_today >= dep.daily_message_budget) {
      return j({ skipped: "daily_budget_reached" });
    }
    if (dep?.persona_id) personaId = dep.persona_id;
  }
  if (!personaId) return j({ skipped: "no_active_deployment" });
  if (personaId) {
    const { data: persona } = await admin
      .from("agent_personas")
      .select("system_prompt")
      .eq("id", personaId)
      .maybeSingle();
    if (persona?.system_prompt) systemPrompt = persona.system_prompt;
  }
  systemPrompt = `${systemPrompt}\n\n${SYSTEM_PROMPT_GUARDRAILS}\n\n${HANDOFF_RULE}`;
  // Without this the agent had no access to the debt and answered
  // "não tenho acesso ao valor em aberto" even for imported debtors.
  const debtContext = await loadDebtContext(admin, accountId, conversationId);
  if (debtContext) systemPrompt = `${systemPrompt}\n\n${debtContext}`;

  // 5) Load short history (oldest → newest).
  const { data: recent } = await admin
    .from("messages")
    .select("content, sender_type, created_at")
    .eq("conversation_id", conversationId)
    .eq("private", false)
    .order("created_at", { ascending: false })
    .limit(CONTEXT_TURNS);
  const history = (recent ?? [])
    .reverse()
    .filter((m: any) => {
      const c = (m.content ?? "").trim();
      return c && c !== "[mensagem]" && c !== "[mídia]";
    })
    .map((m: any) => ({
      role: (m.sender_type === "Contact" ? "user" : "assistant") as "user" | "assistant",
      content: m.content as string,
    }));

  // 6) Generate reply.
  const lovableKey = Deno.env.get("LOVABLE_API_KEY") ?? "";
  if (!lovableKey) return j({ error: "missing_LOVABLE_API_KEY" }, 500);

  let reply = "";
  try {
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": lovableKey,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        store: false,
        reasoning: { effort: "low", summary: "auto" },
        include: ["reasoning.encrypted_content"],
        instructions: systemPrompt,
        input: history.map((message) => ({
          role: message.role,
          content: [{
            type: message.role === "assistant" ? "output_text" : "input_text",
            text: message.content,
          }],
        })),
      }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error(`[persona-auto-reply] gateway ${res.status}: ${errBody.slice(0, 200)}`);
      return j({ error: "llm_failed", status: res.status }, 502);
    }
    if (!res.body) return j({ error: "llm_empty_stream" }, 502);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.type === "response.output_text.delta" && typeof event.delta === "string") reply += event.delta;
        } catch { /* ignore malformed non-data events */ }
      }
    }
    reply = reply.trim();
  } catch (err) {
    console.error("[persona-auto-reply] llm error", err);
    return j({ error: "llm_exception" }, 502);
  }

  // Strip residual placeholders just in case.
  reply = reply.replace(/\[(?:Nome do Cliente|Seu Nome|Nome da Empresa|valor|data|valor da dívida|data do vencimento|Valor do Débito)\]/gi, "").trim();
  if (!reply) return j({ skipped: "empty_reply" });

  // 7) Persist the AgentBot message (no dispatch from this function — the
  // channel-specific sender owns delivery).
  const { data: inserted, error: insErr } = await admin
    .from("messages")
    .insert({
      account_id: accountId,
      conversation_id: conversationId,
      inbox_id: inboxId ?? null,
      content: reply,
      content_type: 0,
      message_type: 1,
      sender_type: "AgentBot",
      sender_id: personaId,
      private: false,
      content_attributes: { kind: "auto_reply" },
    })
    .select("id")
    .single();
  if (insErr) {
    console.error("[persona-auto-reply] insert failed", insErr.message);
    return j({ error: "insert_failed" }, 500);
  }

  // 8) Deliver only through a confirmed Evolution connection.
  try {
    const { data: conversation } = await admin.from("conversations").select("contact_id").eq("id", conversationId).maybeSingle();
    const { data: contact } = conversation?.contact_id
      ? await admin.from("contacts").select("phone_number, identifier").eq("id", conversation.contact_id).maybeSingle()
      : { data: null };
    const { data: inbox } = await admin.from("inboxes").select("channel_id, channel_type").eq("id", inboxId).maybeSingle();
    const { data: channel } = inbox?.channel_id
      ? await admin.from("channels").select("config, enabled").eq("id", inbox.channel_id).maybeSingle()
      : { data: null };
    const cfg = (channel?.config ?? {}) as Record<string, string>;
    const number = contact?.phone_number || contact?.identifier?.match(/evolution:whatsapp:([^@:]+)/)?.[1] || "";
    if (inbox?.channel_type !== "whatsapp" || !channel?.enabled || cfg.evolution_instance_status !== "connected") {
      return j({ error: "channel_not_connected", messageId: inserted.id }, 409);
    }
    if (!cfg.evolution_url || !cfg.evolution_api_key || !cfg.evolution_instance_name || !number) {
      return j({ error: "channel_not_configured", messageId: inserted.id }, 409);
    }
    const sent = await sendText({ url: cfg.evolution_url, apiKey: cfg.evolution_api_key, instanceName: cfg.evolution_instance_name, number, text: reply });
    await admin.from("messages").update({ source_id: sent.messageId ?? null }).eq("id", inserted.id);
  } catch (err) {
    console.warn("[persona-auto-reply] Evolution send failed", err);
    return j({ error: "send_failed", messageId: inserted.id }, 502);
  }

  // 9) Best-effort: extrair acordo da conversa (mesma lógica das ligações).
  // Pré-filtro barato: só dispara se a última msg do contato tem palavra-chave
  // de pagamento e a conversa já tem ≥4 mensagens não-vazias (2 turnos).
  try {
    const PAYMENT_HINTS = /(pag|acord|pix|boleto|parcel|aceito|combinad|posso|vou|amanh[aã]|hoje|sexta|segunda|ter[cç]a|quart|quint|s[aá]bad|domin|d[ií]a|fech|ok|tudo bem|isso|sim|topo|sim,)/i;
    if (PAYMENT_HINTS.test(txt) && (recent ?? []).length >= 4) {
      // não bloqueia — fire and forget (mas await pra capturar erro de invoke)
      await admin.functions.invoke("collection-extract-arrangement", {
        body: {
          conversation_id: conversationId,
          contact_id: undefined, // será resolvido via conversations.contact_id
        },
      });
    }
  } catch (err) {
    console.warn("[persona-auto-reply] arrangement extraction failed", err);
  }

  return j({ ok: true, messageId: inserted.id });
});

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brDate = (iso: string | null) => {
  if (!iso) return "sem vencimento";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

/**
 * Real collection data for the conversation's contact: open debts plus the
 * company's negotiation limits (same sources the WhatsApp campaign uses for
 * the opening message). Returned as an instructions block; null when the
 * conversation has no contact.
 */
export async function loadDebtContext(
  // deno-lint-ignore no-explicit-any
  admin: any,
  accountId: string,
  conversationId: string,
): Promise<string | null> {
  const { data: conv } = await admin
    .from("conversations")
    .select("contact_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv?.contact_id) return null;

  const [{ data: contact }, { data: debts }, { data: settings }] = await Promise.all([
    admin.from("contacts").select("name").eq("id", conv.contact_id).maybeSingle(),
    admin
      .from("debts")
      .select("valor_atual, vencimento, descricao, origem")
      .eq("account_id", accountId)
      .eq("contact_id", conv.contact_id)
      .in("status", ["aberto", "em_negociacao"])
      .order("vencimento", { ascending: true })
      .limit(20),
    admin
      .from("company_settings")
      .select("company_name, default_discount_pct, default_max_installments")
      .eq("account_id", accountId)
      .maybeSingle(),
  ]);

  const lines = [
    "DADOS DA COBRANÇA (fonte: cadastro do sistema — use SOMENTE estes dados, nunca invente valores, datas ou condições):",
    `- Cliente: ${contact?.name ?? "não informado"}`,
    `- Empresa credora: ${settings?.company_name ?? "não informada"}`,
  ];
  const open = (debts ?? []) as Array<{ valor_atual: number | null; vencimento: string | null; descricao: string | null; origem: string | null }>;
  if (open.length === 0) {
    lines.push("- Não há dívida em aberto registrada para este cliente. Não cite valores; ofereça passar o atendimento para a equipe (siga as regras de QUANDO PASSAR O ATENDIMENTO).");
  } else {
    const total = open.reduce((sum, d) => sum + Number(d.valor_atual ?? 0), 0);
    lines.push(`- Dívidas em aberto: ${open.length} (total ${brl(total)})`);
    for (const d of open) {
      const desc = d.descricao || d.origem;
      lines.push(`  • ${brl(Number(d.valor_atual ?? 0))}, vencimento ${brDate(d.vencimento)}${desc ? ` — ${desc}` : ""}`);
    }
    lines.push(
      `- Desconto máximo à vista: ${settings?.default_discount_pct ?? 0}%. Parcelamento máximo: ${settings?.default_max_installments ?? 1}x. Não ofereça nada além desses limites.`,
      "- Depois que o cliente confirmar a identidade, informe o valor em aberto e as opções de pagamento.",
    );
  }
  return lines.join("\n");
}
