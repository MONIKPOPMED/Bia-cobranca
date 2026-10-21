// POPMED store (popmed.com.br, WooCommerce) and the CPF lookup, for paying
// overdue installments with a store order instead of the fixed product links.
//
// Follows Leonardo's guide (WOOCOMMERCE_PEDIDOS_PARA_LOVABLE.md, version of
// 19–20/10/2026), item 4.2 "mensalidades atrasadas":
//   1. consultarCliente(cpf) → POST https://ia.lcedigital.com.br:8443/ia/cliente
//      returns the situation and the payment options already computed (which
//      installments, value, 10% from 3 on, the order template);
//   2. criarPedidoMensalidades(opção, forma, cliente, conversa) creates the
//      guest order exactly as the option came (no recalculation), card (3038)
//      or pix automático (3042), and checks the created order;
//   3. situacao / cancelar.
//
// NOT live for customers yet: Leonardo releases it after the safe test
// (create with the test CPF and cancel within 10 minutes). Never log CPF,
// name, phone, address, payment_url or keys — only order id, status, total.

const LOJA = "https://popmed.com.br/wp-json/wc/v3/";
const CONSULTA = "https://ia.lcedigital.com.br:8443/ia/cliente"; // port 8443 is part of the address
const ORIGEM = "ia-lovable";

export const FORMAS = {
  cartao: { gateway: "woo-pagarme-payments-credit_card", titulo: "Cartão de crédito", produto: 3038 },
  pix_automatico: { gateway: "pix_automatico_santander", titulo: "Pix Automático", produto: 3042 },
} as const;
export type Forma = keyof typeof FORMAS;

export const VALOR_MINIMO_CENTAVOS = 2990; // R$ 29,90
export const VALOR_MAXIMO_CENTAVOS = 99900; // R$ 999,00

export class LojaError extends Error {
  /**
   * incerta = the request may have reached the store (timeout, 5xx): look it up before retrying.
   * entrada = invalid input (HTTP 400); nothing was sent.
   */
  constructor(message: string, public status?: number, public incerta = false, public entrada = false) {
    super(message);
  }
}
const invalido = (m: string) => new LojaError(m, undefined, false, true);

// ── CPF lookup ─────────────────────────────────────────────────────────────

export type Opcao = {
  quantidade: number;
  mensalidades: number[];
  valor_sem_desconto: number;
  desconto_percentual: number;
  valor: number;
  pedido: {
    total: string;
    billing_cpf: string;
    meta_data: Array<{ key: string; value: string }>;
    formas: Array<{ payment_method: string; produto: number }>;
  };
};

export type Consulta = {
  situacao: "novo" | "cancelado" | "ativo" | "pendente" | "inadimplente" | string;
  pode_vender_plano_novo: boolean;
  sem_opcao: string | null;
  consultado_em: string;
  mensalidades: Array<{ codigo: number; vencimento: string; motivo: number; valor: number; vencida: boolean }>;
  opcoes: Opcao[];
};

/** Asks POPMED's system about a CPF. Without a 200 the Bia must not charge (guide 4.2). */
export async function consultarCliente(cpfBruto: string): Promise<Consulta> {
  // Tolerate how the key may have been pasted: spaces/newlines, quotes, "Bearer ".
  const chave = (Deno.env.get("POPMED_CONSULTA_CHAVE") ?? "").trim().replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "").trim();
  if (!chave) throw new Error("Chave da consulta não configurada (POPMED_CONSULTA_CHAVE)");
  const cpf = soDigitos(cpfBruto);
  if (!cpfValido(cpf)) throw invalido("CPF inválido");
  let resp: Response;
  try {
    resp = await fetch(CONSULTA, {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ cpf }), // the CPF never goes in the URL
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new LojaError(`Consulta sem resposta: ${e instanceof Error ? e.message : e}`);
  }
  const texto = await resp.text();
  if (!resp.ok) throw new LojaError(`Consulta respondeu HTTP ${resp.status}: ${texto.trim().slice(0, 200)}`, resp.status);
  try {
    return JSON.parse(texto) as Consulta;
  } catch {
    throw new LojaError("Resposta inválida da consulta", resp.status);
  }
}

// ── Store ──────────────────────────────────────────────────────────────────

export type ClienteLoja = {
  nome: string;
  telefone: string;
  email?: string;
  // Address: the guide asks for it; whether the store/Pagar.me really
  // requires it is one of the things the first test checks.
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  cidade?: string;
  uf?: string;
};

export type Situacao = "aguardando" | "recusado" | "pago" | "qr_gerado" | "cancelado" | "estornado" | "outro";

export class LojaPopmed {
  private readonly auth: string;

