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

/** Billing address used when the customer's is unknown (any address works — Leonardo, 21/10). */
const ENDERECO_PADRAO = {
  address_1: "Não informado, s/n",
  address_2: "",
  city: "Florianópolis",
  state: "SC",
  postcode: "88010-000",
};

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
  async criarPedidoMensalidades(
    opcao: Opcao,
    forma: Forma,
    c: ClienteLoja,
    conversa: string,
    /** Only the admin test console lowers it (real-payment test with Leonardo). */
    minimoCentavos = VALOR_MINIMO_CENTAVOS,
  ) {
    if (!Object.hasOwn(FORMAS, forma)) throw invalido("Forma de pagamento inválida");
    const f = FORMAS[forma];
    if (!opcao?.pedido?.formas?.some((x) => x.payment_method === f.gateway && Number(x.produto) === f.produto)) {
      throw invalido("Forma de pagamento não oferecida nesta opção");
    }
    const valorCentavos = centavos(opcao.pedido.total);
    if (!Number.isInteger(valorCentavos) || valorCentavos < minimoCentavos || valorCentavos > VALOR_MAXIMO_CENTAVOS) {
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
          // Without a billing address the store finds no region and shows no
          // payment method (test order 3045, 21/10). Leonardo: "pode ser
          // qualquer um" — the customer fills the real one on the payment page.
          : ENDERECO_PADRAO),
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
    return { situacao: situacaoDoStatus(status), status, total: String(p.total ?? "") };
  }

  /** Cancels only pending/failed (never on-hold pix: it may already be paid). */
  async cancelar(id: number) {
    const atual = await this.pedir("GET", `orders/${id}`);
    if (atual.status !== "pending" && atual.status !== "failed") return { cancelado: false, status: String(atual.status) };
    const p = await this.pedir("PUT", `orders/${id}`, { status: "cancelled" });
    return { cancelado: p.status === "cancelled", status: String(p.status) };
  }

  /** Status + link of an existing order (the link is never stored on our side). */
  async pedidoComLink(id: number): Promise<{ situacao: Situacao; status: string; total: string; link: string }> {
    const p = await this.pedir("GET", `orders/${id}`);
    const status = String(p.status ?? "");
    return { situacao: situacaoDoStatus(status), status, total: String(p.total ?? ""), link: String(p.payment_url ?? "") };
  }

  /**
   * Guide item 6: the store never expires API orders. Cancels the AI's
   * pending/failed orders older than `dias` (never on-hold pix: it may be paid).
   */
  async cancelarVencidos(dias = 7): Promise<number> {
    const antes = new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 19);
    let cancelados = 0;
    for (const status of ["pending", "failed"]) {
      const lista = await this.pedir("GET", `orders?status=${status}&before=${antes}&dates_are_gmt=true&per_page=100`);
      for (const p of Array.isArray(lista) ? lista : []) {
        const metas: Array<{ key: string; value: unknown }> = Array.isArray(p.meta_data) ? p.meta_data : [];
        if (!metas.some((m) => m.key === "_popmed_origem" && m.value === ORIGEM)) continue;
        const r = await this.cancelar(Number(p.id)).catch(() => null);
        if (r?.cancelado) cancelados++;
      }
    }
    return cancelados;
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

function situacaoDoStatus(status: string): Situacao {
  return status === "pending" ? "aguardando"
    : status === "failed" ? "recusado"
    : status === "processing" || status === "completed" ? "pago"
    : status === "on-hold" ? "qr_gerado" // pix automático: does NOT mean paid
    : status === "cancelled" ? "cancelado"
    : status === "refunded" ? "estornado" : "outro";
}

// ── The Bia's use of it (off until LOJA_POPMED_ATIVA) ──────────────────────

/**
 * Master switch. Off (default) = the Bia keeps the fixed product links and
 * the Carteira values, exactly as before. Turned on after the real payment
 * test with Leonardo (guide item 13) by setting the secret LOJA_POPMED_ATIVA=sim.
 */
export function lojaAtiva(): boolean {
  return /^(1|true|sim|yes)$/i.test((Deno.env.get("LOJA_POPMED_ATIVA") ?? "").trim());
}

/** Payment link stored on the conversation (never the URL: it is a password — guide 3.2). */
type PedidoConversa = { id: number; forma: Forma; total: string; criado_em: string };

