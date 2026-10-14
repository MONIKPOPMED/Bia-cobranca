// Provision an Evolution API instance for a Nexus WhatsApp channel.
//
// Flow (called by the UI's "Salvar e gerar instância" button):
//   1. Caller must be admin of the target account.
//   2. Upsert a `channels` row with channel_type='whatsapp' and the Evolution
//      URL + apiKey in config.
//   3. Call Evolution `/instance/create` (idempotent on 409), point its
//      webhook at our `evolution-incoming` fn using the shared secret.
//   4. Auto-provision a matching `inbox` so inbound messages have a home.
//   5. Persist instance_name + initial status in channels.config; return
//      QR payload if Evolution included one in the create response.
//
// Separate ping mode via body.mode='test': just reachability + auth check,
// no DB writes. Keeps the UI's "Testar conexão" button side-effect-free.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import {
  EvolutionError,
  createInstance,
  getQrCode,
  instanceNameFor,
  logoutInstance,
  ping,
} from "../_shared/evolution/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  account_id: string;
  mode?: "test" | "provision";
  evolution_url?: string;
  evolution_api_key?: string;
  channel_id?: string; // when updating an existing channel
  channel_name?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return j({ error: "unauthorized" }, 401);

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: u } = await userClient.auth.getUser();
  const uid = u?.user?.id;
  if (!uid) return j({ error: "unauthorized" }, 401);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return j({ error: "body must be JSON" }, 400);
  }

  if (!body.account_id) return j({ error: "account_id required" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: role } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", uid)
    .eq("account_id", body.account_id)
    .maybeSingle();
  if (!role || role.role !== "admin") return j({ error: "admin role required" }, 403);

  // Reconnecting an existing channel: the dialog says "deixe a API key em
  // branco para manter", so fall back to what is stored on the channel.
  // deno-lint-ignore no-explicit-any
  let storedConfig: Record<string, any> | null = null;
  if (body.channel_id) {
    const { data: existingChannel } = await admin
      .from("channels")
      .select("config")
      .eq("id", body.channel_id)
      .eq("account_id", body.account_id)
      .maybeSingle();
    if (!existingChannel) {
      return j({ error: "channel not found or not yours" }, 404);
    }
    storedConfig = (existingChannel.config ?? {}) as Record<string, unknown>;
  }

  const url = (body.evolution_url?.trim() || storedConfig?.evolution_url || "").trim();
  const apiKey = (body.evolution_api_key?.trim() || storedConfig?.evolution_api_key || "").trim();
  if (!url || !apiKey) {
    return j({ error: "evolution_url and evolution_api_key required" }, 400);
  }

  // ─── Test mode: reachability + auth only ─────────────────────────────
  if (body.mode === "test") {
    try {
      const r = await ping(url, apiKey);
      return j({ ok: true, instance_count: r.count });
    } catch (e) {
      const status = e instanceof EvolutionError ? e.status : 0;
      const hint = status === 403
        ? "API key sem permissão. Use a global API key (AUTHENTICATION_API_KEY do .env do servidor Evolution) — não uma key escopada a instância."
        : status === 401
        ? "API key inválida ou ausente. Confira a AUTHENTICATION_API_KEY do servidor Evolution."
        : "Verifique a URL e a API key do servidor Evolution.";
      return j({ error: errMsg(e), hint }, 400);
    }
  }

  // ─── Provision ───────────────────────────────────────────────────────
  const webhookSecret = Deno.env.get("EVOLUTION_WEBHOOK_SECRET") ?? "";
  if (!webhookSecret) {
    return j({ error: "EVOLUTION_WEBHOOK_SECRET not configured in Cloud Secrets" }, 500);
  }

  const webhookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/evolution-incoming`;

  // Resolve the target channel first. If channel_id was passed, we're
  // reconnecting an existing instance — reuse its stored instance name so
  // Evolution treats this as a re-create rather than a brand-new handle.
  // Otherwise we always create a NEW channel row (multi-instance). The
  // instance name is derived from the new channel.id to stay unique per
  // channel on a shared Evolution server.
  let channelId = body.channel_id;
  let existingInstanceName: string | undefined;

  if (channelId) {
    existingInstanceName = storedConfig?.evolution_instance_name;
  } else {
    const { data: created, error } = await admin
      .from("channels")
      .insert({
        account_id: body.account_id,
        channel_type: "whatsapp",
        name: body.channel_name ?? "WhatsApp (Evolution)",
        config: {
          evolution_url: url,
          evolution_api_key: apiKey,
          evolution_instance_status: "connecting",
        },
        enabled: true,
      })
      .select("id")
      .single();
    if (error) return j({ error: `channel insert failed: ${error.message}` }, 500);
    channelId = created.id;
  }

  const instanceName =
    existingInstanceName ??
    instanceNameFor(body.account_id, channelId!.replace(/-/g, "").slice(0, 8));

  let provisioned: Awaited<ReturnType<typeof createInstance>>;
  try {
    provisioned = await createInstance({
      url,
      apiKey,
      instanceName,
      webhookUrl,
      webhookSecret,
    });
  } catch (e) {
    const status = e instanceof EvolutionError ? e.status : 500;
    const hint = status === 403
      ? "API key sem permissão para criar instâncias. Use a global API key (AUTHENTICATION_API_KEY do .env do servidor Evolution) — não uma key escopada a instância."
      : status === 401
      ? "API key inválida. Confira a AUTHENTICATION_API_KEY do servidor Evolution."
      : undefined;
    return j(
      { error: `falha ao criar instância: ${errMsg(e)}`, upstream_status: status, hint },
      status >= 400 && status < 500 ? 400 : 502,
    );
  }

  // Reconnect of an existing instance: /instance/create does not return a
  // QR code, and a "zombie" session (state "open" but sends fail with
  // "Connection Closed") never offers one. Drop the session and ask for a
  // fresh QR so the operator can pair the phone again.
  if (existingInstanceName && !provisioned.qrcode?.base64) {
    try {
      await logoutInstance({ url, apiKey, instanceName: provisioned.instanceName });
      const qr = await getQrCode({ url, apiKey, instanceName: provisioned.instanceName });
      if (qr?.base64) provisioned = { ...provisioned, qrcode: { base64: qr.base64 } };
    } catch (e) {
      console.warn(`[evolution-provision] reconnect QR failed for ${provisioned.instanceName}:`, e);
    }
  }

  // Persist the final config now that Evolution confirmed the instance name.
  // Keeps any other keys already stored on the channel.
  const channelConfig = {
    ...(storedConfig ?? {}),
    evolution_url: url,
    evolution_api_key: apiKey,
    evolution_instance_name: provisioned.instanceName,
    evolution_instance_status: provisioned.qrcode?.base64 ? "qr_ready" : "connecting",
  };

  await admin
    .from("channels")
    .update({
      config: channelConfig,
      name: body.channel_name ?? "WhatsApp (Evolution)",
      enabled: true,
    })
    .eq("id", channelId);

  // Ensure inbox exists.
  const { data: inboxExisting } = await admin
    .from("inboxes")
    .select("id")
    .eq("channel_id", channelId!)
    .maybeSingle();
  if (!inboxExisting) {
    await admin.from("inboxes").insert({
      account_id: body.account_id,
      channel_id: channelId!,
      channel_type: "whatsapp",
      name: body.channel_name ?? "WhatsApp",
    });
  }

  return j({
    ok: true,
    channel_id: channelId,
    instance_name: provisioned.instanceName,
    qrcode_base64: provisioned.qrcode?.base64 ?? null,
    status: channelConfig.evolution_instance_status,
  });
});

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
