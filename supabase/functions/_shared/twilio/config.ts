// Resolves Twilio credentials per channel/account.
// Resolution order: account Vault → channel/phone_number config → env vars.
// Per-account secrets live in `vault.secrets` via `account_secrets` (RPCs
// `set_account_secret` / `get_account_secret`). Env vars are only a dev
// fallback.

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import type { TwilioCredentials } from "./client.ts";
import { resolveSecretsBulk } from "../secrets/vault.ts";

export class TwilioConfigError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "TwilioConfigError";
    this.status = status;
  }
}

export interface TwilioChannelConfig {
  channelId: string;
  accountId: string;
  e164?: string;
  messagingServiceSid?: string;
  credentials: TwilioCredentials;
}

/**
 * Load an SMS channel's Twilio creds + sending number or messaging service SID.
 */
export async function loadSmsChannelConfig(
  admin: SupabaseClient,
  channelId: string,
): Promise<TwilioChannelConfig> {
  const { data, error } = await admin
    .from("channels")
    .select("id, account_id, channel_type, config, enabled")
    .eq("id", channelId)
    .maybeSingle();
  if (error) throw new TwilioConfigError(`channel lookup failed: ${error.message}`, 500);
  if (!data) throw new TwilioConfigError("channel not found", 404);
  if (data.channel_type !== "sms") throw new TwilioConfigError("channel is not sms", 400);
  if (!data.enabled) throw new TwilioConfigError("channel disabled", 409);

  const cfg = (data.config ?? {}) as Record<string, any>;
  const creds = await resolveTwilioCredentials(admin, data.account_id, cfg);
  if (!creds.accountSid) throw new TwilioConfigError("twilio_account_sid not configured", 409);
  if (!creds.authToken && (!creds.apiKey || !creds.apiSecret)) {
    throw new TwilioConfigError("twilio auth (token or api key+secret) not configured", 409);
  }

  return {
    channelId: data.id,
    accountId: data.account_id,
    e164: cfg.from_number,
    messagingServiceSid: cfg.messaging_service_sid,
    credentials: creds,
  };
}

/**
 * Credentials tied to a phone_number row for voice dispatch.
 * Falls back to the account-level global creds if provider_config has none.
 */
export async function loadPhoneNumberCreds(
  admin: SupabaseClient,
  phoneNumberId: string,
): Promise<{ accountId: string; e164: string; creds: TwilioCredentials; providerConfig: any }> {
  const { data, error } = await admin
    .from("phone_numbers")
    .select("id, account_id, e164, provider, provider_config, enabled, outbound_enabled")
    .eq("id", phoneNumberId)
    .maybeSingle();
  if (error) throw new TwilioConfigError(`phone_number lookup failed: ${error.message}`, 500);
  if (!data) throw new TwilioConfigError("phone_number not found", 404);
  if (data.provider !== "twilio") throw new TwilioConfigError("phone_number not on twilio", 400);
  if (!data.enabled) throw new TwilioConfigError("phone_number disabled", 409);

  const cfg = (data.provider_config ?? {}) as Record<string, any>;
  const creds = await resolveTwilioCredentials(admin, data.account_id, cfg);
  if (!creds.accountSid) throw new TwilioConfigError("twilio_account_sid not configured", 409);

  return {
    accountId: data.account_id,
    e164: data.e164,
    creds,
    providerConfig: cfg,
  };
}

/**
 * Route an inbound SMS webhook to the correct Nexus account by looking up
 * which channel owns the destination (`To`) phone number.
 */
export async function findSmsChannelByToNumber(
  admin: SupabaseClient,
  toNumber: string,
): Promise<{ id: string; account_id: string; config: any } | null> {
  const { data } = await admin
    .from("channels")
    .select("id, account_id, config")
    .eq("channel_type", "sms")
    .filter("config->>from_number", "eq", toNumber)
    .maybeSingle();
  return data ?? null;
}

/**
 * For accounts that have not configured tenant-specific creds, expose the
 * global platform creds so diagnostic edge functions (search available
 * numbers etc.) keep working in dev. Should NOT be used directly in
 * tenant-facing flows — call `loadAccountTwilioCreds(admin, accountId)`
 * instead so per-workspace vault keys take precedence.
 */
export function globalTwilioCreds(): TwilioCredentials {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
  if (!sid) throw new TwilioConfigError("TWILIO_ACCOUNT_SID not set in env", 503);
  return {
    accountSid: sid,
    authToken: Deno.env.get("TWILIO_AUTH_TOKEN"),
    apiKey: Deno.env.get("TWILIO_API_KEY"),
    apiSecret: Deno.env.get("TWILIO_API_SECRET"),
  };
}