  constructor(chave = Deno.env.get("WOO_CONSUMER_KEY") ?? "", segredo = Deno.env.get("WOO_CONSUMER_SECRET") ?? "") {
    if (!chave || !segredo) throw new Error("Chave da loja não configurada (WOO_CONSUMER_KEY / WOO_CONSUMER_SECRET)");
    this.auth = "Basic " + btoa(`${chave}:${segredo}`);
  }

  /** Read-only: the key works and the AI product exists. */
  async produto(forma: Forma) {
    const p = await this.pedir("GET", `products/${FORMAS[forma].produto}`);
    return { id: Number(p.id), nome: String(p.name ?? ""), status: String(p.status ?? ""), visibilidade: String(p.catalog_visibility ?? ""), preco: String(p.price ?? "") };
  }

  /**
   * Order paying overdue installments, from a lookup option used as it came
   * (guide 4.2: never recalculate). Checks the created order and cancels it
   * if anything does not match.
   */
  async criarPedidoMensalidades(opcao: Opcao, forma: Forma, c: ClienteLoja, conversa: string) {
    if (!Object.hasOwn(FORMAS, forma)) throw invalido("Forma de pagamento inválida");
    const f = FORMAS[forma];
    if (!opcao?.pedido?.formas?.some((x) => x.payment_method === f.gateway && Number(x.produto) === f.produto)) {
      throw invalido("Forma de pagamento não oferecida nesta opção");
    }
    const valorCentavos = centavos(opcao.pedido.total);
    if (!Number.isInteger(valorCentavos) || valorCentavos < VALOR_MINIMO_CENTAVOS || valorCentavos > VALOR_MAXIMO_CENTAVOS) {
      throw invalido("Valor fora da faixa permitida");
    }
    if (!limpar(conversa)) throw invalido("Conversa não informada");
    const cpf = soDigitos(opcao.pedido.billing_cpf);
    if (!cpfValido(cpf)) throw invalido("CPF inválido");
    const nome = limpar(c.nome).toUpperCase();
    const espaco = nome.indexOf(" ");
    if (espaco < 1) throw invalido("Informe nome e sobrenome");
    const telefone = telefoneDoSite(c.telefone);
    if (!telefone) throw invalido("Telefone inválido (DDD + número)");
    const email = limpar(c.email ?? "").toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalido("E-mail inválido");
    const cep = soDigitos(c.cep ?? "");
    const temEndereco = cep.length === 8 && !!limpar(c.logradouro ?? "") && !!limpar(c.numero ?? "") && !!limpar(c.cidade ?? "");
    const uf = limpar(c.uf ?? "").toUpperCase();

    const metasOpcao = (opcao.pedido.meta_data ?? []).filter((m) => m && typeof m.key === "string");
    const corpo = {
      status: "pending",
      set_paid: false,
      customer_id: 0, // guest: whoever has the link pays without logging in
      payment_method: f.gateway,
      payment_method_title: f.titulo,
      billing: {
        first_name: nome.slice(0, espaco),
        last_name: nome.slice(espaco + 1),
        // Only when the customer has one (never invent it): the store rejects an
        // empty string as an invalid billing param (400 rest_invalid_param, 21/10).
        ...(email ? { email } : {}),
        phone: telefone,
        cpf,
        persontype: "F",
        ...(temEndereco
          ? {
            address_1: `${limpar(c.logradouro!)}, ${limpar(c.numero!)}`,
            address_2: limpar(c.complemento ?? ""),
            city: limpar(c.cidade!),
            state: /^[A-Z]{2}$/.test(uf) ? uf : "",
            postcode: `${cep.slice(0, 5)}-${cep.slice(5)}`,
          }
          : {}),
        country: "BR",
      },
      line_items: [{ product_id: f.produto, quantity: 1, subtotal: reais(valorCentavos), total: reais(valorCentavos) }],
      meta_data: [
        ...metasOpcao, // _popmed_origem, _popmed_tipo, _popmed_mensalidades, as they came
        { key: "_billing_cpf", value: `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}` },
        { key: "_popmed_conversa", value: conversa },
      ],
    };

    const pedido = await this.pedir("POST", "orders", corpo);
    const id = Number(pedido.id);
    const metas: Array<{ key: string; value: unknown }> = Array.isArray(pedido.meta_data) ? pedido.meta_data : [];
    const metasOk = metasOpcao.every((m) => metas.some((x) => x.key === m.key && String(x.value) === String(m.value)));
    if (pedido.status !== "pending" || centavos(pedido.total) !== valorCentavos || centavos(pedido.total_tax) !== 0 || !pedido.payment_url || !metasOk) {
      if (id > 0) await this.cancelar(id).catch(() => {});
      throw new LojaError(`Pedido criado diferente do pedido (status ${pedido.status}, total ${pedido.total}, metas ${metasOk ? "ok" : "faltando"}); cancelado`);
    }
    return {
      id,
      link: String(pedido.payment_url),
      total: String(pedido.total),
      cpfGravado: soDigitos(String(pedido.billing?.cpf ?? "")) === cpf,
      comEndereco: temEndereco,
    };
  }

