// Sync a Nexus persona to an ElevenLabs Conversational AI agent.
//
// Called by:
//   1. The /agents edit dialog when the user saves a persona (via client).
//   2. Future: automated nightly reconciliation cron.
//
// On first sync: creates the EL agent and writes elevenlabs_agent_id back.
// On subsequent syncs: PATCHes the agent with the latest prompt + voice.
//
// EL Agent ← Persona fields:
//   name              → name
//   system_prompt     → conversational_config.agent.prompt.prompt
//   voice_clone_id    → conversational_config.tts.voice_id
//   description       → used in first_message heuristic
//   elevenlabs_agent_id → persisted back after create
//
// Also configures:
//   - Personalization webhook → our elevenlabs-personalization fn (per-caller ctx)
//   - Post-call webhook       → our elevenlabs-events fn (transcript + analytics)
//   - Language: pt-BR
//   - LLM: gemini-2.5-flash (configurable per-persona in future)
//   - Model: eleven_flash_v2_5 (required for non-English agents)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { resolveCredentialsForAccount, ElevenLabsError } from "../_shared/elevenlabs/index.ts";
import { buildSystemPromptWithGuardrails } from "../_shared/voice/collection-guardrails.ts";
import { HANDOFF_RULE } from "../_shared/handoff.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EL_BASE = "https://api.elevenlabs.io";

type KnowledgeBaseType = "url" | "text" | "file" | "folder";

interface KnowledgeBaseLocator {
  id: string;
  name: string;
  type: KnowledgeBaseType;
  usage_mode: "auto";
}

