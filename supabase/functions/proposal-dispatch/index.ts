// deno-lint-ignore-file no-explicit-any
//
// Orquestra o envio da proposta de pagamento de um payment_arrangement:
//   1. Se o arrangement não tem asaas_charge_id → chama asaas-create-charge
//   2. Envia a proposta pelo WhatsApp (evolution-send-proposal)
//   3. Retorna status agregado
//
// Body: { arrangement_id: uuid }
// E-mail removido em 16/11 a pedido da POPMED (só mensagem no celular).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  let body: { arrangement_id: string };
  try { body = await req.json(); } catch { return j({ error: "bad json" }, 400); }
  if (!body.arrangement_id) return j({ error: "arrangement_id required" }, 400);

  const channels = ["whatsapp"] as const;

  // 1. Garante charge Asaas
  const { data: arr } = await admin
    .from("payment_arrangements")
    .select("id, asaas_charge_id, asaas_payment_url, status")
    .eq("id", body.arrangement_id)
    .maybeSingle();
  if (!arr) return j({ error: "arrangement not found" }, 404);

  let chargeResult: any = { already_created: Boolean(arr.asaas_charge_id) };
  if (!arr.asaas_charge_id) {
    const chargeRes = await invokeFn(supabaseUrl, serviceKey, "asaas-create-charge", {
      arrangement_id: arr.id,
    });
    chargeResult = await chargeRes.json().catch(() => ({}));
    if (!chargeRes.ok) {
      return j(
        { error: "Falha ao criar cobrança no Asaas", detail: chargeResult },
        502,
      );
    }
  }

  // 2. Envia pelo WhatsApp
  const results: Record<string, any> = {};
  await Promise.all(
    channels.map(async (ch) => {
      const fn = "evolution-send-proposal";
      try {
        const res = await invokeFn(supabaseUrl, serviceKey, fn, {
          arrangement_id: arr.id,
        });
        results[ch] = { status: res.status, body: await res.json().catch(() => ({})) };
      } catch (e: any) {
        results[ch] = { error: String(e?.message ?? e) };
      }
    }),
  );

  return j({
    ok: true,
    arrangement_id: arr.id,
    charge: chargeResult,
    deliveries: results,
  });
});

async function invokeFn(
  supabaseUrl: string,
  serviceKey: string,
  fn: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${supabaseUrl}/functions/v1/${fn}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
