# cobrAI (Bia-cobranca)

Agente de cobrança por voz e WhatsApp ("Bia") da POPMED. Tudo em português do Brasil.

> O `README.md` descreve uma stack aspiracional (Express, wouter, Meta Cloud API) que **não** é a deste código. Use este arquivo como referência.

## Stack real

- **App**: TanStack Start (React) + Vite + Tailwind, gerado/editado pelo **Lovable** (projeto `8dfe8a99-797f-4664-8595-b57321b059c6`, site público `nexus-ai-voice-memories.lovable.app`).
- **Backend**: Lovable Cloud = Supabase (`qsbsnsoswkzrrydkiclz`). Edge functions em Deno em `supabase/functions/`. Server functions do app em `src/lib/*.functions.ts`.
- **Voz**: Twilio (conta `AC47fb…`, números como *Verified Caller ID*) + ElevenLabs Conversational AI (agente da persona Bia).
- **WhatsApp**: Evolution API v2 (instância `nexus_ebf3eba4002d_63639915`), webhook → `evolution-incoming`.
- **LLM das respostas de WhatsApp e campanhas**: Lovable AI Gateway (`LOVABLE_API_KEY`).

## Como publicar uma mudança

1. Branch → PR → merge em `main` (GitHub `MONIKPOPMED/Bia-cobranca`, antigo `nexus-ai-voice-memories`; `gh` logado como MONIKPOPMED). O merge é feito pela usuária no GitHub (o Claude Code bloqueia merge do próprio PR). Crie a branch a partir de um `main` atualizado: **o Lovable também commita direto em `main`** (`git pull` antes de começar).
2. **Frontend**: o Lovable sincroniza e remonta a prévia sozinho. Para ir ao site público é preciso clicar em **Publish** no Lovable (publica tudo que estiver pendente).
3. **Edge functions NÃO são publicadas automaticamente** a partir do GitHub. Peça no chat do projeto no Lovable, uma por vez ou em lista:
   > Faça o deploy da(s) edge function(s) `X` exatamente como está no código atual (veio do GitHub, PR #N). Não altere nenhum código, só publique no backend.

   Confirme depois (ex.: a resposta muda, ou uma chamada sem auth devolve o erro novo).
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

## Regras de negócio

- **Guard de discagem** (`_shared/voice/guard.ts`): seg–sex 9h–18h (America/Sao_Paulo), 60 min entre tentativas e 3 por dia **por número de destino** — tentativas bloqueadas também contam.
- **Números**: `+5548996056774` é o número de saída (Caller ID verificado, `verified_caller_id_only`, persona Bia). `+5548996975445` está **desativado** (não excluir: tem histórico).
- **Encaminhamento**: a Bia nunca diz "atendente humano"; diz que vai passar para alguém da equipe e informa o horário — seg–sex, exceto feriados, 9h–12h30 e 13h30–17h (`SUPPORT_HOURS_TEXT`).
- **Roteiro da Bia** fica no banco (`agent_personas.system_prompt`, persona `9d5fd87e-…`), não no código. Depois de editar, **re-sincronize** (`elevenlabs-agent-sync` / botão Re-sincronizar) para valer na ligação.
- **Pagamento de uma mensalidade**: links fixos no roteiro — PIX `https://popmed.com.br/produto/popmed-plano-mensal-ia2-pix/`, cartão `https://popmed.com.br/produto/popmed-plano-mensal-ia2-cc/`. Com **mais de uma parcela em aberto**, a Bia passa para a equipe (links para esses casos ainda não existem).

## Cuidado

- Ligações e campanhas de WhatsApp atingem **pessoas reais** (a Carteira tem devedores reais). Teste só com números combinados.
- Não commite segredos. O `.env` contém apenas valores públicos (URL e publishable key do Supabase).

## Pendências (set/2026)

- Testar ligação real com a Bia pelo 6774 (em horário permitido) — a cadeia Twilio → app → ElevenLabs foi corrigida, falta ouvir a Bia falando.
- Várias chamadas recentes foram recusadas pela operadora em 0–4 s (possível filtro anti-spam do Caller ID).
- Links de pagamento para mais de uma parcela e outros casos.
- Contato/conversa duplicados criados em 24/09 (`ffaf06b6…` / `f13548e4…`) podem ser limpos.
- PR #3 (rascunho do Codex, "Exibe erros da discagem no cartão do número") — decidir se aproveita ou fecha.
