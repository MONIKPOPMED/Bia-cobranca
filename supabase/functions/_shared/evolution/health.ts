// Tracks whether the WhatsApp (Evolution) instance can really send.
//
// Evolution can report a session as "open" while every send fails with
// "Connection Closed" (14/10: the voicemail follow-up was lost and nobody
// noticed). The status poll can't see that, so the send path records the
// failure on channels.config.evolution_send_error, the Canais card shows it
// and the account admins get a notification (at most one every few hours).
// A later successful send — or a reconnect — clears it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const ALERT_EVERY_HOURS = 6;

/** Evolution errors that mean "the WhatsApp session is down", not "bad number". */
export function isConnectionFailure(body: string): boolean {
  return /Connection Closed|Connection Failure|not connected|instance does not exist/i.test(body);
}

function admin() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return url && key ? createClient(url, key) : null;
}

/** Never throws: health tracking must not break the send itself. */
export async function recordSendResult(
  instanceName: string,
  result: { ok: true } | { ok: false; message: string },
): Promise<void> {
  try {
    const db = admin();
    if (!db) return;
    const { data: channel } = await db
      .from("channels")
      .select("id, account_id, config")
      .eq("config->>evolution_instance_name", instanceName)
      .limit(1)
      .maybeSingle();
    if (!channel) return;
    // deno-lint-ignore no-explicit-any
    const cfg = (channel.config ?? {}) as Record<string, any>;
    const previous = cfg.evolution_send_error as { alerted_at?: string } | undefined;

    if (result.ok) {
      if (!previous) return;
      const { evolution_send_error: _cleared, ...rest } = cfg;
      await db.from("channels").update({ config: rest }).eq("id", channel.id);
      return;
    }

    const now = new Date();
    const lastAlert = previous?.alerted_at ? new Date(previous.alerted_at).getTime() : 0;
    const alert = now.getTime() - lastAlert > ALERT_EVERY_HOURS * 3600 * 1000;
    await db
      .from("channels")
      .update({
        config: {
          ...cfg,
          evolution_send_error: {
            at: now.toISOString(),
            message: result.message.slice(0, 300),
            alerted_at: alert ? now.toISOString() : previous?.alerted_at ?? null,
          },
        },
      })
      .eq("id", channel.id);
    console.error(`[evolution] send failed on ${instanceName}: ${result.message.slice(0, 200)}`);

    if (!alert) return;
    const { data: admins } = await db
      .from("user_roles")
      .select("user_id")
      .eq("account_id", channel.account_id)
      .eq("role", "admin");
    if (!admins?.length) return;
    await db.from("notifications").insert(
      admins.map((a: { user_id: string }) => ({
        account_id: channel.account_id,
        user_id: a.user_id,
        kind: "whatsapp_send_failed",
        title: "WhatsApp sem enviar mensagens",
        body: "O envio pelo WhatsApp da Bia falhou (conexão fechada). Abra Canais e clique em Reconectar.",
        link_to: "/channels",
        metadata: { instance_name: instanceName, error: result.message.slice(0, 300) },
      })),
    );
  } catch (err) {
    console.warn("[evolution] could not record send health", err);
  }
}
