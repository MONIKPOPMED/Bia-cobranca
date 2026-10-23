// loja-popmed — admin-only test console for the POPMED store + CPF lookup
// (_shared/loja-popmed.ts), for the safe test in Leonardo's guide (item 13)
// before the Bia uses it with customers.
//
// Body { acao, ... } with a logged-in admin's JWT:
//   consultar   { cpf }                 → situation + options summary (no personal data echoed)
//   produto     { forma }               → read-only check of the AI product (3038 / 3042)
//   teste_criar { forma, nome, telefone, cep?, logradouro?, numero?, cidade?, uf? }
//                                       → creates a R$ 34,90 order ONLY for the test CPF
//                                         (cancel it within 10 minutes!)
//   situacao    { pedidoId }
//   cancelar    { pedidoId }
// Logs only order id, status and total.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { consultarCliente, FORMAS, type Forma, LojaError, LojaPopmed, type Opcao } from "../_shared/loja-popmed.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Test CPF agreed with Leonardo (guide item 13). teste_criar refuses any other. */
const CPF_TESTE = "01234567890";

const j = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ erro: "method not allowed" }, 405);

  // ── Auth: admin user ──
  const authHeader = req.headers.get("Authorization") ?? "";
  const url = Deno.env.get("SUPABASE_URL")!;
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user?.id) return j({ erro: "unauthorized" }, 401);
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: role } = await admin.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").limit(1).maybeSingle();
  if (!role) return j({ erro: "admin role required" }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return j({ erro: "body must be JSON" }, 400); }
  const acao = String(body.acao ?? "");

  try {
    // Guide 4.2 (21/10): a 401 with the "right" key means the secret is not the
    // server's. Compare fingerprints without ever showing the key.
    if (acao === "diagnostico_chave") {
      const bruta = Deno.env.get("POPMED_CONSULTA_CHAVE") ?? "";
      const limpa = bruta.trim().replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "").trim();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(limpa))))
        .map((b) => b.toString(16).padStart(2, "0")).join("");
      return j({
        existe: bruta.length > 0,
        tamanho: limpa.length,
        formato_64_hex: /^[0-9a-fA-F]{64}$/.test(limpa),
        parece_chave_da_loja: /^(ck|cs)_/.test(limpa),
        tinha_espacos_aspas_ou_bearer: bruta !== limpa,
        sha256: hash,
      });
    }

    if (acao === "consultar") {
      const c = await consultarCliente(String(body.cpf ?? ""));
      return j({
        situacao: c.situacao,
        pode_vender_plano_novo: c.pode_vender_plano_novo,
        sem_opcao: c.sem_opcao,
        consultado_em: c.consultado_em,
        mensalidades: (c.mensalidades ?? []).map((m) => ({ vencimento: m.vencimento, valor: m.valor, vencida: m.vencida })),
        opcoes: (c.opcoes ?? []).map((o) => ({
          quantidade: o.quantidade,
          valor: o.valor,
          desconto_percentual: o.desconto_percentual,
          formas: o.pedido?.formas?.map((f) => f.payment_method),
        })),
      });
    }

    const loja = new LojaPopmed();
    const forma = String(body.forma ?? "cartao") as Forma;
    if (!Object.hasOwn(FORMAS, forma)) return j({ erro: "forma inválida (cartao | pix_automatico)" }, 400);

    if (acao === "produto") return j(await loja.produto(forma));

    if (acao === "teste_criar") {
      // Real-payment test with Leonardo (guide item 13) may use a small amount,
      // e.g. R$ 1,00 — only here, only with the test CPF.
      const centavosTeste = body.valorCentavos === undefined ? 3490 : Number(body.valorCentavos);
      if (!Number.isInteger(centavosTeste) || centavosTeste < 100 || centavosTeste > 99900) {
        return j({ erro: "valorCentavos de teste deve ser inteiro entre 100 e 99900" }, 400);
      }
      const reaisTeste = `${Math.floor(centavosTeste / 100)}.${String(centavosTeste % 100).padStart(2, "0")}`;
      // A "new sale"-shaped option for the test CPF only: no installment metas,
      // so even if it slipped past the 10 minutes nothing would be written off.
      const opcao: Opcao = {
        quantidade: 1,
        mensalidades: [],
        valor_sem_desconto: centavosTeste / 100,
        desconto_percentual: 0,
        valor: centavosTeste / 100,
        pedido: {
          total: reaisTeste,
          billing_cpf: CPF_TESTE,
          meta_data: [{ key: "_popmed_origem", value: "ia-lovable" }],
          formas: Object.values(FORMAS).map((f) => ({ payment_method: f.gateway, produto: f.produto })),
        },
      };
      const criado = await loja.criarPedidoMensalidades(opcao, forma, {
        nome: String(body.nome ?? "TESTE BIA COBRANCA"),
        telefone: String(body.telefone ?? ""),
        cep: body.cep ? String(body.cep) : undefined,
        logradouro: body.logradouro ? String(body.logradouro) : undefined,
        numero: body.numero ? String(body.numero) : undefined,
        cidade: body.cidade ? String(body.cidade) : undefined,
        uf: body.uf ? String(body.uf) : undefined,
      }, `teste-${crypto.randomUUID()}`, Math.min(centavosTeste, 2990));
      console.log(`[loja-popmed] teste_criar pedido=${criado.id} total=${criado.total} forma=${forma}`);
      return j({ ...criado, aviso: "Cancele em menos de 10 minutos (acao: cancelar)." });
    }

    if (acao === "situacao") return j(await loja.situacao(Number(body.pedidoId)));
    if (acao === "cancelar") {
      const r = await loja.cancelar(Number(body.pedidoId));
      console.log(`[loja-popmed] cancelar pedido=${Number(body.pedidoId)} status=${r.status}`);
      return j(r);
    }
    return j({ erro: "ação inválida" }, 400);
  } catch (e) {
    const status = !(e instanceof LojaError) ? 500 : e.entrada ? 400 : 502;
    return j({ erro: e instanceof Error ? e.message : String(e) }, status);
  }
});
