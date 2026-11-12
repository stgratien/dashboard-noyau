import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { PlatformId } from "@/lib/dashboard-data";
import type { Period } from "@/lib/dashboard-periods";
import { cn } from "@/lib/utils";
import type { SocialData } from "./common";

/** Télécharge un contenu sous un nom de fichier, par un lien temporaire (aucun envoi : tout se passe dans le navigateur). */
export function downloadFile(name: string, mime: string, content: BlobPart) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  // Le navigateur a besoin d'un instant pour lancer le téléchargement avant de libérer l'adresse.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

type Format = "xlsx" | "json";
const FAILED = "Export impossible, réessayez.";

/**
 * Bouton « Exporter » de l'en-tête (activé par `features.dataExport`) : les chiffres de l'onglet réseau affiché, pour la période et la comparaison choisies, en Excel ou en JSON.
 * Le pictogramme seul, comme « Actualiser » et la bascule de thème à côté de lui ; son nom accessible est « Exporter ». Les constructeurs de fichier ne sont chargés qu'au clic.
 */
export function ExportMenu({ data, p, period, comparison, className }: { data: SocialData | undefined; p: PlatformId; period: Period; comparison: Period; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const running = useRef(false);
  useEffect(() => {
    if (!failed) return;
    const timer = setTimeout(() => setFailed(false), 8000);
    return () => clearTimeout(timer);
  }, [failed]);

  const run = async (format: Format) => {
    if (!data || running.current) return;
    running.current = true;
    setBusy(true);
    setFailed(false);
    try {
      const { buildDataExport, exportFileName, exportToJson } = await import("@/lib/data-export");
      const model = buildDataExport({ data, p, period, comparison });
      if (format === "xlsx") {
        const { XLSX_MIME, buildXlsx } = await import("@/lib/data-export-xlsx");
        // Une copie dans un ArrayBuffer ordinaire : le type renvoyé par le compresseur peut venir d'un tampon partagé, que Blob n'accepte pas.
        downloadFile(exportFileName(model, "xlsx"), XLSX_MIME, new Uint8Array(buildXlsx(model)));
      } else {
        downloadFile(exportFileName(model, "json"), "application/json", exportToJson(model));
      }
    } catch (error) {
      console.warn("Export impossible", error instanceof Error ? error.message : error);
      setFailed(true);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  // Le bouton reste actif pendant la préparation (le focus clavier ne se perd pas) : `running` refuse déjà un second export. L'erreur flotte sous le bouton, sans changer les lignes de l'en-tête.
  return (
    <div className={cn("relative", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="icon" className="shadow-none" disabled={!data} aria-busy={busy} aria-label="Exporter">
            <Download />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Chiffres de l’onglet affiché</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void run("xlsx")}>Excel (.xlsx)</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void run("json")}>JSON (.json)</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {failed && (
        <p role="alert" className="absolute right-0 top-full z-20 mt-1 whitespace-nowrap rounded-md border bg-card px-2 py-1 text-xs text-destructive shadow-sm">
          {FAILED}
        </p>
      )}
    </div>
  );
}
