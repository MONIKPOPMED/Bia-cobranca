/**
 * Thin browser client for the Evolution-backed WhatsApp channel edge functions.
 * The actual Evolution API key never reaches the browser — it's stored on
 * channels.config and used server-side by the edge functions.
 */
import { supabase } from "@/integrations/supabase/client";

/**
 * supabase.functions.invoke only says "Edge Function returned a non-2xx
 * status code"; the function puts the real reason (and a hint) in the body.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function functionErrorBody(error: any): Promise<{ error: string; hint?: string }> {
  try {
    const body = await error?.context?.json?.();
    if (body?.error) return { error: String(body.error), hint: body.hint ?? undefined };
  } catch {
    // body not JSON — fall back to the generic message
  }
  return { error: error?.message ?? "erro desconhecido" };
}

export type EvolutionStatus = "disconnected" | "connecting" | "qr_ready" | "connected";

export async function testEvolution(args: {
  accountId: string;
  evolutionUrl: string;
  evolutionApiKey: string;
}): Promise<{ ok: boolean; instance_count?: number; error?: string; hint?: string }> {
  const { data, error } = await supabase.functions.invoke("evolution-provision", {
    body: {
      account_id: args.accountId,
      mode: "test",
      evolution_url: args.evolutionUrl,
      evolution_api_key: args.evolutionApiKey,
    },
  });
  if (error) return { ok: false, ...(await functionErrorBody(error)) };
  return data as any;
}

export async function provisionEvolution(args: {
  accountId: string;
  evolutionUrl: string;
  evolutionApiKey: string;
  channelId?: string;
  channelName?: string;
}): Promise<{
  ok: boolean;
  channel_id?: string;
  instance_name?: string;
  qrcode_base64?: string | null;
  status?: EvolutionStatus;
  error?: string;
  hint?: string;
}> {
  const { data, error } = await supabase.functions.invoke("evolution-provision", {
    body: {
      account_id: args.accountId,
      mode: "provision",
      evolution_url: args.evolutionUrl,
      evolution_api_key: args.evolutionApiKey,
      channel_id: args.channelId,
      channel_name: args.channelName,
    },
  });
  if (error) return { ok: false, ...(await functionErrorBody(error)) };
  return data as any;
}

export async function fetchQrcode(channelId: string): Promise<{
  base64?: string | null;
  pairingCode?: string | null;
  error?: string;
}> {
  const { data, error } = await supabase.functions.invoke("evolution-qrcode", {
    body: { channel_id: channelId },
  });
  if (error) return { error: error.message };
  return data as any;
}

export async function fetchEvolutionStatus(channelId: string): Promise<{
  status?: EvolutionStatus | "not_found";
  raw?: string | null;
  error?: string;
}> {
  const { data, error } = await supabase.functions.invoke("evolution-status", {
    body: { channel_id: channelId },
  });
  // Channel was deleted between the poll being scheduled and the request
  // landing — treat as benign so the UI doesn't toast an error.
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("404") || msg.toLowerCase().includes("not found")) {
      return { status: "not_found" };
    }
    return { error: msg };
  }
  return data as any;
}

export async function deleteEvolutionInstance(channelId: string): Promise<{
  ok: boolean;
  remote_deleted?: boolean;
  remote_error?: string;
  error?: string;
}> {
  const { data, error } = await supabase.functions.invoke("evolution-delete", {
    body: { channel_id: channelId },
  });
  if (error) return { ok: false, error: error.message };
  return data as any;
}
