// Quick-connect dialog para o Evolution durante o onboarding.
// Fluxo simplificado:
//   1. Usuário informa apenas URL + API key do servidor Evolution.
//   2. Validamos com testEvolution (ping/auth).
//   3. provisionEvolution cria automaticamente a instância e (quase sempre)
//      retorna o QR code já no payload.
//   4. Caso o QR não venha de cara, fazemos polling com fetchQrcode.
//   5. Polling de fetchEvolutionStatus detecta quando o WhatsApp conectou
//      e fecha o diálogo com sucesso.
//
// Não pedimos nome do canal nem nada extra — o objetivo é "URL + key → QR".

import { useEffect, useRef, useState } from "react";
import { Loader2, QrCode, RefreshCw, ShieldCheck, Smartphone, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  fetchEvolutionStatus,
  fetchQrcode,
  provisionEvolution,
  testEvolution,
  type EvolutionStatus,
} from "@/lib/evolution";
import { supabase } from "@/integrations/supabase/client";

type Phase = "form" | "provisioning" | "awaiting_scan" | "connected";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accountId: string;
  onConnected?: () => void;
}

export function EvolutionQuickConnect({ open, onOpenChange, accountId, onConnected }: Props) {
  const [phase, setPhase] = useState<Phase>("form");
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasExisting, setHasExisting] = useState(false);
  const [busy, setBusy] = useState(false);

  const [channelId, setChannelId] = useState<string | null>(null);
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [status, setStatus] = useState<EvolutionStatus | null>(null);

  const pollRef = useRef<number | null>(null);

  // Carrega URL/API key existentes (mascarando a key) pra mostrar contexto.
  useEffect(() => {
    if (!open || !accountId) return;
    setPhase("form");
    setQrBase64(null);
    setPairingCode(null);
    setStatus(null);
    setChannelId(null);
    setUrl("");
    setApiKey("");

    (async () => {
      const { data } = await supabase
        .from("channels")
        .select("id, config")
        .eq("account_id", accountId)
        .eq("channel_type", "whatsapp")
        .maybeSingle();
      const cfg = (data?.config ?? {}) as Record<string, string>;
      if (cfg.evolution_url || cfg.evolution_api_key) {
        setHasExisting(true);
        if (cfg.evolution_url) setUrl(cfg.evolution_url);
        // Não pré-preenche a key (segurança); usuário vê o badge "salvo".
      } else {
        setHasExisting(false);
      }
      if (data?.id) setChannelId(data.id);
    })().catch(() => undefined);
  }, [open, accountId]);

  // Polling de status enquanto aguarda o usuário escanear.
  useEffect(() => {
    if (phase !== "awaiting_scan" || !channelId) return;
    let cancelled = false;

    const tick = async () => {
      const r = await fetchEvolutionStatus(channelId);
      if (cancelled) return;
      if (r.status && r.status !== "not_found") setStatus(r.status);
      if (r.status === "connected") {
        setPhase("connected");
        toast.success("WhatsApp conectado!");
        onConnected?.();
      } else if (r.status === "qr_ready" || r.status === "connecting") {
        // Refresca o QR a cada ~30s (o Evolution gira o token).
        const next = await fetchQrcode(channelId);
        if (!cancelled && next.base64) {
          setQrBase64(next.base64);
          setPairingCode(next.pairingCode ?? null);
        }
      }
    };

    pollRef.current = window.setInterval(tick, 4000);
    return () => {
      cancelled = true;
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [phase, channelId, onConnected]);

  async function handleConnect() {
    const u = url.trim();
    const k = apiKey.trim();
    if (!u) return toast.error("URL do servidor é obrigatória");
    if (!k && !hasExisting) return toast.error("API key é obrigatória");

    setBusy(true);
    setPhase("provisioning");
    try {
      // Se a key não foi digitada mas já existe salva, usa a do canal.
      let effectiveKey = k;
      if (!effectiveKey && hasExisting && channelId) {
        const { data } = await supabase
          .from("channels")
          .select("config")
          .eq("id", channelId)
          .maybeSingle();
        effectiveKey = ((data?.config ?? {}) as any).evolution_api_key ?? "";
      }
      if (!effectiveKey) {
        toast.error("API key é obrigatória");
        setPhase("form");
        setBusy(false);
        return;
      }

      // 1. Valida.
      const t = await testEvolution({ accountId, evolutionUrl: u, evolutionApiKey: effectiveKey });
      if (!t.ok) {
        toast.error(t.error ?? "Falha ao conectar no servidor Evolution", {
          description: t.hint,
        });
        setPhase("form");
        setBusy(false);
        return;
      }

      // 2. Provisiona instância (idempotente).
      const prov = await provisionEvolution({
        accountId,
        evolutionUrl: u,
        evolutionApiKey: effectiveKey,
        channelId: channelId ?? undefined,
      });
      if (!prov.ok || !prov.channel_id) {
        toast.error(prov.error ?? "Falha ao criar instância", { description: prov.hint });
        setPhase("form");
        setBusy(false);
        return;
      }
      setChannelId(prov.channel_id);

      // 3. Tenta usar o QR retornado; se não veio, busca via fetchQrcode.
      let qr = prov.qrcode_base64 ?? null;
      if (!qr) {
        const r = await fetchQrcode(prov.channel_id);
        qr = r.base64 ?? null;
        if (r.pairingCode) setPairingCode(r.pairingCode);
      }
      if (qr) setQrBase64(qr);

      if (prov.status === "connected") {
        setPhase("connected");
        onConnected?.();
      } else {
        setPhase("awaiting_scan");
      }
    } catch (e: any) {
      toast.error(`Erro: ${e?.message ?? "desconhecido"}`);
      setPhase("form");
    } finally {
      setBusy(false);
    }
  }

  async function handleRefreshQr() {
    if (!channelId) return;
    const r = await fetchQrcode(channelId);
    if (r.base64) setQrBase64(r.base64);
    if (r.pairingCode) setPairingCode(r.pairingCode);
    if (r.error) toast.error(r.error);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-primary" />
            Conectar WhatsApp via Evolution
          </DialogTitle>
          <DialogDescription>
            Informe o servidor Evolution. Vamos criar a instância e gerar o QR
            code automaticamente.
          </DialogDescription>
        </DialogHeader>

        {phase === "form" && (
          <div className="space-y-3">
            <div>
              <Label className="mb-1 flex items-center gap-2 text-xs font-semibold">
                URL do servidor <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="https://evo.exemplo.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                autoComplete="off"
                className="font-mono text-xs"
              />
            </div>
            <div>
              <Label className="mb-1 flex items-center gap-2 text-xs font-semibold">
                API Key <span className="text-destructive">*</span>
                {hasExisting && (
                  <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-emerald-700">
                    <ShieldCheck className="h-2.5 w-2.5" /> salva
                  </span>
                )}
              </Label>
              <Input
                type="password"
                placeholder={hasExisting ? "•••••••• (deixe em branco pra manter)" : "AUTHENTICATION_API_KEY"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
                className="font-mono text-xs"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Use a global API key do servidor Evolution (AUTHENTICATION_API_KEY).
              </p>
            </div>
            <a
              href="https://doc.evolution-api.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              Docs do Evolution <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}

        {phase === "provisioning" && (
          <div className="flex flex-col items-center justify-center gap-3 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span>Criando instância no Evolution…</span>
          </div>
        )}

        {phase === "awaiting_scan" && (
          <div className="space-y-3">
            <div className="rounded-md border border-border/50 bg-muted/20 p-3 text-xs text-muted-foreground">
              Abra o WhatsApp no celular → <strong>Aparelhos conectados</strong> →{" "}
              <strong>Conectar um aparelho</strong> e aponte para o QR code abaixo.
            </div>
            <div className="flex flex-col items-center gap-2">
              {qrBase64 ? (
                <img
                  src={qrBase64.startsWith("data:") ? qrBase64 : `data:image/png;base64,${qrBase64}`}
                  alt="QR code para conectar WhatsApp"
                  className="h-56 w-56 rounded-md border border-border/50 bg-white p-2"
                />
              ) : (
                <div className="flex h-56 w-56 items-center justify-center rounded-md border border-dashed border-border/50 text-xs text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Gerando QR…
                </div>
              )}
              {pairingCode && (
                <div className="text-center">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    ou use o código de pareamento
                  </div>
                  <div className="font-mono text-base font-semibold tracking-widest">
                    {pairingCode}
                  </div>
                </div>
              )}
              <Button variant="ghost" size="sm" onClick={handleRefreshQr}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Gerar novo QR
              </Button>
              <div className="text-[11px] text-muted-foreground">
                Status: <span className="font-medium text-foreground">{status ?? "aguardando…"}</span>
              </div>
            </div>
          </div>
        )}

        {phase === "connected" && (
          <div className="flex flex-col items-center gap-3 py-8 text-sm">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <QrCode className="h-6 w-6" />
            </div>
            <div className="text-center">
              <div className="text-base font-semibold">WhatsApp conectado!</div>
              <div className="text-xs text-muted-foreground">
                A instância já está pronta para enviar e receber mensagens.
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {phase === "form" && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancelar
              </Button>
              <Button onClick={handleConnect} disabled={busy}>
                {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Conectar
              </Button>
            </>
          )}
          {(phase === "awaiting_scan" || phase === "connected") && (
            <Button onClick={() => onOpenChange(false)}>
              {phase === "connected" ? "Concluir" : "Fechar"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
