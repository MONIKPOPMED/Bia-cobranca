// ElevenLabs calls this webhook at the start of each call (inbound or outbound).
// Goal: hand the agent the full negotiation context (debt + rules) so it
// never has to invent values and never violates discount/installment caps.
//
// EL payload (POST):
//   { caller_id, agent_id, called_number, call_sid,
//     dynamic_variables?: {...} }   ← when outbound, EL forwards what we sent
//
// Our response (200):
//   { conversation_config_override?: {...}, dynamic_variables?: {...} }
//
// Auth: shared secret via x-el-webhook-secret header.
// verify_jwt = false (machine-to-machine).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { buildSystemPromptWithGuardrails } from "../_shared/voice/collection-guardrails.ts";
import { HANDOFF_RULE } from "../_shared/handoff.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  const expected = Deno.env.get("ELEVENLABS_WEBHOOK_SECRET") ?? "";
  const received = req.headers.get("x-el-webhook-secret") ?? "";
  if (expected && !timingSafeEqual(expected, received)) {
    return new Response("Forbidden", { status: 403, headers: corsHeaders });
  }

  let payload: {
    caller_id?: string;
    agent_id?: string;
    called_number?: string;
    call_sid?: string;
    dynamic_variables?: Record<string, any>;
  };
  try {
    payload = await req.json();
  } catch {
    return j({});
  }

  // EL forwards the dynamic_variables we sent in the outbound POST. For
  // outbound campaign calls these already include the full negotiation
  // context (valor, vencimento, desconto_pct, max_parcelas, etc.). We must
  // PRESERVE them and only enrich — never overwrite — so the agent gets the
  // exact rules saved on the campaign.
  const incomingVars: Record<string, any> = (payload.dynamic_variables ?? {}) as any;
  const isOutbound = Boolean(
    incomingVars.campaign_contact_id || incomingVars.debt_id || incomingVars.valor_formatado,
  );

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Resolve persona from agent_id → find account.
  let accountId: string | null = null;
  let personaName = "Nina";
  let personaSystemPrompt: string | null = null;
  let personaFirstMessage: string | null = null;
  if (payload.agent_id) {
    const { data: persona } = await admin
      .from("agent_personas")
      .select("account_id, name, system_prompt, first_message")
      .eq("elevenlabs_agent_id", payload.agent_id)
      .maybeSingle();
    if (persona) {
      accountId = persona.account_id;
      personaName = persona.name ?? personaName;
      personaSystemPrompt = persona.system_prompt;
      personaFirstMessage = (persona.first_message as string | null) ?? null;
    }
  }

  const callerE164 = payload.caller_id ?? "";
  let contactName: string | null = null;
  let contactId: string | null = null;
  let openConvCount = 0;
  let lastSummary: string | null = null;

  if (accountId && callerE164) {
    const { data: contact } = await admin
      .from("contacts")
      .select("id, name")
      .eq("account_id", accountId)
      .eq("phone_number", callerE164)
      .maybeSingle();
    if (contact) {
      contactId = contact.id;
      contactName = contact.name;
      const { count } = await admin
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("account_id", accountId)
        .eq("contact_id", contact.id)
        .eq("status", 0);
      openConvCount = count ?? 0;

      const { data: dossier } = await admin
        .from("contact_dossiers")
        .select("briefing")
        .eq("contact_id", contact.id)
        .maybeSingle();
      lastSummary = dossier?.briefing ?? null;
    }
  }

  // ── Build negotiation variables ──────────────────────────
  // Outbound: trust what dispatcher already sent.
  // Inbound: lookup highest open debt + company defaults so the agent
  // can negotiate without inventing numbers.
  const negotiationVars: Record<string, string> = {};

  if (!isOutbound && accountId && contactId) {
    const { data: settings } = await admin
      .from("company_settings")
      .select(
        "company_name, default_discount_pct, default_max_installments, support_phone",
      )
      .eq("account_id", accountId)
      .maybeSingle();

    const { data: debt } = await admin
      .from("debts")
      .select("id, valor_atual, vencimento, origem, descricao")
      .eq("account_id", accountId)
      .eq("contact_id", contactId)
      .in("status", ["aberto", "em_negociacao"])
      .order("valor_atual", { ascending: false })
      .limit(1)
      .maybeSingle();

    const discountPct = Number(settings?.default_discount_pct ?? 10);
    const maxInstallments = Number(settings?.default_max_installments ?? 6);

    negotiationVars.company_name = settings?.company_name ?? "sua empresa";
    negotiationVars.agent_name = personaName;
    negotiationVars.desconto_pct = String(discountPct);
    negotiationVars.max_parcelas = String(maxInstallments);
    negotiationVars.valor_min_parcela_formatado = "R$ 50,00";
    negotiationVars.first_due_min_days = "3";
    negotiationVars.first_due_max_days = "10";
    negotiationVars.support_phone = settings?.support_phone ?? "";

    if (debt) {
      const valor = Number(debt.valor_atual);
      negotiationVars.valor_formatado = new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(valor);
      negotiationVars.vencimento_br = new Date(debt.vencimento).toLocaleDateString(
        "pt-BR",
        { timeZone: "America/Sao_Paulo" },
      );
      const dias = Math.max(
        0,
        Math.floor(
          (Date.now() - new Date(debt.vencimento).getTime()) /
            (1000 * 60 * 60 * 24),
        ),
      );
      negotiationVars.dias_atraso = String(dias);
      negotiationVars.origem_debito = (debt.origem as string) ?? "débito";
      negotiationVars.descricao = (debt.descricao as string) ?? "";
      negotiationVars.debt_id = String(debt.id);
    }

    if (contactName) {
      negotiationVars.debtor_name = contactName.split(" ")[0];
    }
  }

  // Merge: incoming (from dispatcher) wins; we only fill gaps.
  // agent_name SEMPRE vem da persona (não deixar dispatcher sobrescrever).
  const dynamicVariables: Record<string, string> = {
    ...negotiationVars,
    ...Object.fromEntries(
      Object.entries(incomingVars).map(([k, v]) => [k, String(v ?? "")]),
    ),
    agent_name: personaName,
    customer_name: contactName ?? incomingVars.debtor_name ?? "cliente",
    caller_phone: callerE164,
    open_conversations: String(openConvCount),
    has_history: openConvCount > 0 ? "sim" : "não",
  };

  // Build enriched system prompt prefix with caller context.
  const contextLines: string[] = [];
  if (contactName) contextLines.push(`O cliente se chama ${contactName}.`);
  if (openConvCount > 0) contextLines.push(`Tem ${openConvCount} conversa(s) aberta(s) no sistema.`);
  if (lastSummary) contextLines.push(`Resumo do cliente: ${lastSummary.slice(0, 300)}`);

  const contextBlock = contextLines.length > 0
    ? `\n\n===CONTEXTO DO CLIENTE===\n${contextLines.join("\n")}\n===FIM===`
    : "";

  // Mesma lógica do agent-sync: garante que o prompt enviado ao runtime
  // SEMPRE contenha o header de regras de cobrança (valor correto, tetos,
  // compliance), mesmo se a persona tiver um sysprompt curto sem variáveis.
  const promptWithGuardrails = buildSystemPromptWithGuardrails(personaSystemPrompt);
  const enrichedPrompt = `${promptWithGuardrails}${contextBlock}\n\n${HANDOFF_RULE}`;

  // first_message: respeita o opener cadastrado na persona — só substitui
  // as variáveis dinâmicas. O aviso de gravação fica no system_prompt
  // (regra obrigatória do template) para não engessar o opener customizado.
  // Fallback hardcoded só quando a persona NÃO tem first_message.
  const debtorName = dynamicVariables.debtor_name || contactName?.split(" ")[0] || "";
  const companyName = dynamicVariables.company_name || "nossa empresa";

  let greeting: string;
  if (personaFirstMessage && personaFirstMessage.trim().length > 0) {
    // Substitui {{var}} no opener salvo. Vars não fornecidas viram "".
    greeting = personaFirstMessage.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
      const v = dynamicVariables[key];
      return v !== undefined && v !== null ? String(v) : "";
    });
  } else {
    greeting = debtorName
      ? `Olá, ${debtorName}. Aqui é ${personaName} da ${companyName}. Esta chamada pode ser gravada. Eu posso falar com o senhor, a senhora?`
      : `Olá! Aqui é ${personaName} da ${companyName}. Esta chamada pode ser gravada. Como posso te ajudar?`;
  }

  const response: Record<string, any> = {
    conversation_config_override: {
      agent: {
        prompt: { prompt: enrichedPrompt },
        first_message: greeting,
        language: "pt",
      },
    },
    dynamic_variables: dynamicVariables,
  };

  console.log(
    `[el-personalization] agent=${payload.agent_id} caller=${callerE164} contact=${contactName ?? "(new)"} outbound=${isOutbound} vars=${Object.keys(dynamicVariables).length}`,
  );

  return j(response);
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
