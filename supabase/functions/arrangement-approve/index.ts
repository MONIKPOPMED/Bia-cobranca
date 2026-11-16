// deno-lint-ignore-file no-explicit-any
//
// Aprova manualmente um payment_arrangement em pendente_aprovacao.
// Side-effects: muda status pra pendente, registra approved_at/by, dispara
// proposal-dispatch em background (Asaas + WhatsApp).
//
// Body: { arrangement_id: uuid, override?: { valor_negociado?, num_parcelas?,
//         metodo?, primeiro_vencimento? } }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return j({ error: "unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(supabaseUrl, serviceKey);

  let body: {
    arrangement_id: string;
    override?: {
      valor_negociado?: number;
      num_parcelas?: number;
      metodo?: string;
      primeiro_vencimento?: string;
    };
  };
  try { body = await req.json(); } catch { return j({ error: "bad json" }, 400); }
  if (!body.arrangement_id) return j({ error: "arrangement_id required" }, 400);

  // Aplica overrides ANTES de aprovar (se houver), via service role pra contornar RLS
  if (body.override) {
    const o = body.override;
    const updates: Record<string, unknown> = {};
    if (typeof o.valor_negociado === "number" && o.valor_negociado > 0) updates.valor_negociado = o.valor_negociado;
    if (typeof o.num_parcelas === "number" && o.num_parcelas > 0) updates.num_parcelas = o.num_parcelas;
    if (o.metodo) updates.metodo = o.metodo;
    if (o.primeiro_vencimento) updates.primeiro_vencimento = o.primeiro_vencimento;
    if (Object.keys(updates).length > 0) {
      const { error: upErr } = await admin
        .from("payment_arrangements")
        .update(updates)
        .eq("id", body.arrangement_id)
        .eq("status", "pendente_aprovacao");
      if (upErr) return j({ error: `override falhou: ${upErr.message}` }, 500);
    }
  }

  // Aprova via RPC (faz checks de membership + transição)
  const { error: rpcErr } = await userClient.rpc("approve_arrangement", {
    p_arrangement_id: body.arrangement_id,
  });
  if (rpcErr) return j({ error: rpcErr.message }, 400);

  // Dispara proposal-dispatch (Asaas + WhatsApp) em background
  fetch(`${supabaseUrl}/functions/v1/proposal-dispatch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ arrangement_id: body.arrangement_id }),
  }).catch((e) => console.warn("[arrangement-approve] dispatch fail", e));

  return j({ ok: true, arrangement_id: body.arrangement_id });
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
