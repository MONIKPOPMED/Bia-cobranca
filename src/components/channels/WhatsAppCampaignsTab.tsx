import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchDeployments, fetchPersonas } from "@/lib/personas";
import { WhatsAppCampaignPanel } from "@/components/channels/WhatsAppCampaignPanel";

/**
 * WhatsApp campaigns inside the Campanhas page. Campaigns need the same
 * readiness the Canais page checks: Evolution connected + an active persona
 * deployed on the WhatsApp inbox.
 */
export function WhatsAppCampaignsTab({ accountId, isAdmin }: { accountId: string; isAdmin: boolean }) {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [botActive, setBotActive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [{ data: channel }, personas] = await Promise.all([
          supabase.from("channels").select("id, config").eq("account_id", accountId).eq("channel_type", "whatsapp").maybeSingle(),
          fetchPersonas(accountId),
        ]);
        const isConnected = (channel?.config as Record<string, string> | null)?.evolution_instance_status === "connected";
        let active = false;
        if (channel) {
          const { data: inbox } = await supabase.from("inboxes").select("id").eq("channel_id", channel.id).maybeSingle();
          if (inbox) {
            const deployments = await Promise.all(personas.map((persona) => fetchDeployments(persona.id)));
            active = deployments.flat().some((item) => item.inbox_id === inbox.id && item.enabled);
          }
        }
        if (!cancelled) {
          setConnected(isConnected);
          setBotActive(active);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [accountId]);

  if (loading) {
    return <div className="py-12 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-3">
      {(!connected || !botActive) && (
        <p className="text-sm text-muted-foreground">
          {!connected ? "O WhatsApp não está conectado." : "A Bia não está ativa no WhatsApp."}{" "}
          <a href="/channels" className="text-primary underline underline-offset-2">Abrir Canais</a> para {!connected ? "conectar" : "ativar a Bia"}.
        </p>
      )}
      <WhatsAppCampaignPanel accountId={accountId} enabled={connected && botActive} isAdmin={isAdmin} />
    </div>
  );
}
