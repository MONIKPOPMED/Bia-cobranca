// Shared HMAC validators for public webhooks (Twilio, Meta/WhatsApp/Instagram).
// All validators return `true` when the request is authentic or when the guard
// is intentionally disabled (development mode). They return `false` on any
// mismatch. Callers MUST reject the request with 403 when false is returned.

const encoder = new TextEncoder();

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, "").toLowerCase();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(
  algo: "SHA-1" | "SHA-256",
  keyBytes: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "HMAC", hash: algo },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, data as BufferSource);
  return new Uint8Array(sig);
}

/**
 * Twilio webhook signature validation (X-Twilio-Signature).
 * Spec: https://www.twilio.com/docs/usage/webhooks/webhooks-security
 *
 * Twilio signs: url + sorted concatenated POST params (no separator).
 * The signature is HMAC-SHA1 with the account's AuthToken, base64-encoded.
 */
export async function validateTwilioSignature(params: {
  url: string;
  form: FormData;
  signature: string | null;
  authToken: string;
}): Promise<boolean> {
  const { url, form, signature, authToken } = params;
  if (!signature || !authToken) return false;

  const entries: Array<[string, string]> = [];
  form.forEach((v, k) => {
    if (typeof v === "string") entries.push([k, v]);
  });
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  let payload = url;
  for (const [k, v] of entries) payload += k + v;

  const expected = await hmac("SHA-1", encoder.encode(authToken), encoder.encode(payload));
  let received: Uint8Array;
  try {
    received = base64ToBytes(signature);
  } catch {
    return false;
  }
  return timingSafeEqual(expected, received);
}

/**
 * True when the Twilio signature matches any (url, authToken) pair. Twilio
 * signs with the Auth Token of the account that owns the call/message, which
 * depends on the workspace (see resolveWebhookAuthTokens), and the public URL
 * may differ from req.url behind Supabase's proxy.
 */
export async function validateTwilioSignatureAny(params: {
  urls: string[];
  authTokens: string[];
  form: FormData;
  signature: string | null;
}): Promise<boolean> {
  const { urls, authTokens, form, signature } = params;
  for (const authToken of authTokens) {
    for (const url of urls) {
      if (await validateTwilioSignature({ url, form, signature, authToken })) return true;
    }
  }
  return false;
}

/**
 * Meta (Facebook/WhatsApp/Instagram) webhook signature validation.
 * Header: X-Hub-Signature-256 with value "sha256=<hex>".
 * Body: raw request body bytes; sign with the APP_SECRET (not the verify token).
 *
 * Spec: https://developers.facebook.com/docs/graph-api/webhooks/getting-started#validate-payloads
 */
export async function validateMetaSignature(params: {
  rawBody: string;
  header: string | null;
  appSecret: string;
}): Promise<boolean> {
  const { rawBody, header, appSecret } = params;
  if (!header || !appSecret) return false;
  const m = /^sha256=([a-fA-F0-9]+)$/.exec(header.trim());
  if (!m) return false;

  const expected = await hmac("SHA-256", encoder.encode(appSecret), encoder.encode(rawBody));
  let received: Uint8Array;
  try {
    received = hexToBytes(m[1]);
  } catch {
    return false;
  }
  return timingSafeEqual(expected, received);
}

/**
 * Guard helper. Returns the rebuilt HTTPS URL used by Twilio when it signed
 * the request. Lovable/Supabase edge functions run behind a proxy, so we
 * normalize the incoming URL to the public one before hashing.
 */
export function getPublicUrl(req: Request): string {
  const url = new URL(req.url);
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const forwardedHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (forwardedProto) url.protocol = `${forwardedProto}:`;
  if (forwardedHost) url.host = forwardedHost;
  return url.toString();
}

/**
 * Convenience: returns true when HMAC enforcement is disabled via env flag.
 * Use ONLY when the operator explicitly opts out (staging, first-boot).
 */
export function isWebhookVerificationDisabled(): boolean {
  const v = Deno.env.get("WEBHOOK_VERIFY_DISABLED");
  return v === "1" || v?.toLowerCase() === "true";
}