async function elRequest(
  apiKey: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<any> {
  const res = await fetch(`${EL_BASE}${path}`, {
    method,
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`EL ${method} ${path} → ${res.status}: ${txt.slice(0, 300)}`);
  }
  return res.json().catch(() => ({}));
}

function isKnowledgeBaseType(value: unknown): value is KnowledgeBaseType {
  return value === "url" || value === "text" || value === "file" || value === "folder";
}

async function loadKnowledgeBaseLocators(
  apiKey: string,
  ids: unknown,
): Promise<KnowledgeBaseLocator[]> {
  if (!Array.isArray(ids) || ids.length === 0) return [];

  return await Promise.all(ids.filter((id): id is string => typeof id === "string").map(async (id) => {
    const document = await elRequest(apiKey, "GET", `/v1/convai/knowledge-base/${id}`);
    if (typeof document?.name !== "string" || !isKnowledgeBaseType(document?.type)) {
      throw new Error(`Documento da base de conhecimento inválido: ${id}`);
    }
    return {
      id,
      name: document.name,
      type: document.type,
      usage_mode: "auto",
    };
  }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return j({ error: "unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user?.id) return j({ error: "unauthorized" }, 401);

  let body: { persona_id: string };
  try {
    body = await req.json();
  } catch {
    return j({ error: "body must be JSON" }, 400);
  }
  if (!body.persona_id) return j({ error: "persona_id required" }, 400);

  const { data: persona, error: pErr } = await admin
    .from("agent_personas")
    .select("*")
    .eq("id", body.persona_id)
    .maybeSingle();
  if (pErr || !persona) return j({ error: "persona not found" }, 404);

  // Verify caller belongs to the same account.
  const { data: membership } = await admin
    .from("account_users")
    .select("account_id")
    .eq("user_id", u.user.id)
    .eq("account_id", persona.account_id)
    .maybeSingle();
  if (!membership) return j({ error: "forbidden" }, 403);

  let apiKey = "";
  try {
    const creds = await resolveCredentialsForAccount(admin, persona.account_id);
    apiKey = creds.apiKey;
  } catch (e) {
    const msg = e instanceof ElevenLabsError ? e.message : (e instanceof Error ? e.message : "ElevenLabs key unavailable");
    return j({ error: msg }, 503);
  }

  // Build the webhook URLs pointing back to our edge functions.
  const nexusBase = supabaseUrl.replace(/\/$/, "");
  const personalizationWebhook = `${nexusBase}/functions/v1/elevenlabs-personalization`;
  const eventsWebhook = `${nexusBase}/functions/v1/elevenlabs-events`;
  const elWebhookSecret = Deno.env.get("ELEVENLABS_WEBHOOK_SECRET") ?? "";

  const voiceId = persona.voice_clone_id ?? "cjVigY5qzO86Huf0OWal";
  const rawSystemPrompt = (persona.system_prompt as string | null) ?? "";
  // Injeta header de regras de cobrança automaticamente — usuário pode
  // escrever prompt curto sem variáveis e mesmo assim o agente recebe
  // contexto + tetos + compliance.
  // HANDOFF_RULE vai depois do prompt da persona para valer mesmo quando a
  // persona já traz o template completo (que pula o header de guardrails).
  const systemPrompt = `${buildSystemPromptWithGuardrails(rawSystemPrompt)}\n\n${HANDOFF_RULE}`;
  const firstMessage = (persona.first_message as string | null) ??
    `Olá, {{debtor_name}}. Aqui é {{agent_name}} da {{company_name}}. Esta chamada pode ser gravada. Posso falar com o senhor, a senhora?`;

  // Advanced config with fallback defaults for personas created before
  // the migration added these columns.
  const turnCfg = (persona.turn_config ?? {}) as Record<string, any>;
  const ttsCfg = (persona.tts_config ?? {}) as Record<string, any>;
  const asrKeywords = Array.isArray(persona.asr_keywords) ? persona.asr_keywords : [];
  const llmModel = (persona.llm_model as string | null) ?? "gemini-2.5-flash";
  const llmTemperature = typeof persona.llm_temperature === "number"
    ? persona.llm_temperature
    : 0.5;
  // Default 400 (era 150). Com 150 o agente cortava no meio da frase ao
  // apresentar débito + ofertas. 400 cobre apresentação completa sem ficar
  // verboso demais (ainda é "respostas curtas" — EL/TTS aceita bem).
  const llmMaxTokens = typeof persona.llm_max_tokens === "number" && persona.llm_max_tokens >= 200
    ? persona.llm_max_tokens
    : 400;
  let knowledgeBase: KnowledgeBaseLocator[] = [];
  try {
    knowledgeBase = await loadKnowledgeBaseLocators(
      apiKey,
      persona.elevenlabs_knowledge_base_ids,
    );
  } catch (error) {
    console.error("[el-agent-sync] failed to load knowledge-base documents", error);
    return j({ error: "Não foi possível carregar os documentos da base de conhecimento na ElevenLabs" }, 502);
  }

  // Defaults pra cada {{var}} usada no prompt. Se a chamada não passar a var
  // (ex.: ligação manual sem débito vinculado), o EL substitui pelo default
  // ao invés de deixar literal "{{valor_formatado}}" no prompt — o que faria
  // o LLM improvisar um valor.
  const dynamicVariablePlaceholders: Record<string, string> = {
    company_name: "nossa empresa",
    agent_name: persona.name ?? "Nina",
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
  };

  // Critérios de avaliação automática — rodam ao final de cada chamada.
  const evaluationCriteria = [
    {
      id: "aviso_gravacao",
      name: "Avisou que a chamada pode ser gravada",
      conversation_goal_prompt:
        "O agente deve informar nos primeiros 30 segundos que a chamada pode ser gravada. Aprovado se mencionou explicitamente gravação. Reprovado se não mencionou.",
    },
    {
      id: "confirmou_identidade",
      name: "Confirmou identidade antes de discutir débito",
      conversation_goal_prompt:
        "O agente deve confirmar que está falando com o devedor ANTES de mencionar valor, vencimento ou qualquer detalhe do débito. Aprovado se confirmou. Reprovado se discutiu débito sem confirmar.",
    },
    {
      id: "valor_correto",
      name: "Citou o valor correto da dívida",
      conversation_goal_prompt:
        "O valor real da dívida é {{valor_formatado}}. Aprovado se o agente citou ESTE valor. Reprovado se citou qualquer outro valor (ex.: inventou um número diferente).",
    },
    {
      id: "respeitou_desconto",
      name: "Não ofereceu desconto acima do permitido",
      conversation_goal_prompt:
        "O desconto máximo autorizado é {{desconto_pct}}%. Aprovado se NÃO ofereceu mais. Reprovado caso contrário.",
    },
    {
      id: "respeitou_parcelas",
      name: "Não ofereceu mais parcelas do que o permitido",
      conversation_goal_prompt:
        "O parcelamento máximo é {{max_parcelas}}x. Aprovado se NÃO ofereceu mais. Reprovado caso contrário.",
    },
    {
      id: "respeitou_dnc",
      name: "Encerrou educadamente em pedido de DNC",
      conversation_goal_prompt:
        "Se o devedor pediu DNC, agente deve concordar e encerrar sem insistir. N/A se não houve pedido.",
    },
  ];

  // ÚNICA chave de config — `conversation_config` (singular) é a oficial da API EL.
  // Antes tínhamos `conversational_config` E `conversation_config` duplicados; EL
  // descartava silenciosamente o `conversational_config` (incluindo personalization
  // webhook, dynamic var defaults, turn config, first_message). Agora tudo num lugar só.
  const agentBody = {
    name: `Nexus: ${persona.name}`,
    conversation_config: {
      asr: {
        quality: "high",
        // "elevenlabs" (Original ASR) was removed by ElevenLabs — PATCH now
        // fails with 400 original_asr_removed; Scribe v2 Realtime replaces it.
        provider: "scribe_realtime",
        keywords: asrKeywords,
        // Phone audio: twilio-incoming connects calls via EL register-call,
        // which requires μ-law 8 kHz on both directions.
        user_input_audio_format: "ulaw_8000",
      },
      turn: {
        turn_timeout: typeof turnCfg.turn_timeout === "number" ? turnCfg.turn_timeout : 3,
        silence_end_call_timeout:
          typeof turnCfg.silence_end_call_timeout === "number"
            ? turnCfg.silence_end_call_timeout
            : 30,
        turn_eagerness: (turnCfg.turn_eagerness as string) ?? "eager",
      },
      tts: {
        model_id: "eleven_flash_v2_5",
        voice_id: voiceId,
        stability: typeof ttsCfg.stability === "number" ? ttsCfg.stability : 0.35,
        speed: typeof ttsCfg.speed === "number" ? ttsCfg.speed : 1.05,
        similarity_boost:
          typeof ttsCfg.similarity_boost === "number" ? ttsCfg.similarity_boost : 0.85,
        agent_output_audio_format: "ulaw_8000",
      },
      conversation: {
        text_only: false,
        max_duration_seconds: 600,
      },
      agent: {
        first_message: firstMessage,
        language: "pt",
        dynamic_variables: {
          dynamic_variable_placeholders: dynamicVariablePlaceholders,
        },
        prompt: {
          prompt: systemPrompt,
          llm: llmModel,
          temperature: llmTemperature,
          max_tokens: llmMaxTokens,
          tools: [
            {
              type: "webhook",
              name: "registrar_acordo",
              description:
                "Registra o acordo aceito pelo devedor. CHAME IMEDIATAMENTE quando o devedor confirmar valor + parcelas + método. NÃO inclua conversation_id nem debt_id — esses IDs são preenchidos automaticamente pelo sistema. Apenas envie valor_negociado, num_parcelas, metodo e primeiro_vencimento_dias. Sem essa chamada, o acordo NÃO existe. Os valores devem respeitar desconto_pct e max_parcelas. Se a tool retornar erro, NÃO diga ao cliente que houve problema técnico — apenas tente novamente uma única vez.",
              api_schema: {
                url: `${nexusBase}/functions/v1/arrangement-from-agent-tool`,
                method: "POST",
                request_headers: {
                  ...(elWebhookSecret ? { "x-el-webhook-secret": elWebhookSecret } : {}),
                  // EL injeta automaticamente as system/dynamic variables nos headers
                  // — esse é o canal correto pra passar IDs sem o LLM precisar lembrar.
                  "x-conversation-id": "{{system__conversation_id}}",
                  "x-agent-id": "{{system__agent_id}}",
                  "x-debt-id": "{{debt_id}}",
                  "x-campaign-contact-id": "{{campaign_contact_id}}",
                },
                request_body_schema: {
                  type: "object",
                  required: ["valor_negociado"],
                  properties: {
                    valor_negociado: {
                      type: "number",
                      description:
                        "Valor TOTAL combinado em reais (ex.: 900.50). À vista com desconto = valor com desconto. Parcelado = soma das parcelas.",
                    },
                    num_parcelas: {
                      type: "integer",
                      description:
                        "Quantidade de parcelas. 1 = à vista. NUNCA exceda max_parcelas.",
                    },
                    metodo: {
                      type: "string",
                      enum: ["pix", "boleto", "cartao", "parcelado"],
                      description: "Forma de pagamento combinada.",
                    },
                    primeiro_vencimento_dias: {
                      type: "integer",
                      description:
                        "Dias até o 1º vencimento, dentro de first_due_min_days–first_due_max_days.",
                    },
                    observacao: {
                      type: "string",
                      description: "Observação curta (opcional).",
                    },
                  },
                },
              },
            },
          ],
          tool_ids: [],
          knowledge_base: knowledgeBase,
        },
      },
    },
    platform_settings: {
      // Webhook de personalização — EL chama no início de toda chamada
      // (inbound E outbound) e nós retornamos contexto enriquecido.
      // ANTES: estava em `conversational_config.initiation_client_data_webhook`
      // (chave inválida) → EL ignorava e webhook nunca disparava.
      ...(personalizationWebhook ? {
        call_initiation: {
          enable_conversation_initiation_webhook: true,
          conversation_initiation_webhook: {
            url: personalizationWebhook,
            request_headers: elWebhookSecret
              ? { "x-el-webhook-secret": elWebhookSecret }
              : {},
          },
        },
      } : {}),
      ...(eventsWebhook ? {
        webhook: {
          url: eventsWebhook,
          secret: elWebhookSecret || undefined,
        },
      } : {}),
      evaluation: {
        criteria: evaluationCriteria,
      },
    },
  };


  let elAgentId = persona.elevenlabs_agent_id as string | null;

  try {
    if (elAgentId) {
      // Update existing agent.
      await elRequest(apiKey, "PATCH", `/v1/convai/agents/${elAgentId}`, agentBody);
      console.log(`[el-agent-sync] PATCH agent=${elAgentId} persona=${persona.id}`);
    } else {
      // Create new agent.
      const created = await elRequest(apiKey, "POST", "/v1/convai/agents/create", agentBody);
      elAgentId = created.agent_id ?? created.id;
      console.log(`[el-agent-sync] POST agent=${elAgentId} persona=${persona.id}`);
    }
  } catch (err) {
    console.error("[el-agent-sync] EL API error", err);
    return j({ error: String(err) }, 502);
  }

  // Write back the el agent id.
  const { error: updErr } = await admin
    .from("agent_personas")
    .update({ elevenlabs_agent_id: elAgentId })
    .eq("id", persona.id);
  if (updErr) {
    console.error("[el-agent-sync] failed to write back agent_id", updErr);
  }

  return j({ ok: true, elevenlabs_agent_id: elAgentId, persona_id: persona.id });
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
