# cobrAI (Bia-cobranca)

Agente de cobrança por voz e WhatsApp ("Bia") da POPMED. Tudo em português do Brasil.

> O `README.md` descreve uma stack aspiracional (Express, wouter, Meta Cloud API) que **não** é a deste código. Use este arquivo como referência.

## Stack real

- **App**: TanStack Start (React) + Vite + Tailwind, gerado/editado pelo **Lovable** (projeto `8dfe8a99-797f-4664-8595-b57321b059c6`, "Bia IA cobrança ok"; site público `https://bia-cobranca.lovable.app` desde 30/09 — o antigo `nexus-ai-voice-memories.lovable.app` dá 404). O cron da campanha WhatsApp chama `<site>/api/public/whatsapp-campaign-dispatch` (URL fixa na migração 0008): se o endereço mudar de novo, peça ao Lovable para atualizar o cron e a Site URL do login.
- **Backend**: Lovable Cloud = Supabase (`qsbsnsoswkzrrydkiclz`). Edge functions em Deno em `supabase/functions/`. Server functions do app em `src/lib/*.functions.ts`.
- **Voz**: Twilio (conta `AC47fb…`, números como *Verified Caller ID*) + ElevenLabs Conversational AI (agente da persona Bia).
- **WhatsApp**: Evolution API v2 (instância `nexus_ebf3eba4002d_63639915`), webhook → `evolution-incoming`.
- **LLM das respostas de WhatsApp e campanhas**: Lovable AI Gateway (`LOVABLE_API_KEY`).

## Como publicar uma mudança