// deno-lint-ignore no-explicit-any
export async function cpfDoContato(admin: any, contactId: string): Promise<string | null> {
  const { data } = await admin
    .from("debtor_profiles")
    .select("doc_type, doc_number")
    .eq("contact_id", contactId)
    .limit(1)
    .maybeSingle();
  const cpf = soDigitos(String(data?.doc_number ?? ""));
  return cpfValido(cpf) ? cpf : null;
}

/** The option the Bia offers: the overdue ones (guide 4.2 — the first option). */
export function opcaoPrincipal(c: Consulta): Opcao | null {
  const o = (c.opcoes ?? [])[0];
  if (!o) return null;
  return centavos(o.pedido?.total) <= VALOR_MAXIMO_CENTAVOS ? o : null;
}

/** Instructions block for the WhatsApp agent, from the CPF lookup (not the Carteira). */
export function contextoDaConsulta(c: Consulta | null, motivoSemConsulta?: string): string {
  const linhas = ["SITUAÇÃO NO SISTEMA DA POPMED (consulta pelo CPF agora — vale mais que qualquer outro dado):"];
  if (!c) {
    linhas.push(`- Não foi possível consultar (${motivoSemConsulta ?? "erro"}). NÃO informe valores e NÃO mande link: passe o atendimento para alguém da nossa equipe.`);
    return linhas.join("\n");
  }
  if (c.situacao !== "inadimplente") {
    linhas.push(`- Situação: ${c.situacao}. O cliente NÃO tem mensalidade em aberto para cobrar. Não cobre; se ele disser que pagou, agradeça; se tiver dúvida sobre o cadastro, passe para alguém da nossa equipe.`);
    return linhas.join("\n");
  }
  const o = opcaoPrincipal(c);
  if (c.sem_opcao || !o) {
    linhas.push("- O cliente tem mensalidades em aberto, mas o sistema não permite gerar o link automático. NÃO mande link: passe o atendimento para alguém da nossa equipe.");
    return linhas.join("\n");
  }
  const desconto = o.desconto_percentual > 0
    ? ` Com ${o.desconto_percentual}% de desconto à vista (de ${brl(o.valor_sem_desconto)} por ${brl(o.valor)}).`
    : " Sem desconto (não fale em desconto).";
  linhas.push(
    `- Mensalidades em atraso: ${o.quantidade}. Valor a pagar à vista: ${brl(o.valor)}.${desconto}`,
    "- Formas: cartão de crédito (à vista) ou Pix Automático. Não existe parcelamento.",
    "- Para mandar o link, escreva exatamente [[LINK_CARTAO]] ou [[LINK_PIX]] na mensagem, conforme a forma que o cliente escolheu. NUNCA escreva endereço de site nem os links antigos de produto: o sistema troca a marcação pelo link certo.",
    "- Isto SUBSTITUI a seção de links de pagamento do roteiro, inclusive a regra de passar para a equipe quando houver mais de uma mensalidade: o link agora vale para qualquer quantidade.",
    "- Pix Automático: avise que o mesmo Pix paga esta cobrança e autoriza as próximas mensalidades (R$ 49,90) direto no banco, e que, se o banco perguntar um valor máximo, não deve colocar menos de R$ 49,90.",
    "- Depois de pagar, peça o comprovante por aqui.",
  );
  return linhas.join("\n");
}

const brl = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

export type LinkCobranca =
  | { ok: true; link: string; valor: number; quantidade: number; desconto_percentual: number; forma: Forma; reutilizado: boolean }
  | { ok: false; motivo: "sem_cpf" | "consulta_falhou" | "nao_inadimplente" | "sem_opcao" | "ja_pago" | "renegociacao" | "loja_falhou"; detalhe?: string };

/**
 * The payment link for a conversation (WhatsApp or the call's WhatsApp
 * follow-up). Guide rules: look the CPF up right before creating; one link
 * per customer; reuse it if nothing changed; never charge again an order
 * that is paid or has the pix QR generated; changing value/method only in
 * the first 10 minutes, after that the team takes over (item 8.2).
 */
