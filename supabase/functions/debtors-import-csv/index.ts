// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── CSV parser (RFC 4180) ────────────────────────────────────────
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === "," || ch === ";") { row.push(field); field = ""; i++; continue; }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += ch; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

// ── Validações BR ───────────────────────────────────────────────
function onlyDigits(s: string): string {
  return s.replace(/\D/g, "");
}

function isValidCPF(doc: string): boolean {
  const cpf = onlyDigits(doc);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf[i]) * (10 - i);
  let d1 = (sum * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== parseInt(cpf[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf[i]) * (11 - i);
  let d2 = (sum * 10) % 11;
  if (d2 === 10) d2 = 0;
  return d2 === parseInt(cpf[10]);
}

function isValidCNPJ(doc: string): boolean {
  const cnpj = onlyDigits(doc);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (base: string, weights: number[]) => {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) sum += parseInt(base[i]) * weights[i];
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = calc(cnpj.slice(0, 12), w1);
  if (d1 !== parseInt(cnpj[12])) return false;
  const d2 = calc(cnpj.slice(0, 13), w2);
  return d2 === parseInt(cnpj[13]);
}

function classifyDoc(doc: string): { type: "cpf" | "cnpj" | null; clean: string | null; valid: boolean } {
  const clean = onlyDigits(doc);
  if (clean.length === 11) return { type: "cpf", clean, valid: isValidCPF(clean) };
  if (clean.length === 14) return { type: "cnpj", clean, valid: isValidCNPJ(clean) };
  return { type: null, clean: null, valid: false };
}

// Normaliza telefone BR para E.164 (+55...)
function normalizePhoneBR(raw: string): string | null {
  const digits = onlyDigits(raw);
  if (!digits) return null;
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if (digits.length === 12 || digits.length === 13) {
    return digits.startsWith("55") ? `+${digits}` : null;
  }
  return null;
}

// Parse valor em formato BR ("1.234,56" ou "1234.56")
function parseBRNumber(raw: string): number | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\s/g, "").replace(/^R\$/, "");
  if (!trimmed) return null;
  const hasComma = trimmed.includes(",");
  const hasDot = trimmed.includes(".");
  let normalized = trimmed;
  if (hasComma && hasDot) {
    // 1.234,56 → 1234.56 (formato BR)
    normalized = trimmed.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    normalized = trimmed.replace(",", ".");
  }
  const n = parseFloat(normalized);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseBRDate(raw: string): string | null {
  if (!raw) return null;
  const t = raw.trim();
  // ISO yyyy-mm-dd
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // BR dd/mm/yyyy ou dd-mm-yyyy
  const br = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (br) {
    const [, d, m, y] = br;
    const year = y.length === 2 ? 2000 + parseInt(y) : parseInt(y);
    const iso = `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    // Valida
    if (!isNaN(Date.parse(iso))) return iso;
  }
  return null;
}

// ── Mapeamento de colunas (aceita aliases PT/EN) ───────────────
const COL_ALIASES: Record<string, string[]> = {
  name:       ["name", "nome", "devedor", "cliente"],
  phone:      ["phone", "telefone", "phone_number", "fone", "celular", "whatsapp"],
  email:      ["email", "e-mail", "e_mail"],
  doc:        ["cpf_cnpj", "cpf", "cnpj", "documento", "doc"],
  valor:      ["valor", "amount", "valor_devido", "divida", "débito", "debito"],
  vencimento: ["vencimento", "due_date", "data_vencimento", "venc"],
  descricao:  ["descricao", "descrição", "description", "ref", "referencia", "referência"],
  origem:     ["origem", "source", "tipo"],
  external:   ["external_ref", "id_externo", "id_origem", "ref_externa"],
};

function findCol(header: string[], key: keyof typeof COL_ALIASES): number {
  const aliases = COL_ALIASES[key];
  for (const alias of aliases) {
    const idx = header.indexOf(alias);
    if (idx >= 0) return idx;
  }
  return -1;
}

// ── Handler ─────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing authorization" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return json({ error: "Unauthorized" }, 401);

    const { data: au } = await supabase
      .from("account_users")
      .select("account_id")
      .eq("user_id", userData.user.id)
      .limit(1)
      .maybeSingle();

    if (!au?.account_id) return json({ error: "No account" }, 403);
    const accountId = au.account_id;

    const body = await req.json();
    const csv = String(body?.csv ?? "");
    const dryRun = Boolean(body?.dry_run);
    if (!csv.trim()) return json({ error: "Empty CSV" }, 400);

    const rows = parseCSV(csv);
    if (rows.length < 2) return json({ error: "CSV precisa de cabeçalho + pelo menos 1 linha" }, 400);

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = {
      name: findCol(header, "name"),
      phone: findCol(header, "phone"),
      email: findCol(header, "email"),
      doc: findCol(header, "doc"),
      valor: findCol(header, "valor"),
      vencimento: findCol(header, "vencimento"),
      descricao: findCol(header, "descricao"),
      origem: findCol(header, "origem"),
      external: findCol(header, "external"),
    };

    const missing: string[] = [];
    if (idx.name < 0) missing.push("nome");
    if (idx.phone < 0) missing.push("telefone");
    if (idx.valor < 0) missing.push("valor");
    if (idx.vencimento < 0) missing.push("vencimento");
    if (missing.length) {
      return json({ error: `Colunas obrigatórias faltando: ${missing.join(", ")}` }, 400);
    }

    const dataRows = rows.slice(1);
    const totalRows = dataRows.length;

    // Pré-carrega DNC e contatos existentes por telefone
    const { data: dncRows } = await supabase
      .from("dnc_list")
      .select("phone_e164")
      .eq("account_id", accountId);
    const dncSet = new Set<string>((dncRows ?? []).map((r: any) => r.phone_e164));

    const { data: existingContacts } = await supabase
      .from("contacts")
      .select("id, phone_number")
      .eq("account_id", accountId)
      .not("phone_number", "is", null);
    const existingByPhone = new Map<string, string>();
    for (const c of existingContacts ?? []) {
      if (c.phone_number) existingByPhone.set(c.phone_number, c.id);
    }

    // POPMED: each overdue monthly installment is its own row, so the same
    // phone appears once per installment and the Bia counts installments
    // (3+ → 10%). Only an identical installment (phone + due date + amount),
    // in this file or already in the Carteira, is a duplicate — before, any
    // repeated phone was dropped, and re-importing duplicated debts.
    const debtKey = (contactOrPhone: string, venc: string, valor: number) =>
      `${contactOrPhone}|${venc}|${valor.toFixed(2)}`;
    const existingDebtKeys = new Set<string>();
    {
      const contactIds = [...existingByPhone.values()];
      for (let k = 0; k < contactIds.length; k += 200) {
        const { data: debts } = await supabase
          .from("debts")
          .select("contact_id, vencimento, valor_original")
          .eq("account_id", accountId)
          .in("contact_id", contactIds.slice(k, k + 200));
        for (const d of debts ?? []) {
          if (d.vencimento && d.valor_original != null) {
            existingDebtKeys.add(debtKey(d.contact_id, String(d.vencimento).slice(0, 10), Number(d.valor_original)));
          }
        }
      }
    }

    let imported = 0;
    let skippedDnc = 0;
    let skippedDup = 0;
    let invalid = 0;
    const errors: { row: number; message: string }[] = [];
    const seenInBatch = new Set<string>();

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNum = i + 2;
      try {
        const get = (n: number) => (n >= 0 ? (row[n]?.trim() ?? "") : "");

        const name = get(idx.name);
        const phoneRaw = get(idx.phone);
        const valorRaw = get(idx.valor);
        const vencRaw = get(idx.vencimento);

        if (!name) { errors.push({ row: rowNum, message: "Nome vazio" }); invalid++; continue; }

        const phone = normalizePhoneBR(phoneRaw);
        if (!phone) {
          errors.push({ row: rowNum, message: `Telefone inválido: "${phoneRaw}"` });
          invalid++; continue;
        }

        const valor = parseBRNumber(valorRaw);
        if (valor == null) {
          errors.push({ row: rowNum, message: `Valor inválido: "${valorRaw}"` });
          invalid++; continue;
        }

        const vencimento = parseBRDate(vencRaw);
        if (!vencimento) {
          errors.push({ row: rowNum, message: `Vencimento inválido: "${vencRaw}"` });
          invalid++; continue;
        }

        if (dncSet.has(phone)) { skippedDnc++; continue; }
        const rowKey = debtKey(phone, vencimento, valor);
        if (seenInBatch.has(rowKey)) { skippedDup++; continue; }
        seenInBatch.add(rowKey);
        const knownContact = existingByPhone.get(phone);
        if (knownContact && existingDebtKeys.has(debtKey(knownContact, vencimento, valor))) {
          skippedDup++; continue;
        }

        const email = idx.email >= 0 ? (get(idx.email) || null) : null;
        const docRaw = idx.doc >= 0 ? get(idx.doc) : "";
        const docInfo = docRaw ? classifyDoc(docRaw) : { type: null, clean: null, valid: true };
        if (docRaw && !docInfo.valid) {
          errors.push({ row: rowNum, message: `CPF/CNPJ inválido: "${docRaw}"` });
          invalid++; continue;
        }

        const descricao = idx.descricao >= 0 ? get(idx.descricao) || null : null;
        const origem = idx.origem >= 0 ? get(idx.origem) || null : null;
        const external = idx.external >= 0 ? get(idx.external) || null : null;

        if (dryRun) { imported++; continue; }

        // Upsert contato
        let contactId: string | undefined = existingByPhone.get(phone);
        if (!contactId) {
          const { data: newContact, error: cErr } = await supabase
            .from("contacts")
            .insert({
              account_id: accountId,
              name,
              email,
              phone_number: phone,
              custom_attributes: external ? { external_ref: external } : {},
            })
            .select("id")
            .single();
          if (cErr || !newContact) {
            errors.push({ row: rowNum, message: cErr?.message ?? "Falha ao criar contato" });
            continue;
          }
          contactId = newContact.id as string;
          existingByPhone.set(phone, contactId);
        }

        // Upsert debtor_profile
        if (docInfo.type && docInfo.clean) {
          await supabase
            .from("debtor_profiles")
            .upsert(
              {
                contact_id: contactId,
                account_id: accountId,
                doc_type: docInfo.type,
                doc_number: docInfo.clean,
                external_ref: external,
              },
              { onConflict: "contact_id" },
            );
        } else if (external) {
          await supabase
            .from("debtor_profiles")
            .upsert(
              { contact_id: contactId, account_id: accountId, external_ref: external },
              { onConflict: "contact_id" },
            );
        }

        // Cria dívida
        const { error: dErr } = await supabase.from("debts").insert({
          account_id: accountId,
          contact_id: contactId,
          external_ref: external,
          descricao,
          valor_original: valor,
          valor_atual: valor,
          vencimento,
          origem,
          status: "aberto",
        });
        if (dErr) {
          errors.push({ row: rowNum, message: dErr.message });
          continue;
        }

        imported++;
      } catch (e: any) {
        errors.push({ row: rowNum, message: e?.message ?? "Erro desconhecido" });
        invalid++;
      }
    }

    return json({
      totalRows,
      imported,
      skipped_dnc: skippedDnc,
      skipped_duplicate: skippedDup,
      invalid,
      errors: errors.slice(0, 100),
      dry_run: dryRun,
    });
  } catch (e: any) {
    console.error("[debtors-import-csv]", e);
    return json({ error: e?.message ?? "Internal error" }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
