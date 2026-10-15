/**
 * "Anexar planilha" in the WhatsApp campaign form: reads the POPMED Excel
 * (or a CSV) in the browser and turns it into the CSV debtors-import-csv
 * expects (nome, telefone, cpf_cnpj, valor, vencimento, descricao, origem,
 * external_ref). Same rules used by hand on 09/10:
 *
 * - POPMED layout: columns CD_CLIENTE, CPF, Telefone, Nome, Situação,
 *   Forma de Pagamento, Valor Plano, OBS; one sheet per month.
 * - Only "PAGAMENTO PENDENTE NO PERÍODO" (the Bia only handles those).
 * - One line per overdue installment, from the "PEN - dd/mm dd/mm" dates in
 *   OBS; installments not due yet are left out.
 * - A sheet already in the importer layout (nome, telefone, valor,
 *   vencimento) goes through as-is.
 */

export type SheetData = { name: string; rows: string[][] };

export type ConvertedSheet = {
  format: "popmed" | "padrao";
  csv: string;
  /** E.164 phones in the CSV — used to find the contacts after the import. */
  phones: string[];
  clients: number;
  installments: number;
  /** Customers in the sheet that are not "PAGAMENTO PENDENTE NO PERÍODO". */
  notPending: number;
  /** Installments (or customers without a PEN date) left out because nothing is overdue. */
  notDueYet: number;
  problems: string[];
};

const PENDING = "PAGAMENTO PENDENTE NO PERÍODO";
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const CSV_HEADER = ["nome", "telefone", "cpf_cnpj", "valor", "vencimento", "descricao", "origem", "external_ref"];

export async function readSpreadsheet(file: File): Promise<SheetData[]> {
  const XLSX = await import("xlsx");
  const isCsv = /\.csv$/i.test(file.name);
  const wb = isCsv
    ? XLSX.read(await file.text(), { type: "string", raw: true })
    : XLSX.read(await file.arrayBuffer(), { type: "array" });
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils
      .sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: false, defval: "" })
      .map((row) => row.map((cell) => String(cell ?? "").trim())),
  }));
}

const norm = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function isPopmed(header: string[]) {
  const h = header.map(norm);
  return ["telefone", "nome", "situacao", "valor plano", "obs"].every((c) => h.includes(c));
}

function isStandard(header: string[]) {
  const h = header.map(norm);
  return ["nome", "telefone", "valor", "vencimento"].every((c) => h.includes(c));
}

export function isUsableSheet(sheet: SheetData) {
  const header = sheet.rows[0] ?? [];
  return isPopmed(header) || isStandard(header);
}

/** Sheet to open first: the current month's, else the last usable one. */
export function defaultSheet(sheets: SheetData[], today = new Date()): string | null {
  const usable = sheets.filter(isUsableSheet);
  const month = MONTHS[today.getMonth()];
  return usable.find((s) => norm(s.name).includes(norm(month)))?.name ?? usable.at(-1)?.name ?? null;
}

const quote = (s: string) => (/[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

function toE164(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  return d.length === 10 || d.length === 11 ? `+55${d}` : null;
}

/** "dd/mm" → ISO date. A date more than a month ahead belongs to last year (January sheet with December dates). */
function pendDate(ddmm: string, today: Date): string {
  const [dd, mm] = ddmm.split("/");
  let year = today.getFullYear();
  const candidate = new Date(`${year}-${mm}-${dd}T12:00:00-03:00`);
  if (candidate.getTime() - today.getTime() > 31 * 86_400_000) year -= 1;
  return `${year}-${mm}-${dd}`;
}

export function convertSheet(sheet: SheetData, today = new Date()): ConvertedSheet {
  const [header = [], ...body] = sheet.rows;
  const data = body.filter((r) => r.some((c) => c));
  const h = header.map(norm);
  const col = (name: string) => h.indexOf(name);

  if (isStandard(header) && !isPopmed(header)) {
    const phoneCol = col("telefone");
    const phones = data.map((r) => toE164(r[phoneCol] ?? "")).filter((p): p is string => !!p);
    return {
      format: "padrao",
      csv: [header.map(quote).join(","), ...data.map((r) => r.map(quote).join(","))].join("\n") + "\n",
      phones: [...new Set(phones)],
      clients: new Set(phones).size,
      installments: data.length,
      notPending: 0,
      notDueYet: 0,
      problems: data.filter((r) => !toE164(r[phoneCol] ?? "")).map((r) => `${r[col("nome")] || "Sem nome"}: telefone "${r[phoneCol]}"`),
    };
  }
  if (!isPopmed(header)) {
    throw new Error("Não reconheci as colunas desta aba. Esperado: Telefone, Nome, Situação, Valor Plano e OBS (planilha da POPMED) ou nome, telefone, valor e vencimento.");
  }

  const C = {
    cd: col("cd_cliente"), cpf: col("cpf"), tel: col("telefone"), nome: col("nome"),
    sit: col("situacao"), forma: col("forma de pagamento"), valor: col("valor plano"), obs: col("obs"),
  };
  const end = new Date(today); end.setHours(23, 59, 59, 999);
  const pending = data.filter((r) => norm(r[C.sit] ?? "") === norm(PENDING));
  const lines: string[][] = [];
  const problems: string[] = [];
  let notDueYet = 0;

  for (const r of pending) {
    const nome = r[C.nome] ?? "";
    const phone = toE164(r[C.tel] ?? "");
    const valor = Number(String(r[C.valor] ?? "").replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
    const cpf = C.cpf >= 0 ? String(r[C.cpf] ?? "").replace(/\D/g, "").padStart(11, "0") : "";
    const m = String(r[C.obs] ?? "").match(/PEN\s*-\s*([\d/\s]+?)(?:\||-|$)/i);
    const dates = m ? m[1].match(/\d{2}\/\d{2}/g) ?? [] : [];

    if (!nome) { problems.push(`${r[C.cd] || "Linha sem código"}: sem nome`); continue; }
    if (!phone) { problems.push(`${nome}: telefone "${r[C.tel]}"`); continue; }
    if (!(valor > 0)) { problems.push(`${nome}: Valor Plano "${r[C.valor]}"`); continue; }
    if (!dates.length) { notDueYet++; continue; }

    for (const d of dates) {
      const iso = pendDate(d, today);
      if (new Date(`${iso}T12:00:00-03:00`) > end) { notDueYet++; continue; }
      lines.push([
        nome, phone, cpf === "00000000000" ? "" : cpf, valor.toFixed(2), iso,
        `Mensalidade POPMED vencida em ${d}/${iso.slice(0, 4)}`,
        C.forma >= 0 ? r[C.forma] ?? "" : "", C.cd >= 0 ? r[C.cd] ?? "" : "",
      ]);
    }
  }

  const phones = [...new Set(lines.map((l) => l[1]))];
  return {
    format: "popmed",
    csv: [CSV_HEADER.join(","), ...lines.map((l) => l.map(quote).join(","))].join("\n") + "\n",
    phones,
    clients: phones.length,
    installments: lines.length,
    notPending: data.length - pending.length,
    notDueYet,
    problems,
  };
}

/** The contact may be stored with or without the 9th digit (WhatsApp JIDs). */
export function phoneLookupVariants(e164: string): string[] {
  const out = new Set([e164, e164.slice(1)]);
  const m = e164.match(/^\+55(\d{2})9(\d{8})$/);
  if (m) { out.add(`+55${m[1]}${m[2]}`); out.add(`55${m[1]}${m[2]}`); }
  return [...out];
}
