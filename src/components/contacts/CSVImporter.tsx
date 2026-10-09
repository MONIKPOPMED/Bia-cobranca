import { useState, useRef } from "react";
import { Upload, FileText, AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Ban, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { importDebtorsCsv } from "@/lib/debtors";
import { toast } from "sonner";

type ImportResult = {
  totalRows: number;
  imported: number;
  skipped_dnc: number;
  skipped_duplicate: number;
  invalid: number;
  errors: { row: number; message: string }[];
  dry_run: boolean;
};

type Props = {
  onComplete?: () => void;
};

export function CSVImporter({ onComplete }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast.error("Apenas arquivos .csv são aceitos");
      return;
    }
    setImporting(true);
    setResult(null);
    try {
      const text = await file.text();
      const res = await importDebtorsCsv(text);
      setResult(res);
      if (res.imported > 0) {
        toast.success(`${res.imported} devedor(es) importado(s)`);
        onComplete?.();
      } else if (res.invalid > 0 || res.errors.length > 0) {
        toast.error("Nenhum registro importado. Confira os erros abaixo.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao importar");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file);
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 transition-colors",
          dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/60",
          importing && "pointer-events-none opacity-60",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        <Upload className="h-8 w-8 text-muted-foreground" />
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">
            {importing ? "Importando…" : "Solte o CSV aqui ou clique para selecionar"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Tamanho máximo recomendado: 5MB</p>
        </div>
      </div>

      <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="font-semibold text-foreground">Formato esperado do CSV</p>
          <button
            onClick={() => {
              navigator.clipboard.writeText(
                "nome,telefone,cpf_cnpj,valor,vencimento,email,descricao,origem\nJoão Silva,11988776655,123.456.789-00,1250.50,2026-05-15,joao@exemplo.com,Fatura 4567,boleto",
              );
              toast.success("Modelo copiado");
            }}
            className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          >
            <Copy className="h-3 w-3" /> Copiar modelo
          </button>
        </div>
        <p className="leading-relaxed">
          Obrigatórias: <code className="rounded bg-background px-1">nome</code>,{" "}
          <code className="rounded bg-background px-1">telefone</code>,{" "}
          <code className="rounded bg-background px-1">valor</code>,{" "}
          <code className="rounded bg-background px-1">vencimento</code>. Opcionais:{" "}
          <code className="rounded bg-background px-1">cpf_cnpj</code>,{" "}
          <code className="rounded bg-background px-1">email</code>,{" "}
          <code className="rounded bg-background px-1">descricao</code>,{" "}
          <code className="rounded bg-background px-1">origem</code>,{" "}
          <code className="rounded bg-background px-1">external_ref</code>.
        </p>
        <ul className="mt-2 list-disc space-y-0.5 pl-4">
          <li>Telefone BR: aceita (11) 98877-6655, 11988776655, +5511988776655</li>
          <li>Valor: 1.250,50 ou 1250.50 (R$ opcional no prefixo)</li>
          <li>Vencimento: 2026-05-15 ou 15/05/2026</li>
          <li>Uma linha por mensalidade: o mesmo telefone em várias linhas vira um cliente com várias mensalidades</li>
          <li>Registros em DNC e mensalidades repetidas (mesmo telefone, vencimento e valor) são ignorados automaticamente</li>
        </ul>
      </div>

      {result && (
        <div className="space-y-2 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Resultado da importação</span>
          </div>
          <div className="grid grid-cols-5 gap-2">
            <Stat label="Importados" value={result.imported} icon={CheckCircle2} color="text-emerald-400" />
            <Stat label="DNC" value={result.skipped_dnc} icon={Ban} color="text-rose-400" />
            <Stat label="Duplicados" value={result.skipped_duplicate} icon={AlertCircle} color="text-amber-400" />
            <Stat label="Inválidos" value={result.invalid} icon={AlertCircle} color="text-rose-400" />
            <Stat label="Total" value={result.totalRows} icon={FileText} color="text-sky-400" />
          </div>
          {result.errors.length > 0 && (
            <div className="mt-2">
              <button
                onClick={() => setShowErrors(!showErrors)}
                className="flex w-full items-center justify-between rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300 hover:bg-rose-500/15"
              >
                <span>{result.errors.length} erro(s)</span>
                {showErrors ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
              {showErrors && (
                <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-md bg-background/50 p-2">
                  {result.errors.map((err, i) => (
                    <div key={i} className="text-[11px] text-muted-foreground">
                      <span className="text-rose-300">Linha {err.row}:</span> {err.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <Button size="sm" variant="outline" onClick={() => setResult(null)} className="w-full">
            Importar outro arquivo
          </Button>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}) {
  return (
    <div className="rounded-md bg-muted/30 p-2 text-center">
      <Icon className={cn("mx-auto h-3.5 w-3.5", color)} />
      <div className="mt-1 text-base font-semibold tabular-nums">{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
