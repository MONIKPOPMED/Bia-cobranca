// Daily e-mail report of the Bia's WhatsApp work (POPMED, 09/11): every day at
// 8h (America/Sao_Paulo) a summary of the previous day goes to the team.
// Runs inside whatsapp-health-check (pg_cron every 5 min); sent once a day,
// remembered on accounts.internal_attributes.relatorio_diario.ultimo.
//
// Recipients: accounts.internal_attributes.relatorio_diario.emails, else
// DESTINATARIOS.

import { sendText } from "./evolution/index.ts";
import { loadWhatsAppSender } from "./team-handoff.ts";

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
  /** Last day of a period report (10/11: month-to-date and monthly reports). */
  ate?: string;
  /** Title override, e.g. "Relatório do mês — novembro/2026". */
  titulo?: string;
  disparos: number;
  links: number;
  responderam: number;
  comprovantes: number;
  nomesComprovantes: string[];
};

/** PostgREST returns at most 1000 rows per request: page through a period. */
// deno-lint-ignore no-explicit-any
async function todasAsLinhas<T>(consulta: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await consulta().range(de, de + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

/** Report for one day, or for the days `dia`..`ate` (inclusive, São Paulo). */
// deno-lint-ignore no-explicit-any
export async function montarRelatorio(admin: any, accountId: string, dia: string, ate = dia): Promise<Relatorio> {
  const ini = inicioDoDiaSP(dia).toISOString();
  const fim = new Date(inicioDoDiaSP(ate).getTime() + 24 * 3600_000).toISOString();

  // 1. Campaign messages sent in the period.
  const { count: disparos } = await admin
    .from("whatsapp_campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .gte("sent_at", ini)
    .lt("sent_at", fim);

  // 2. Payment links sent (one per conversation; the link part says "Segue link").
  const linkMsgs = await todasAsLinhas<{ conversation_id: string }>(() =>
    admin
      .from("messages")
      .select("conversation_id")
      .eq("account_id", accountId)
      .eq("message_type", 1)
      .or("content.ilike.%Segue link%,content.ilike.%order-pay%")
      .gte("created_at", ini)
      .lt("created_at", fim)
      .order("id")
  );
  const links = new Set(linkMsgs.map((m) => m.conversation_id)).size;

  // 3. Customers who wrote in the period.
  const rows = await todasAsLinhas<{ conversation_id: string; content_attributes: Record<string, unknown> | null }>(() =>
    admin
      .from("messages")
      .select("conversation_id, content_attributes")
      .eq("account_id", accountId)
      .eq("message_type", 0)
      .eq("private", false)
      .gte("created_at", ini)
      .lt("created_at", fim)
      .order("id")
  );
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

  return {
    dia,
    ...(ate !== dia ? { ate } : {}),
    disparos: disparos ?? 0,
    links,
    responderam,
    comprovantes: convComprovante.length,
    nomesComprovantes,
  };
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function tituloDoRelatorio(r: Relatorio): string {
  if (r.titulo) return r.titulo;
  return r.ate ? `Relatório da Bia — ${br(r.dia)} a ${br(r.ate)}` : `Relatório da Bia — dia ${br(r.dia)}`;
}

export function htmlDoRelatorio(r: Relatorio): string {
  const linha = (n: number, txt: string) => `<p style="margin:0 0 8px;font-size:15px;color:#222"><b>${n}</b> ${txt}</p>`;
  const nomes = r.nomesComprovantes.length
    ? `<ul style="margin:4px 0 0;padding-left:20px;font-size:14px;color:#222">${r.nomesComprovantes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`
    : `<p style="margin:4px 0 0;font-size:14px;color:#777">Nenhum.</p>`;
  return `<div style="font-family:Arial,sans-serif;max-width:560px">
<h2 style="color:#7c3aed;margin:0 0 12px">${esc(tituloDoRelatorio(r))}</h2>
${linha(r.disparos, r.disparos === 1 ? "disparo" : "disparos")}
${linha(r.links, r.links === 1 ? "cliente recebeu link de pagamento da Bia" : "clientes receberam link de pagamento da Bia")}
${linha(r.responderam, r.responderam === 1 ? "cliente respondeu" : "clientes responderam")}
${linha(r.comprovantes, r.comprovantes === 1 ? "cliente enviou comprovante de pagamento e a Bia encaminhou ao grupo do financeiro" : "clientes enviaram comprovante de pagamento e a Bia encaminhou ao grupo do financeiro")}
<p style="margin:12px 0 0;font-size:14px;color:#222"><b>Nome desses clientes:</b></p>
${nomes}
<p style="margin:16px 0 0;font-size:12px;color:#777">Relatório automático da Bia cobrança (POPMED)${r.ate ? "" : ", enviado todo dia às 8h"}.</p>
</div>`;
}

/** WhatsApp version (09/11: the e-mail service key is invalid; POPMED asked for WhatsApp). */
export function textoDoRelatorio(r: Relatorio): string {
  const nomes = r.nomesComprovantes.length ? r.nomesComprovantes.map((n) => `• ${n}`).join("\n") : "Nenhum.";
  return [
    `📊 *${tituloDoRelatorio(r)}*`,
    "",
    `*${r.disparos}* ${r.disparos === 1 ? "disparo" : "disparos"}`,
    `*${r.links}* ${r.links === 1 ? "cliente recebeu" : "clientes receberam"} link de pagamento da Bia`,
    `*${r.responderam}* ${r.responderam === 1 ? "cliente respondeu" : "clientes responderam"}`,
    `*${r.comprovantes}* ${r.comprovantes === 1 ? "cliente enviou" : "clientes enviaram"} comprovante de pagamento e a Bia encaminhou ao grupo do financeiro`,
    "",
    "*Nome desses clientes:*",
    nomes,
  ].join("\n");
}

const WHATSAPP_PADRAO = ["5548991667070", "5548991496112", "554891151935"]; // Monik, Emerson, Eduardo

// deno-lint-ignore no-explicit-any
async function whatsappDestinos(admin: any, accountId: string): Promise<string[]> {
  const { data } = await admin.from("accounts").select("internal_attributes").eq("id", accountId).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const lista = (data?.internal_attributes as any)?.relatorio_diario?.whatsapp;
  return Array.isArray(lista) && lista.length ? lista.map((n: unknown) => String(n).replace(/\D/g, "")) : WHATSAPP_PADRAO;
}

/** Sends to each number; a BR mobile saved without the 9th digit is retried with it. */
// deno-lint-ignore no-explicit-any
export async function enviarPorWhatsApp(admin: any, accountId: string, texto: string, numeros?: string[]) {
  const sender = await loadWhatsAppSender(admin, accountId);
  if (!sender) return { ok: false, erro: "WhatsApp desconectado", enviados: 0 };
  const destinos = numeros ?? await whatsappDestinos(admin, accountId);
  let enviados = 0;
  const erros: string[] = [];
  for (const n of destinos) {
    const tentativas = n.length === 12 && n.startsWith("55") ? [n, `${n.slice(0, 4)}9${n.slice(4)}`] : [n];
    let foi = false;
    for (const numero of tentativas) {
      try {
        await sendText({ ...sender, number: numero, text: texto });
        foi = true;
        break;
      } catch (e) {
        erros.push(`${numero.slice(-4)}: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`);
      }
    }
    if (foi) enviados++;
  }
  return { ok: enviados > 0, enviados, erro: erros.length ? erros.join(" | ") : undefined };
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
    // WhatsApp is the main channel; the e-mail goes too when the Resend key works.
    const wa = await enviarPorWhatsApp(admin, accountId, textoDoRelatorio(r));
    const to = await destinatarios(admin, accountId);
    const res = await enviar(to, `Relatório da Bia — ${br(ontem)}`, htmlDoRelatorio(r));
    if (!res.ok) console.warn(`[relatorio-diario] e-mail falhou: ${res.error}`);
    if (wa.erro) console.warn(`[relatorio-diario] WhatsApp: ${wa.erro}`);
    if (!wa.ok && !res.ok) return { enviado: false, erro: wa.erro ?? res.error };
    await admin.from("accounts").update({
      internal_attributes: { ...ia, relatorio_diario: { ...(ia.relatorio_diario ?? {}), ultimo: hoje } },
    }).eq("id", accountId);
    console.log(`[relatorio-diario] enviado dia=${ontem} whatsapp=${wa.enviados} email=${res.ok}`);
    return { enviado: true, dia: ontem, whatsapp: wa.enviados, email: res.ok };
  } catch (e) {
    console.error("[relatorio-diario] falhou", e);
    return { enviado: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

/** Hour of the monthly report on the month's last day: after the 9h–18h sending window. */
const HORA_MENSAL = 18;

/** Month report of `dia`'s month, from the 1st up to `dia`. */
// deno-lint-ignore no-explicit-any
export async function montarRelatorioDoMes(admin: any, accountId: string, dia: string): Promise<Relatorio> {
  const [ano, mes] = dia.split("-");
  const r = await montarRelatorio(admin, accountId, `${ano}-${mes}-01`, dia);
  return { ...r, ate: dia, titulo: `Relatório do mês da Bia — ${MESES[Number(mes) - 1]}/${ano} (${br(`${ano}-${mes}-01`)} a ${br(dia)})` };
}

/** Sends a report to the team: WhatsApp (main) + e-mail. */
// deno-lint-ignore no-explicit-any
export async function enviarRelatorioParaEquipe(admin: any, accountId: string, r: Relatorio, enviar: Envio) {
  const wa = await enviarPorWhatsApp(admin, accountId, textoDoRelatorio(r));
  const res = await enviar(await destinatarios(admin, accountId), tituloDoRelatorio(r), htmlDoRelatorio(r));
  if (!res.ok) console.warn(`[relatorio-diario] e-mail falhou: ${res.error}`);
  if (wa.erro) console.warn(`[relatorio-diario] WhatsApp: ${wa.erro}`);
  return { ok: wa.ok || res.ok, whatsapp: wa.enviados, email: res.ok, erro: wa.erro ?? res.error };
}

/**
 * Last day of the month at 18h (POPMED, 10/11): the month's total, once.
 * Remembered on internal_attributes.relatorio_mensal.ultimo ("aaaa-mm"). Never throws.
 */
// deno-lint-ignore no-explicit-any
export async function talvezEnviarRelatorioMensal(admin: any, accountId: string, enviar: Envio, agora = new Date()) {
  try {
    const hoje = diaSP(agora);
    const amanha = diaSP(new Date(agora.getTime() + 24 * 3600_000));
    const horaSP = (agora.getUTCHours() + 24 - SP_OFFSET_H) % 24;
    if (horaSP !== HORA_MENSAL || amanha.slice(0, 7) === hoje.slice(0, 7)) return null;
    const mes = hoje.slice(0, 7);
    const { data: acc } = await admin.from("accounts").select("internal_attributes").eq("id", accountId).maybeSingle();
    // deno-lint-ignore no-explicit-any
    const ia = (acc?.internal_attributes ?? {}) as Record<string, any>;
    if (ia.relatorio_mensal?.ultimo === mes) return null;
    const r = await montarRelatorioDoMes(admin, accountId, hoje);
    const env = await enviarRelatorioParaEquipe(admin, accountId, r, enviar);
    if (!env.ok) return { mensal: true, enviado: false, erro: env.erro };
    await admin.from("accounts").update({
      internal_attributes: { ...ia, relatorio_mensal: { ...(ia.relatorio_mensal ?? {}), ultimo: mes } },
    }).eq("id", accountId);
    console.log(`[relatorio-diario] mensal enviado mes=${mes} whatsapp=${env.whatsapp} email=${env.email}`);
    return { mensal: true, enviado: true, mes, whatsapp: env.whatsapp, email: env.email };
  } catch (e) {
    console.error("[relatorio-diario] mensal falhou", e);
    return { mensal: true, enviado: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

export { diaSP };