  async situacao(id: number): Promise<{ situacao: Situacao; status: string; total: string }> {
    const p = await this.pedir("GET", `orders/${id}`);
    const status = String(p.status ?? "");
    const situacao: Situacao = status === "pending" ? "aguardando"
      : status === "failed" ? "recusado"
      : status === "processing" || status === "completed" ? "pago"
      : status === "on-hold" ? "qr_gerado" // pix automático: does NOT mean paid
      : status === "cancelled" ? "cancelado"
      : status === "refunded" ? "estornado" : "outro";
    return { situacao, status, total: String(p.total ?? "") };
  }

  /** Cancels only pending/failed (never on-hold pix: it may already be paid). */
  async cancelar(id: number) {
    const atual = await this.pedir("GET", `orders/${id}`);
    if (atual.status !== "pending" && atual.status !== "failed") return { cancelado: false, status: String(atual.status) };
    const p = await this.pedir("PUT", `orders/${id}`, { status: "cancelled" });
    return { cancelado: p.status === "cancelled", status: String(p.status) };
  }

  /** After an "incerta" failure: this conversation's order from the last minutes, if any. */
  async procurarPorConversa(conversa: string, minutos = 15) {
    const desde = new Date(Date.now() - minutos * 60_000).toISOString().slice(0, 19);
    const lista = await this.pedir("GET", `orders?status=pending&after=${desde}&dates_are_gmt=true&per_page=50&orderby=date&order=desc`);
    for (const p of Array.isArray(lista) ? lista : []) {
      const metas: Array<{ key: string; value: unknown }> = Array.isArray(p.meta_data) ? p.meta_data : [];
      if (metas.some((m) => m.key === "_popmed_conversa" && m.value === conversa) && metas.some((m) => m.key === "_popmed_origem" && m.value === ORIGEM)) {
        return { id: Number(p.id), link: String(p.payment_url), total: String(p.total) };
      }
    }
    return null;
  }

  // deno-lint-ignore no-explicit-any
  private async pedir(metodo: string, caminho: string, corpo?: unknown): Promise<any> {
    let resp: Response;
    try {
      resp = await fetch(LOJA + caminho, {
        method: metodo,
        headers: {
          Authorization: this.auth,
          Accept: "application/json",
          ...(corpo ? { "Content-Type": "application/json; charset=utf-8" } : {}),
        },
        body: corpo ? JSON.stringify(corpo) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new LojaError(`Sem resposta da loja: ${e instanceof Error ? e.message : e}`, undefined, metodo !== "GET");
    }
    const texto = await resp.text();
    if (resp.ok) {
      try { return JSON.parse(texto); } catch { /* falls through */ }
      throw new LojaError("Resposta inválida da loja", resp.status);
    }
    let msg = "";
    try {
      const j = JSON.parse(texto);
      // rest_invalid_param says which field is wrong in data.params/details.
      const detalhe = j?.data?.details ?? j?.data?.params;
      msg = [j?.code, j?.message, detalhe ? JSON.stringify(detalhe).slice(0, 300) : null].filter(Boolean).join(": ");
    } catch {
      msg = texto.trim().slice(0, 300); // server or Wordfence error page
    }
    throw new LojaError(`Loja respondeu HTTP ${resp.status}${msg ? " - " + msg : ""}`, resp.status, resp.status >= 500 && metodo !== "GET");
  }
}

// ---------- helpers ----------

const soDigitos = (s: string) => (s ?? "").replace(/\D/g, "");
const limpar = (s: string) => (s ?? "").replace(/\s+/g, " ").trim();
const reais = (c: number) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
const centavos = (s: unknown) => Math.round(Number(String(s ?? "").replace(",", ".")) * 100);

/** "(48) 99999-8888", as the site stores it. Drops the 55 only when 12–13 digits remain. */
function telefoneDoSite(bruto: string): string | null {
  let d = soDigitos(bruto);
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  const ddd = d.slice(0, 2), n = d.slice(2);
  return `(${ddd}) ${n.slice(0, n.length - 4)}-${n.slice(-4)}`;
}

export function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const dv = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(cpf[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(cpf[9]) && dv(10) === Number(cpf[10]);
}