/**
 * Load Twilio credentials for a given workspace, preferring per-account
 * secrets stored in the Vault. Falls back to env only when nothing is set
 * for that account.
 *
 * Vault keys (under provider="twilio"):
 *   - account_sid (required)
 *   - auth_token  (or api_key + api_secret)
 *   - api_key     (optional)
 *   - api_secret  (optional)
 */
export async function loadAccountTwilioCreds(
  admin: SupabaseClient,
  accountId: string,
): Promise<TwilioCredentials> {
  return resolveTwilioCredentials(admin, accountId, {});
}

/**
 * Auth Tokens to try when validating an inbound Twilio webhook signature.
 *
 * Twilio signs webhooks with the Auth Token of the account that owns the
 * call/message. Since outbound calls moved to per-workspace vault creds,
 * that is usually NOT the global TWILIO_AUTH_TOKEN — validating only against
 * env made every webhook 403 ("An application error has occurred. Goodbye.").
 *
 * We find the workspace from the payload (CallSid → voice_calls, or one of
 * our numbers in To/From → phone_numbers) and use its vault token when its
 * Account SID matches the payload's AccountSid. The env token stays as a
 * last fallback for legacy/global setups.
 */
export async function resolveWebhookAuthTokens(
  // any: webhook functions pin different supabase-js versions whose client
  // types don't unify (twilio-incoming/status use 2.49, shared code 2.74).
  // deno-lint-ignore no-explicit-any
  admin: any,
  form: FormData,
): Promise<string[]> {
  const field = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" && v ? v : null;
  };
  const payloadAccountSid = field("AccountSid");

  const accountIds = new Set<string>();
  const callSid = field("CallSid");
  if (callSid) {
    const { data } = await admin
      .from("voice_calls")
      .select("account_id")
      .eq("provider_call_sid", callSid)
      .limit(1)
      .maybeSingle();
    if (data?.account_id) accountIds.add(data.account_id);
  }
  // Status callbacks can arrive before provider_call_sid is saved, and
  // inbound calls/SMS have no voice_calls row yet — fall back to our number.
  const numbers = ["To", "From", "Called", "Caller"].map(field).filter((n): n is string => !!n);
  if (accountIds.size === 0 && numbers.length > 0) {
    const { data } = await admin.from("phone_numbers").select("account_id").in("e164", numbers).limit(5);
    for (const row of data ?? []) if (row.account_id) accountIds.add(row.account_id);
  }

  const tokens: string[] = [];
  for (const accountId of accountIds) {
    try {
      const creds = await loadAccountTwilioCreds(admin, accountId);
      if (!creds.authToken) continue; // API key only — can't validate signatures with it
      if (payloadAccountSid && payloadAccountSid !== creds.accountSid) continue;
      if (!tokens.includes(creds.authToken)) tokens.push(creds.authToken);
    } catch {
      // No Twilio creds for this workspace — the env fallback below still applies.
    }
  }
  const envToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (envToken && !tokens.includes(envToken)) tokens.push(envToken);
  return tokens;
}

async function resolveTwilioCredentials(
  admin: SupabaseClient,
  accountId: string,
  cfg: Record<string, any>,
): Promise<TwilioCredentials> {
  const bundle = await resolveSecretsBulk(admin, {
    accountId,
    provider: "twilio",
    keys: [
      { keyName: "account_sid", configValue: cfg.twilio_account_sid, envVar: "TWILIO_ACCOUNT_SID" },
      { keyName: "auth_token", configValue: cfg.twilio_auth_token, envVar: "TWILIO_AUTH_TOKEN" },
      { keyName: "api_key", configValue: cfg.twilio_api_key, envVar: "TWILIO_API_KEY" },
      { keyName: "api_secret", configValue: cfg.twilio_api_secret, envVar: "TWILIO_API_SECRET" },
    ],
  });

  const sid = bundle.account_sid ?? "";
  if (!sid) {
    throw new TwilioConfigError(
      "Credenciais Twilio não configuradas. Vá em /settings → Integrações → Twilio e cadastre Account SID + Auth Token.",
      409,
    );
  }
  const authToken = bundle.auth_token ?? undefined;
  const apiKey = bundle.api_key ?? undefined;
  const apiSecret = bundle.api_secret ?? undefined;

  if (!authToken && (!apiKey || !apiSecret)) {
    throw new TwilioConfigError(
      "Auth Token (ou API Key + API Secret) Twilio ausente. Atualize em /settings → Integrações.",
      409,
    );
  }

  return { accountSid: sid, authToken, apiKey, apiSecret };
}