export async function linkDeCobranca(
  // deno-lint-ignore no-explicit-any
  admin: any,
  opts: { contactId: string; conversationId: string; forma: Forma },
): Promise<LinkCobranca> {
  const cpf = await cpfDoContato(admin, opts.contactId);
  if (!cpf) return { ok: false, motivo: "sem_cpf" };
  let consulta: Consulta;
  try {
    consulta = await consultarCliente(cpf);
  } catch (e) {
    return { ok: false, motivo: "consulta_falhou", detalhe: e instanceof Error ? e.message.slice(0, 200) : String(e) };
  }
  if (consulta.situacao !== "inadimplente") return { ok: false, motivo: "nao_inadimplente", detalhe: consulta.situacao };
  const opcao = opcaoPrincipal(consulta);
  if (consulta.sem_opcao || !opcao) return { ok: false, motivo: "sem_opcao", detalhe: consulta.sem_opcao ?? undefined };

  const loja = new LojaPopmed();
  const { data: conv } = await admin.from("conversations").select("additional_attributes").eq("id", opts.conversationId).maybeSingle();
  const attrs = (conv?.additional_attributes ?? {}) as Record<string, unknown>;
  const anterior = attrs.loja_pedido as PedidoConversa | undefined;

  if (anterior?.id) {
    const atual = await loja.pedidoComLink(anterior.id).catch(() => null);
    if (atual && (atual.situacao === "pago" || atual.situacao === "qr_gerado")) return { ok: false, motivo: "ja_pago", detalhe: atual.status };
    const mesmo = anterior.forma === opts.forma && centavos(anterior.total) === centavos(opcao.pedido.total);
    if (atual && mesmo && (atual.situacao === "aguardando" || atual.situacao === "recusado") && atual.link) {
      return { ok: true, link: atual.link, valor: opcao.valor, quantidade: opcao.quantidade, desconto_percentual: opcao.desconto_percentual, forma: opts.forma, reutilizado: true };
    }
    if (atual && (atual.situacao === "aguardando" || atual.situacao === "recusado")) {
      const idadeMin = (Date.now() - new Date(anterior.criado_em).getTime()) / 60_000;
      if (idadeMin > 10) return { ok: false, motivo: "renegociacao" }; // already imported with the first value
      await loja.cancelar(anterior.id).catch(() => {});
    }
  }

  const { data: contact } = await admin.from("contacts").select("name, phone_number").eq("id", opts.contactId).maybeSingle();
  try {
    let criado: { id: number; link: string; total: string };
    try {
      criado = await loja.criarPedidoMensalidades(opcao, opts.forma, { nome: String(contact?.name ?? ""), telefone: String(contact?.phone_number ?? "") }, opts.conversationId);
    } catch (e) {
      // No answer may still mean created: look it up before giving up (guide item 4).
      const achado = e instanceof LojaError && e.incerta ? await loja.procurarPorConversa(opts.conversationId) : null;
      if (!achado) throw e;
      criado = achado;
    }
    const pedido: PedidoConversa = { id: criado.id, forma: opts.forma, total: criado.total, criado_em: new Date().toISOString() };
    await admin.from("conversations").update({ additional_attributes: { ...attrs, loja_pedido: pedido } }).eq("id", opts.conversationId);
    console.log(`[loja-popmed] pedido=${criado.id} total=${criado.total} forma=${opts.forma}`);
    return { ok: true, link: criado.link, valor: opcao.valor, quantidade: opcao.quantidade, desconto_percentual: opcao.desconto_percentual, forma: opts.forma, reutilizado: false };
  } catch (e) {
    return { ok: false, motivo: "loja_falhou", detalhe: e instanceof Error ? e.message.slice(0, 200) : String(e) };
  }
}

/** Customer-facing text around the link. */
export function textoDoLink(r: Extract<LinkCobranca, { ok: true }>): string {
  const como = r.forma === "cartao" ? "no cartão de crédito, à vista" : "por Pix Automático";
  const pix = r.forma === "pix_automatico"
    ? "\n\nNo Pix Automático, o mesmo Pix paga esta cobrança e autoriza as próximas mensalidades (R$ 49,90) no seu banco. Se o banco perguntar um valor máximo, não coloque menos de R$ 49,90."
    : "";
  return `Segue o link para pagar ${brl(r.valor)} ${como}:\n${r.link}${pix}\n\nDepois de pagar, me envie o comprovante por aqui, por favor.`;
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
