// Daily e-mail report of the Bia's WhatsApp work (POPMED, 09/11): every day at
// 8h (America/Sao_Paulo) a summary of the previous day goes to the team.
// Runs inside whatsapp-health-check (pg_cron every 5 min); sent once a day,
// remembered on accounts.internal_attributes.relatorio_diario.ultimo.
//
// Recipients: accounts.internal_attributes.relatorio_diario.emails, else
// DESTINATARIOS.

const DESTINATARIOS = ["monikmendes@popmed.com.br", "emerson@bbmdigital.com.br", "eduardo@bbmdigital.com.br"];
const HORA = 8;

type Envio = (to: string[], subject: string, html: string) => Promise<{ ok: boolean; error?: string }>;

/** São Paulo has no DST since 2019: UTC-3. */
const SP_OFFSET_H = 3;

function diaSP(d: Date): string {
  return new Date(d.getTime() - SP_OFFSET_H * 3600_000).toISOString().slice(0, 10);
}

function inicioDoDiaSP(dia: string): Date {
  return new Date(`${dia}T00:00:00-03:00`);
}

const br = (dia: string) => dia.split("-").reverse().join("/");
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export type Relatorio = {
  dia: string;
  disparos: number;
  links: number;
  responderam: number;
  comprovantes: number;
  nomesComprovantes: string[];
};

// deno-lint-ignore no-explicit-any
export async function montarRelatorio(admin: any, accountId: string, dia: string): Promise<Relatorio> {
  const ini = inicioDoDiaSP(dia).toISOString();
  const fim = new Date(inicioDoDiaSP(dia).getTime() + 24 * 3600_000).toISOString();

  // 1. Campaign messages sent that day.
  const { count: disparos } = await admin
    .from("whatsapp_campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .gte("sent_at", ini)
    .lt("sent_at", fim);

  // 2. Payment links sent (one per conversation; the link part says "Segue link").
  const { data: linkMsgs } = await admin
    .from("messages")
    .select("conversation_id")
    .eq("account_id", accountId)
    .eq("message_type", 1)
    .or("content.ilike.%Segue link%,content.ilike.%order-pay%")
    .gte("created_at", ini)
    .lt("created_at", fim);
  const links = new Set((linkMsgs ?? []).map((m: { conversation_id: string }) => m.conversation_id)).size;

  // 3. Customers who wrote that day.
  const { data: entrada } = await admin
    .from("messages")
    .select("conversation_id, content_attributes")
    .eq("account_id", accountId)
    .eq("message_type", 0)
    .eq("private", false)
    .gte("created_at", ini)
    .lt("created_at", fim);
  const rows = (entrada ?? []) as Array<{ conversation_id: string; content_attributes: Record<string, unknown> | null }>;
  const responderam = new Set(rows.map((m) => m.conversation_id)).size;

  // 4. Receipts forwarded to the finance group (_shared/finance-receipt.ts).
  const convComprovante = [...new Set(
    rows.filter((m) => (m.content_attributes?.receipt as { forwarded?: boolean } | undefined)?.forwarded === true).map((m) => m.conversation_id),
  )];
  let nomesComprovantes: string[] = [];
  if (convComprovante.length) {
    const { data: convs } = await admin.from("conversations").select("id, contact_id").in("id", convComprovante);
    const ids = (convs ?? []).map((c: { contact_id: string }) => c.contact_id).filter(Boolean);
    const { data: contatos } = ids.length ? await admin.from("contacts").select("id, name, phone_number").in("id", ids) : { data: [] };
    nomesComprovantes = (contatos ?? []).map((c: { name: string | null; phone_number: string | null }) => c.name?.trim() || c.phone_number || "sem nome").sort();
  }

  return { dia, disparos: disparos ?? 0, links, responderam, comprovantes: convComprovante.length, nomesComprovantes };
}

export function htmlDoRelatorio(r: Relatorio): string {
  const linha = (n: number, txt: string) => `<p style="margin:0 0 8px;font-size:15px;color:#222"><b>${n}</b> ${txt}</p>`;
  const nomes = r.nomesComprovantes.length
    ? `<ul style="margin:4px 0 0;padding-left:20px;font-size:14px;color:#222">${r.nomesComprovantes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`
    : `<p style="margin:4px 0 0;font-size:14px;color:#777">Nenhum.</p>`;
  return `<div style="font-family:Arial,sans-serif;max-width:560px">
<h2 style="color:#7c3aed;margin:0 0 12px">Relatório da Bia — dia ${br(r.dia)}</h2>
${linha(r.disparos, r.disparos === 1 ? "disparo" : "disparos")}
${linha(r.links, r.links === 1 ? "cliente recebeu link de pagamento da Bia" : "clientes receberam link de pagamento da Bia")}
${linha(r.responderam, r.responderam === 1 ? "cliente respondeu" : "clientes responderam")}
${linha(r.comprovantes, r.comprovantes === 1 ? "cliente enviou comprovante de pagamento e a Bia encaminhou ao grupo do financeiro" : "clientes enviaram comprovante de pagamento e a Bia encaminhou ao grupo do financeiro")}
<p style="margin:12px 0 0;font-size:14px;color:#222"><b>Nome desses clientes:</b></p>
${nomes}
<p style="margin:16px 0 0;font-size:12px;color:#777">Relatório automático da Bia cobrança (POPMED), enviado todo dia às 8h.</p>
</div>`;
}

// deno-lint-ignore no-explicit-any
async function destinatarios(admin: any, accountId: string): Promise<string[]> {
  const { data } = await admin.from("accounts").select("internal_attributes").eq("id", accountId).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const lista = (data?.internal_attributes as any)?.relatorio_diario?.emails;
  return Array.isArray(lista) && lista.length ? lista.map(String) : DESTINATARIOS;
}

/** At 8h, once a day: e-mails yesterday's report. Never throws. */
// deno-lint-ignore no-explicit-any
export async function talvezEnviarRelatorio(admin: any, accountId: string, enviar: Envio, agora = new Date()) {
  try {
    const hoje = diaSP(agora);
    const horaSP = (agora.getUTCHours() + 24 - SP_OFFSET_H) % 24;
    if (horaSP !== HORA) return null;
    const { data: acc } = await admin.from("accounts").select("internal_attributes").eq("id", accountId).maybeSingle();
    // deno-lint-ignore no-explicit-any
    const ia = (acc?.internal_attributes ?? {}) as Record<string, any>;
    if (ia.relatorio_diario?.ultimo === hoje) return null;
    const ontem = diaSP(new Date(inicioDoDiaSP(hoje).getTime() - 12 * 3600_000));
    const r = await montarRelatorio(admin, accountId, ontem);
    const to = await destinatarios(admin, accountId);
    const res = await enviar(to, `Relatório da Bia — ${br(ontem)}`, htmlDoRelatorio(r));
    if (!res.ok) {
      console.error(`[relatorio-diario] e-mail falhou: ${res.error}`);
      return { enviado: false, erro: res.error };
    }
    await admin.from("accounts").update({
      internal_attributes: { ...ia, relatorio_diario: { ...(ia.relatorio_diario ?? {}), ultimo: hoje } },
    }).eq("id", accountId);
    console.log(`[relatorio-diario] enviado dia=${ontem} para=${to.length}`);
    return { enviado: true, dia: ontem };
  } catch (e) {
    console.error("[relatorio-diario] falhou", e);
    return { enviado: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

export { diaSP };
