import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { generateSlidesReport, preloadGoogle, type ReportRequest, type ReportResult, type ReportStep } from "@/lib/google-report";
import { longPeriod, periodName } from "@/lib/report-tokens";
import type { Period } from "@/lib/dashboard-periods";
import { client } from "@/lib/client";

const STEPS: Record<ReportStep, string> = {
  figures: "Calcul des chiffres du tableau de bord",
  google: "Connexion à Google",
  template: "Choix du modèle (une seule fois)",
  copy: "Copie du modèle dans votre Drive",
  fill: "Remplissage des diapositives",
  images: "Images du tableau de bord (graphiques, audience, publications)",
  check: "Contrôle du résultat",
};
const ORDER: ReportStep[] = ["figures", "google", "template", "copy", "fill", "images", "check"];

/** Nom de la période comparée écrit dans le rapport : « T2 2024 », « septembre 2026 », « Édition 2025 » ou les dates. */
export const comparisonName = (period: Period) => periodName(period).slice(0, 60);

type State = { status: "idle" } | { status: "running"; step: ReportStep } | { status: "done"; result: ReportResult } | { status: "error"; message: string };

/**
 * Génère le reporting : copie le modèle Google Slides dans le Drive de la personne et le remplit avec la période et la comparaison choisies.
 * Renvoie `generate` (à brancher sur un clic, la fenêtre Google dépend du geste) et `dialog` (à afficher une fois dans la page).
 * `enabled` charge les scripts Google d'avance ; tant qu'aucun déclencheur n'est affiché, rien n'est chargé.
 */
export function useReportGenerator({ period, comparison, enabled, captureImages }: { period: Period; comparison: Period; enabled: boolean; captureImages?: ReportRequest["captureImages"] | undefined }) {
  const [state, setState] = useState<State>({ status: "idle" });
  const [open, setOpen] = useState(false);
  const running = state.status === "running";
  const busy = useRef(false);
  useEffect(() => { if (enabled) preloadGoogle(); }, [enabled]);

  const generate = () => {
    if (busy.current) return;
    busy.current = true;
    setOpen(true);
    setState({ status: "running", step: "figures" });
    // Appelé dans le geste du clic : la fenêtre de connexion Google s'ouvre dans ce même geste.
    generateSlidesReport({
      period,
      comparison: { period: comparison, label: comparisonName(comparison) },
      ...(captureImages ? { captureImages } : {}),
      onStep: (step) => {
        setState({ status: "running", step });
        // Le sélecteur de fichiers Google s'ouvre au-dessus de la page : une fenêtre modale ouverte bloquerait ses clics.
        setOpen(step !== "template");
      },
    })
      .then((result) => { setState({ status: "done", result }); setOpen(true); })
      .catch((error: unknown) => { setState({ status: "error", message: error instanceof Error ? error.message : "Génération impossible." }); setOpen(true); })
      .finally(() => { busy.current = false; });
  };

  const dialog = (
      <Dialog open={open} onOpenChange={(next) => { if (!running) setOpen(next); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{state.status === "done" ? "Reporting prêt" : state.status === "error" ? "Reporting non généré" : "Génération du reporting"}</DialogTitle>
            <DialogDescription>
              {longPeriod(period)} · comparé à {comparisonName(comparison)}
            </DialogDescription>
          </DialogHeader>
          {state.status === "running" && (
            <ol className="space-y-2 text-sm" aria-live="polite">
              {ORDER.filter((s) => s !== "template" || state.step === "template").map((s) => {
                const done = ORDER.indexOf(s) < ORDER.indexOf(state.step);
                const current = s === state.step;
                return (
                  <li key={s} className={current ? "flex items-center gap-2 font-medium" : done ? "flex items-center gap-2 text-muted-foreground" : "flex items-center gap-2 text-muted-foreground/60"}>
                    {current ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="inline-block w-4 text-center">{done ? "✓" : "·"}</span>}
                    {STEPS[s]}
                  </li>
                );
              })}
            </ol>
          )}
          {state.status === "error" && (
            <div className="space-y-3 text-sm">
              <p role="alert" className="text-destructive">{state.message}</p>
            </div>
          )}
          {state.status === "done" && <ReportResultView result={state.result} />}
          <DialogFooter>
            {state.status === "done" && (
              <Button asChild>
                <a href={state.result.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  Ouvrir dans Google Slides
                </a>
              </Button>
            )}
            {state.status === "error" && <Button onClick={generate}>Réessayer</Button>}
            {!running && <Button variant="outline" onClick={() => setOpen(false)}>Fermer</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
  return { generate, running, dialog };
}

function ReportResultView({ result }: { result: ReportResult }) {
  return (
    <div className="space-y-4 text-sm">
      <p>
        « {result.name} » est dans votre Drive, rempli avec les chiffres du tableau de bord.
      </p>
      {result.notes.length > 0 && (
        <section>
          <h3 className="mb-1 font-medium">Chiffres partiels, à relire</h3>
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            {result.notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </section>
      )}
      {result.imageNotes.length > 0 && (
        <section>
          <h3 className="mb-1 font-medium">Images du dashboard</h3>
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            {result.imageNotes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </section>
      )}
      {!result.checked && (
        <p className="text-muted-foreground">Le contrôle des marqueurs restants n'a pas pu être fait : ouvrez le rapport et cherchez « {"{{"} » pour vérifier.</p>
      )}
      {result.leftovers.length > 0 && (
        <section>
          <h3 className="mb-1 font-medium">Marqueurs restés dans le modèle</h3>
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            {result.leftovers.map((l, i) => <li key={`${l.marker}-${l.slide}-${i}`}>{`{{${l.marker}}}`} (diapositive {l.slide})</li>)}
          </ul>
        </section>
      )}
      <p className="text-xs text-muted-foreground">
        Les textes de commentaire et les sources que le tableau de bord n'a pas{client.report.manualSources.length > 0 ? ` (${client.report.manualSources.join(", ")})` : ""} restent à compléter à la main dans le modèle.
        {result.missingFigures.length > 0 &&
          ` ${result.missingFigures.length} ${result.missingFigures.length > 1 ? "chiffres indisponibles sont écrits" : "chiffre indisponible est écrit"} « n.d. ».`}
      </p>
    </div>
  );
}
