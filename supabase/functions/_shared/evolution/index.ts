// Shared client for Evolution API (Baileys-based WhatsApp Web wrapper).
// Every tenant connects to their own self-hosted Evolution server, so the
// URL + apiKey live on channels.config — this module takes them as args.
//
// Evolution's outbound surface is REST (no shared client needed beyond fetch
// with the right headers); the helpers below normalize the few shapes Nexus
// cares about so edge functions stay terse.
import { isConnectionFailure, recordSendResult } from "./health.ts";

export interface EvolutionChannelConfig {
  evolution_url?: string;
  evolution_api_key?: string;
  evolution_instance_name?: string;
  evolution_instance_status?: "disconnected" | "connecting" | "qr_ready" | "connected";
  evolution_number?: string;
}

export type EvolutionConnectionState =
  | "open"
  | "connecting"
  | "close"
  | "qrReadSuccess"
  | "qr"
  | "loggedOut";


const DEFAULT_TIMEOUT_MS = 20_000;

export class EvolutionError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body = "") {
    super(message);
    this.name = "EvolutionError";
    this.status = status;
    this.body = body;
  }
}

function trimUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

async function evo<T = any>(args: {
  url: string;
  apiKey: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
  timeoutMs?: number;
}): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), args.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${trimUrl(args.url)}${args.path}`, {
      method: args.method,
      headers: {
        apikey: args.apiKey,
        "Content-Type": "application/json",
      },
      body: args.body ? JSON.stringify(args.body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      // Include the upstream body in the error message so callers that only
      // log e.message (like channels-send's errMsg) still surface the reason.
      // Evolution's error payload is usually a tiny JSON with a `message`
      // field — fits easily in the first 300 chars.
      const bodyPreview = text.slice(0, 300).replace(/\s+/g, " ").trim();
      throw new EvolutionError(
        `Evolution ${res.status} at ${args.path}${bodyPreview ? ` — ${bodyPreview}` : ""}`,
        res.status,
        text.slice(0, 500),
      );
    }
    return (text ? JSON.parse(text) : {}) as T;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Ping — listing all instances is the cheapest reachable check. Used by the
 * "Testar conexão" button before we provision anything.
 */
export async function ping(url: string, apiKey: string): Promise<{ ok: true; count: number }> {
  const list = await evo<any[]>({
    url,
    apiKey,
    method: "GET",
    path: "/instance/fetchInstances",
  });
  return { ok: true, count: Array.isArray(list) ? list.length : 0 };
}

const WEBHOOK_EVENTS = [
  "MESSAGES_UPSERT",
  "MESSAGES_UPDATE",
  "CONNECTION_UPDATE",
  "QRCODE_UPDATED",
];

function webhookBody(webhookUrl: string, webhookSecret: string) {
  return {
    url: webhookUrl,
    byEvents: false,
    base64: true,
    headers: { "x-nexus-webhook-secret": webhookSecret },
    events: WEBHOOK_EVENTS,
  };
}

/**
 * Re-set the webhook on an existing instance. Needed after a create that
 * 409s (instance already exists) OR any time EVOLUTION_WEBHOOK_SECRET
 * rotates — without this, old instances keep sending the stale secret and
 * the handler rejects with 403 silently.
 */
export async function setWebhook(args: {
  url: string;
  apiKey: string;
  instanceName: string;
  webhookUrl: string;
  webhookSecret: string;
}): Promise<void> {
  // Evolution v2 expects the webhook object nested under `webhook`.
  // Older versions accept it flat; send both shapes so either works.
  try {
    await evo({
      url: args.url,
      apiKey: args.apiKey,
      method: "POST",
      path: `/webhook/set/${encodeURIComponent(args.instanceName)}`,
      body: {
        webhook: webhookBody(args.webhookUrl, args.webhookSecret),
        enabled: true,
      },
    });
  } catch (err) {
    // Some Evolution deployments reject the nested shape — retry flat.
    if (err instanceof EvolutionError && err.status >= 400 && err.status < 500) {
      await evo({
        url: args.url,
        apiKey: args.apiKey,
        method: "POST",
        path: `/webhook/set/${encodeURIComponent(args.instanceName)}`,
        body: {
          ...webhookBody(args.webhookUrl, args.webhookSecret),
          enabled: true,
        },
      });
      return;
    }
    throw err;
  }
}

/**
 * Create a new Evolution instance bound to our incoming webhook. Idempotent
 * by instanceName — Evolution 409s if the name is taken, in which case we
 * treat as success but STILL re-set the webhook so a rotated
 * EVOLUTION_WEBHOOK_SECRET propagates to the live instance.
 */
export async function createInstance(args: {
  url: string;
  apiKey: string;
  instanceName: string;
  webhookUrl: string;
  webhookSecret: string;
}): Promise<{ instanceName: string; token?: string; qrcode?: { base64?: string } }> {
  try {
    const res = await evo<any>({
      url: args.url,
      apiKey: args.apiKey,
      method: "POST",
      path: "/instance/create",
      body: {
        instanceName: args.instanceName,
        integration: "WHATSAPP-BAILEYS",
        qrcode: true,
        webhook: webhookBody(args.webhookUrl, args.webhookSecret),
      },
    });
    return {
      instanceName: res?.instance?.instanceName ?? args.instanceName,
      token: res?.hash?.apikey,
      qrcode: res?.qrcode,
    };
  } catch (err) {
    // Evolution v2 answers 403 "This name … is already in use" (older builds
    // used 409) when the instance exists — both mean "reuse it".
    if (
      err instanceof EvolutionError &&
      (err.status === 409 || (err.status === 403 && /already in use/i.test(err.body)))
    ) {
      // Instance already exists — re-sync the webhook so any secret
      // rotation reaches the live config. Tolerate errors so a broken
      // webhook endpoint doesn't prevent the caller from reusing the
      // instance (they can still receive + send, just logs a warn).
      try {
        await setWebhook({
          url: args.url,
          apiKey: args.apiKey,
          instanceName: args.instanceName,
          webhookUrl: args.webhookUrl,
          webhookSecret: args.webhookSecret,
        });
      } catch (whErr) {
        console.warn(
          `[evolution] webhook resync failed for ${args.instanceName}:`,
          whErr,
        );
      }
      return { instanceName: args.instanceName };
    }
    throw err;
  }
}

export async function deleteInstance(args: {
  url: string;
  apiKey: string;
  instanceName: string;
}): Promise<void> {
  try {
    await evo({
      url: args.url,
      apiKey: args.apiKey,
      method: "DELETE",
      path: `/instance/delete/${encodeURIComponent(args.instanceName)}`,
    });
  } catch (err) {
    if (err instanceof EvolutionError && err.status === 404) return;
    throw err;
  }
}

/**
 * Drops the WhatsApp session of an instance (keeps the instance and its
 * webhook) so /instance/connect returns a fresh QR code. Used to recover a
 * "zombie" session: Evolution says "open" but sends fail with
 * "Connection Closed". Tolerates an instance that is already logged out.
 */
export async function logoutInstance(args: {
  url: string;
  apiKey: string;
  instanceName: string;
}): Promise<void> {
  try {
    await evo({
      url: args.url,
      apiKey: args.apiKey,
      method: "DELETE",
      path: `/instance/logout/${encodeURIComponent(args.instanceName)}`,
    });
  } catch (err) {
    if (err instanceof EvolutionError && (err.status === 404 || err.status === 400)) return;
    throw err;
  }
}

export async function getQrCode(args: {
  url: string;
  apiKey: string;
  instanceName: string;
}): Promise<{ base64?: string; pairingCode?: string; code?: string }> {
  return await evo({
    url: args.url,
    apiKey: args.apiKey,
    method: "GET",
    path: `/instance/connect/${encodeURIComponent(args.instanceName)}`,
  });
}

export async function getConnectionState(args: {
  url: string;
  apiKey: string;
  instanceName: string;
}): Promise<{ instance: { instanceName: string; state: EvolutionConnectionState } }> {
  return await evo({
    url: args.url,
    apiKey: args.apiKey,
    method: "GET",
    path: `/instance/connectionState/${encodeURIComponent(args.instanceName)}`,
  });
}

/**
 * Normalize Evolution's internal state names to the four values Nexus stores
 * on channels.config.evolution_instance_status.
 */
export function normalizeStatus(
  state: EvolutionConnectionState | string | undefined,
): "connected" | "qr_ready" | "connecting" | "disconnected" {
  switch (state) {
    case "open":
      return "connected";
    case "qr":
    case "qrReadSuccess":
      return "qr_ready";
    case "connecting":
      return "connecting";
    default:
      return "disconnected";
  }
}

/**
 * Asks WhatsApp whether numbers exist — sends nothing to anyone. It needs a
 * live session, so it fails ("Connection Closed") when the session is a
 * zombie that connectionState still reports as "open" (14/10). Used by
 * whatsapp-health-check as a probe.
 */
export async function checkWhatsAppNumbers(args: {
  url: string;
  apiKey: string;
  instanceName: string;
  numbers: string[];
}): Promise<unknown> {
  return await evo({
    url: args.url,
    apiKey: args.apiKey,
    method: "POST",
    path: `/chat/whatsappNumbers/${encodeURIComponent(args.instanceName)}`,
    body: { numbers: args.numbers.map(toEvolutionNumber) },
  });
}

/**
 * Normalize a destination for Evolution's `number` field.
 * - Bare JID (`...@s.whatsapp.net` / `...@lid`) passes through untouched —
 *   Baileys routes directly by JID and skips the whatsappNumbers check,
 *   which is what we want for LID contacts whose raw digits aren't a
 *   valid phone number.
 * - Anything else is stripped to digits so Evolution can normalize.
 */
function toEvolutionNumber(input: string): string {
  const trimmed = input.trim();
  if (trimmed.includes("@")) return trimmed;
  return trimmed.replace(/[^\d]/g, "");
}

/**
 * Runs a send and records whether the session really works (see health.ts):
 * "Connection Closed" marks the channel and alerts the admins; a success
 * clears an earlier mark.
 */
async function trackedSend<T>(instanceName: string, send: () => Promise<T>): Promise<T> {
  try {
    const res = await send();
    await recordSendResult(instanceName, { ok: true });
    return res;
  } catch (err) {
    if (err instanceof EvolutionError && isConnectionFailure(err.body || err.message)) {
      await recordSendResult(instanceName, { ok: false, message: err.body || err.message });
    }
    throw err;
  }
}

/**
 * Send text. Accepts a phone-like string OR a full Baileys JID.
 */
export async function sendText(args: {
  url: string;
  apiKey: string;
  instanceName: string;
  number: string;
  text: string;
}): Promise<{ messageId?: string }> {
  const res = await trackedSend(args.instanceName, () => evo<any>({
    url: args.url,
    apiKey: args.apiKey,
    method: "POST",
    path: `/message/sendText/${encodeURIComponent(args.instanceName)}`,
    body: {
      number: toEvolutionNumber(args.number),
      text: args.text,
    },
  }));
  return { messageId: res?.key?.id ?? res?.messageId ?? res?.id };
}

export async function sendMedia(args: {
  url: string;
  apiKey: string;
  instanceName: string;
  number: string;
  mediaUrl: string;
  mediaType: "image" | "video" | "document" | "audio";
  caption?: string;
  fileName?: string;
}): Promise<{ messageId?: string }> {
  const res = await trackedSend(args.instanceName, () => evo<any>({
    url: args.url,
    apiKey: args.apiKey,
    method: "POST",
    path: `/message/sendMedia/${encodeURIComponent(args.instanceName)}`,
    body: {
      number: toEvolutionNumber(args.number),
      mediatype: args.mediaType,
      media: args.mediaUrl,
      caption: args.caption,
      fileName: args.fileName,
    },
  }));
  return { messageId: res?.key?.id ?? res?.messageId ?? res?.id };
}

/**
 * Send as a native WhatsApp voice note (PTT) — shows as "push-to-talk"
 * with waveform on the recipient's app, vs sendMedia which attaches audio
 * as a regular file. Evolution transcodes the source to OGG Opus when
 * `encoding: true` (so MP3/M4A/WAV inputs work too).
 */
export async function sendVoiceNote(args: {
  url: string;
  apiKey: string;
  instanceName: string;
  number: string;
  audioUrl: string;
}): Promise<{ messageId?: string }> {
  const res = await trackedSend(args.instanceName, () => evo<any>({
    url: args.url,
    apiKey: args.apiKey,
    method: "POST",
    path: `/message/sendWhatsAppAudio/${encodeURIComponent(args.instanceName)}`,
    body: {
      number: toEvolutionNumber(args.number),
      audio: args.audioUrl,
      encoding: true,
    },
  }));
  return { messageId: res?.key?.id ?? res?.messageId ?? res?.id };
}

/**
 * Generate a stable instance name for a Nexus channel. Keeps servers that
 * host multiple tenants + multiple WA channels per tenant from colliding.
 * Suffix is channel-scoped; pass channel.id last 6 chars, or a random slug
 * when creating a new channel before its id is known.
 */
export function instanceNameFor(accountId: string, suffix?: string): string {
  const short = accountId.replace(/-/g, "").slice(0, 12);
  if (!suffix) return `nexus_${short}`;
  const normalized = suffix.replace(/-/g, "").slice(0, 8).toLowerCase();
  return `nexus_${short}_${normalized}`;
}
