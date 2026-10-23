// CPF lookup in POPMED's system, for the WhatsApp campaign (app server side).
// Same contract as supabase/functions/_shared/loja-popmed.ts (Leonardo's
// guide, item 4.2): before each collection message, ask whether the customer
// is still overdue and how much — the imported Carteira gets stale the same
// day (21/10). Off unless LOJA_POPMED_ATIVA is set.

const CONSULTA = "https://ia.lcedigital.com.br:8443/ia/cliente"; // port 8443 is part of the address

export function lojaAtiva(): boolean {
  return /^(1|true|sim|yes)$/i.test((process.env["LOJA_POPMED_ATIVA"] ?? "").trim());
}

export type OpcaoConsulta = {
  quantidade: number;
  valor_sem_desconto: number;
  desconto_percentual: number;
  valor: number;
  pedido: { total: string };
};

export type Consulta = {
  situacao: string;
  pode_vender_plano_novo: boolean;
  sem_opcao: string | null;
  opcoes: OpcaoConsulta[];
};

export class ConsultaError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function consultarCpf(cpf: string): Promise<Consulta> {
  const chave = (process.env["POPMED_CONSULTA_CHAVE"] ?? "").trim().replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "").trim();
  if (!chave) throw new ConsultaError(401, "Chave da consulta não configurada no servidor do app");
  let resp: Response;
  try {
    resp = await fetch(CONSULTA, {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ cpf: cpf.replace(/\D/g, "") }), // never in the URL
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new ConsultaError(503, `Consulta sem resposta: ${e instanceof Error ? e.message : e}`);
  }
  const texto = await resp.text();
  if (!resp.ok) throw new ConsultaError(resp.status, `Consulta respondeu HTTP ${resp.status}: ${texto.trim().slice(0, 160)}`);
  return JSON.parse(texto) as Consulta;
}

/** The option the Bia offers: the overdue ones, within the R$ 999 cap (guide 3.4/4.2). */
export function opcaoPrincipal(c: Consulta): OpcaoConsulta | null {
  const o = (c.opcoes ?? [])[0];
  if (!o) return null;
  return Math.round(Number(o.pedido?.total ?? o.valor) * 100) <= 99900 ? o : null;
}