1. Branch → PR → merge em `main` (GitHub `MONIKPOPMED/Bia-cobranca`, antigo `nexus-ai-voice-memories`; `gh` logado como MONIKPOPMED). O merge é feito pela usuária no GitHub (o Claude Code bloqueia merge do próprio PR). Crie a branch a partir de um `main` atualizado: **o Lovable também commita direto em `main`** (`git pull` antes de começar).
2. **Frontend**: o Lovable sincroniza e remonta a prévia sozinho. Para ir ao site público é preciso clicar em **Publish** no Lovable (publica tudo que estiver pendente).
3. **Edge functions NÃO são publicadas automaticamente** a partir do GitHub. Peça no chat do projeto no Lovable, uma por vez ou em lista:
   > Faça o deploy da(s) edge function(s) `X` exatamente como está no código atual (veio do GitHub, PR #N). Não altere nenhum código, só publique no backend.

   Confirme depois (ex.: a resposta muda, ou uma chamada sem auth devolve o erro novo). **Cada pedido gasta crédito do Lovable**: junte as funções num pedido só. Se pausar por falta de crédito, depois da compra aparece o botão **Retomar**. Função nova chamada pela ElevenLabs precisa ir com `verify_jwt = false` (peça no deploy; não mexa no `supabase/config.toml`, que só tem o `project_id`).
4. O item "Build malsucedido" no histórico do Lovable é **texto oculto na página**, não o status real — confira a prévia (`__lovable_sha` do link) em vez disso.

## Verificação local

- Prévia local: `npm run dev -- --port 8082 --strictPort` (a 8080 é da Eva; config `cobrai-dev` em `.claude/launch.json`).
- Dependências: `npx bun@1 install --frozen-lockfile` (o `bun.lock` manda; o `package-lock.json` está desatualizado).
- Typecheck do app: `npx -p typescript@5 tsc --noEmit -p tsconfig.json`. Build: `npm run build` (regenera `src/routeTree.gen.ts` — descarte se só mudou fim de linha).
- Edge functions: `npx deno@2 check --no-lock supabase/functions/<fn>/index.ts`.
- ESLint no Windows acusa centenas de erros de CRLF/prettier já existentes; compare com `main` usando o conteúdo do git, não o working copy.

## Armadilhas já resolvidas (não reintroduza)

- **Credenciais por workspace**: Twilio e ElevenLabs vêm do cofre da conta (`loadAccountTwilioCreds`, `resolveCredentialsForAccount`). As variáveis globais `TWILIO_AUTH_TOKEN` / `ELEVENLABS_API_KEY` são de contas antigas — use só como fallback.
- **Webhooks Twilio** (`twilio-incoming/status/recording-callback/sms-incoming`) validam a assinatura com `resolveWebhookAuthTokens` (token da conta do payload) + `validateTwilioSignatureAny`.
- **Ligação → Bia**: `twilio-incoming` usa `POST /v1/convai/twilio/register-call` da ElevenLabs e devolve o TwiML dela. Não aponte `<Stream>` para o WSS de `get_signed_url` (fala outro protocolo; a ligação cai em 1 s). O agente precisa de áudio `ulaw_8000` e ASR `scribe_realtime` (o provider `elevenlabs` foi removido pela ElevenLabs).
- Em ligação de saída, `inbound_behavior = voicemail` é tratado como IA (números "só saída" ficam como voicemail).
- `StatusCallbackEvent` vai como lista (um parâmetro por evento); `Timeout` padrão 60 s (celular BR demora a tocar).
- **`src/start.ts`** registra `attachSupabaseAuth` como `functionMiddleware`; sem ele toda server function com `requireSupabaseAuth` responde "Unauthorized: No authorization header provided".
- **Evolution v2** manda eventos com ponto (`messages.upsert`); `evolution-incoming` normaliza para `MESSAGES_UPSERT`. A tabela `messages` **não tem** índice único `(account_id, source_id)` — não use `upsert(onConflict)` nela. JIDs de celular BR podem vir **sem o 9º dígito**: o contato é achado por `phoneVariants`.
- `persona-auto-reply` injeta as dívidas abertas + limites de `company_settings` (`loadDebtContext`) e a regra de encaminhamento (`_shared/handoff.ts`).
- Cron da campanha WhatsApp autentica com `LOVABLE_CRON_SECRET` (`authenticateCronRequest`).
- **Variáveis da Bia**: os `dynamic_variable_placeholders` do agente **não valem em ligação real** — sem as variáveis a ElevenLabs derruba a conversa em ~2 s ("Missing required dynamic variables in first message"). Toda ligação manda o conjunto completo via `buildCallDynamicVariables` (`_shared/voice/call-variables.ts`); a mesma lista vira placeholder no sync. Variável nova no prompt/tools → acrescente em `DEFAULT_DYNAMIC_VARIABLES`.
- **Diagnóstico de ligação**: `voice_calls.metadata.twilio_status` (código SIP da operadora), `source_id` = conversation_id da ElevenLabs (gravado pelo `twilio-incoming`), `metadata.el_termination_reason` / `el_error` (gravados pelo `voice-call-finalize`). A transcrição traz `conversation_turn_metrics` com a latência de cada etapa (ASR, LLM, TTS).

## Regras de negócio

- **Guard de discagem** (`_shared/voice/guard.ts`): seg–sex 9h–18h (America/Sao_Paulo), 60 min entre tentativas e 3 por dia **por número de destino** — tentativas bloqueadas também contam.
- **Números**: `+5548996056774` (6774) é o número da Bia — ligação (Caller ID verificado, `verified_caller_id_only`) e WhatsApp. `+5548996975445` (5445) é o **WhatsApp da equipe** (`company_settings.support_phone`, "WhatsApp da equipe" em Configurações); como número de telefone no app está desativado (não excluir: tem histórico).
- **Encaminhamento (regra de 07–08/10)**: a Bia tenta resolver; se não conseguir (ou o cliente pedir a equipe — no máximo uma pergunta antes), **a equipe assume pelo WhatsApp 5445**: recebe um resumo (`_shared/team-handoff.ts`: nome completo, WhatsApp do cliente, mensalidades, motivo/últimas falas) e chama o cliente. Nunca transfere ligação, nunca diz "humano". Horário: seg–sex, exceto feriados, 9h–12h30 e 13h30–17h (`SUPPORT_HOURS_TEXT`).
  - **WhatsApp**: a Bia termina a mensagem com `[[EQUIPE]]`; o `persona-auto-reply` avisa a equipe, diz ao cliente de qual número virá a mensagem e pausa a Bia na conversa (`additional_attributes.ai_paused`; reativar no Chat ao Vivo).
  - **Ligação**: ferramenta `passar_para_equipe` (função `voice-transfer-tool`, nome antigo mantido por já ter verify_jwt = false); a Bia fala "DDD quarenta e oito, final cinco, quatro, quatro, cinco" (`{{whatsapp_equipe_aviso}}`). Rede de segurança: se o modelo só falar e não chamar a ferramenta, o `voice-call-finalize` detecta na transcrição e avisa a equipe.
- **Ferramentas da EL** recebem o `conversation_id` como header `{ variable_name }` + campo de corpo com `dynamic_variable` (string `"{{…}}"` em header chegava literal); `findToolCall` ainda tem plano B (única ligação ativa).
- **Roteiro da Bia** fica no banco (`agent_personas.system_prompt`, persona `9d5fd87e-…`), não no código. Depois de editar, **re-sincronize** (`elevenlabs-agent-sync` / botão Re-sincronizar) para valer na ligação.
- **Pagamento (regra da POPMED, 30/09)**: só **à vista, PIX ou cartão — não existe parcelamento**. 1 ou 2 mensalidades em atraso: valor cheio e a Bia **não fala de desconto**. 3 ou mais: **10% de desconto** à vista. Na ligação, a regra é calculada em `debtVariables` e o link vai pelo WhatsApp (ferramenta `enviar_link_pagamento` → `voice-send-payment-link`).
- **Links fixos** (só para UMA mensalidade; `_shared/payment-links.ts` e roteiro): PIX `https://popmed.com.br/produto/popmed-plano-mensal-ia2-pix/`, cartão `https://popmed.com.br/produto/popmed-plano-mensal-ia2-cc/`. Com 2+ mensalidades a equipe manda o link (ainda não existem links para esses casos).
- **Tom**: o roteiro tem a seção "TOM DE ATENDIMENTO" (saudação do horário, primeiro nome, "Posso te ajudar em mais alguma coisa?", emoji ≤1 só no WhatsApp). Nunca pedir CPF ou documento.

## Cuidado

- Ligações e campanhas de WhatsApp atingem **pessoas reais** (a Carteira tem devedores reais). Teste só com números combinados.
- Não commite segredos. O `.env` contém apenas valores públicos (URL e publishable key do Supabase).

## Campanhas

- **Ligação**: `voice-campaign-dispatch` roda pelo pg_cron a cada 1 min (migrações 0009/0010, header `x-cron-secret`). Número sem EL (o 6774) liga pela Twilio → `twilio-incoming` → Bia. No fim da ligação o `twilio-status` fecha o contato (`completed`/`failed`) e a campanha (`completed`) quando não sobra ninguém. Use modo **Conversacional**. Testada de ponta a ponta em 09/10.
- **WhatsApp**: aba WhatsApp de Campanhas; cron a cada 5 min chama `https://bia-cobranca.lovable.app/api/public/whatsapp-campaign-dispatch`.
- **Carteira**: entra por CSV (`debtors-import-csv`; só `.csv`). Uma linha por mensalidade; mesmo telefone = mesmo cliente; duplicada só se telefone + vencimento + valor iguais (reimportar não duplica). A planilha da POPMED (Excel, vencimentos na coluna OBS "PEN - dd/mm") é convertida fora do app.

## Pendências (09/10/2026)

- Número de teste combinado: `+5548991667070`.
- Sincronização GitHub → Lovable às vezes trava: antes de pedir deploy, peça ao Lovable para confirmar o commit (ele recusa se não tiver chegado).
- Modelo `gemini-2.5-flash-lite` às vezes pula ferramentas (por isso a rede de segurança do encaminhamento).
- As recusas da operadora em 0–4 s ficam em `metadata.twilio_status` — conferir nas próximas ligações.
- Links de pagamento para 2+ mensalidades (a POPMED precisa criar).
- Contato/conversa duplicados criados em 24/09 (`ffaf06b6…` / `f13548e4…`) podem ser limpos.
- 5 ligações antigas presas em `queued` (16–24/09) — só cosmético.
