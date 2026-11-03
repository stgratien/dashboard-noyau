import { useContext, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { client } from "@/lib/client";
import type { PlatformId } from "@/lib/dashboard-data";
import { formatChangePercent, formatPoints } from "@/lib/dashboard-format";
import { adAudiencePeriods } from "@/lib/dashboard-periods";
import { definition } from "@/lib/kpi-definitions";
import { PAGE_AUDIENCE_PLATFORMS, PAGE_AUDIENCE_ROWS, pageAudienceView, type PageAudiencePanelView, type PageAudienceViewRow } from "@/lib/page-audience";
import { Panel, ReportRowLimit, SectionTitle, TabNotes, fmt, pct, type SocialData, type ViewPeriods } from "./common";

/** Les périodes relevées : les trimestres terminés et, pour un client qui en a, ses éditions terminées (un client sans édition n'en entend pas parler). */
const readablePeriods = () => (client.events.editions.length > 0 ? "par trimestre ou par édition terminés" : "par trimestre terminé");
const hint = () => `Les visiteurs par taille d’entreprise se relèvent ${readablePeriods()} : choisissez-en un comme période pour les voir.`;
const UNFETCHED = "Les visiteurs de la page de cette période ne sont pas encore relevés.";
const FAILED = "Visiteurs de la page momentanément indisponibles.";
const ABOUT = "Pages vues de la page par taille d’entreprise (tranche d’effectif) du visiteur : ce sont des pages vues, pas des visiteurs uniques.";
const noComparison = () => `La période comparée n’a pas de visiteurs de la page relevés (les relevés se font ${readablePeriods()}).`;

const dash = "—";
/** Ligne « vs » d'une cellule : la valeur comparée (« — » si elle est inconnue, jamais zéro) et, quand les deux sont connues, la variation. */
function Versus({ show, text, change }: { show: boolean; text: string; change?: string | undefined }) {
  if (!show) return null;
  const good = change === undefined || !change.startsWith("−");
  return (
    <span className="block text-[11px] font-normal leading-tight text-muted-foreground">
      vs {text}
      {change !== undefined && (
        <>
          {" "}
          <span className={cn("font-medium", good ? "text-success" : "text-destructive")}>({change})</span>
        </>
      )}
    </span>
  );
}

function Cell({ caption, forReport, children }: { caption: string; forReport: boolean; children: ReactNode }) {
  return (
    <div className="w-[5.5rem] text-right tabular-nums">
      {!forReport && <span className="block text-[10px] leading-tight text-muted-foreground sm:hidden">{caption}</span>}
      {children}
    </div>
  );
}

const count = (n: number | null | undefined) => (n == null ? dash : fmt(n));
const rate = (n: number | null | undefined) => (n == null ? dash : pct(n));
const shareChange = (now: number | null, before: number | null | undefined) => (now == null || before == null ? undefined : formatPoints(now - before));

function Row({ row, max, compared, forReport }: { row: PageAudienceViewRow; max: number; compared: boolean; forReport: boolean }) {
  return (
    <li className="space-y-1 text-sm">
      <div className={cn("flex gap-x-3", forReport ? "flex-row items-start" : "flex-col gap-y-1 sm:flex-row sm:items-start")}>
        <span className="line-clamp-2 min-w-0 flex-1 break-words">{row.label}</span>
        <div className={cn("flex shrink-0 gap-x-3", !forReport && "self-end sm:self-auto")}>
          <Cell caption="Pages vues" forReport={forReport}>
            <span className="block font-medium">{count(row.views)}</span>
            <Versus show={compared} text={count(row.prev?.views)} change={row.change === null ? undefined : formatChangePercent(row.change)} />
          </Cell>
          <Cell caption="Part" forReport={forReport}>
            <span className="block font-medium">{rate(row.share)}</span>
            <Versus show={compared} text={rate(row.prev?.share)} change={shareChange(row.share, row.prev?.share)} />
          </Cell>
        </div>
      </div>
      {/* Barre proportionnelle à la part (les pages vues rapportées à la plus grande valeur affichée : même total, mêmes proportions). */}
      <div className="h-1.5 rounded bg-muted">
        <div className="h-1.5 rounded bg-primary" style={{ width: `${max > 0 ? Math.min(100, (row.views / max) * 100) : 0}%` }} />
      </div>
    </li>
  );
}

function PageAudiencePanel({ panel, forReport, info }: { panel: PageAudiencePanelView; forReport: boolean; info: string }) {
  const cut = panel.rows.length > PAGE_AUDIENCE_ROWS;
  const rows = cut ? panel.rows.slice(0, PAGE_AUDIENCE_ROWS) : panel.rows;
  const max = rows.reduce((m, r) => Math.max(m, r.views), 0);
  // Un panneau sans valeur n'est pas capturé : une image « Donnée non disponible » n'a rien à faire dans le rapport (son emplacement est retiré).
  const tagged = !forReport || rows.length > 0;
  const compared = panel.compared !== "unavailable";
  return (
    <Panel title={`${panel.title} (top ${PAGE_AUDIENCE_ROWS})`} info={info} {...(tagged ? { reportKey: `visitors-${panel.dimension}` } : {})}>
      {panel.reading === "unavailable" ? (
        <p className="text-sm text-muted-foreground">Donnée non disponible</p>
      ) : panel.reading === "none" ? (
        <p className="text-sm text-muted-foreground">Aucune visite sur la période</p>
      ) : (
        <>
          {/* La période comparée sans relevé : dit dans le panneau lui-même (donc dans l'image du rapport), la légende « vs » de la diapositive ne doit pas laisser croire à une comparaison. */}
          {!compared && <p className="mb-2 text-xs text-muted-foreground">Comparaison non disponible : la période comparée n’est pas relevée.</p>}
          {/* Légende des colonnes : toujours dans l'image du rapport (sans classe de fenêtre) ; à l'écran, sur téléphone, chaque cellule porte sa propre légende. */}
          <div className={cn("mb-2 justify-end gap-x-3 text-[11px] text-muted-foreground", forReport ? "flex" : "hidden sm:flex")}>
            <span className="w-[5.5rem] text-right">Pages vues</span>
            <span className="w-[5.5rem] text-right">Part</span>
          </div>
          <ul className="space-y-3">
            {rows.map((row) => (
              <Row key={row.label} row={row} max={max} compared={compared} forReport={forReport} />
            ))}
          </ul>
          {cut && (
            <p className="mt-3 text-xs text-muted-foreground">
              {rows.length} valeurs les plus vues sur {fmt(Math.max(panel.returned ?? 0, panel.rows.length))}
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

/**
 * « Visiteurs de la page » (onglets des réseaux dont la page les fournit, quand le client l'active) : les pages vues de la page par taille d'entreprise du visiteur
 * (tranche d'effectif), avec la comparaison. Ce sont des pages vues, pas des visiteurs uniques. Le réseau ne les donne que pour une période entière : seuls les trimestres
 * et éditions terminés ont un relevé (voir adAudiencePeriods), les autres périodes disent comment la voir. Pas de carte « partiel » : une valeur lue est une valeur du réseau.
 */
export function PageAudienceSection({ data, p, period, comparison }: ViewPeriods & { data: SocialData["pageAudience"] | undefined; p: PlatformId }) {
  const limit = useContext(ReportRowLimit);
  if (!client.features.pageAudience || !PAGE_AUDIENCE_PLATFORMS.includes(p)) return null;
  const view = pageAudienceView(data, period, comparison, adAudiencePeriods(), p);
  const note =
    view.state === "hint" ? hint() : view.state === "unfetched" ? UNFETCHED : view.state === "failed" ? FAILED : null;
  const forReport = limit !== undefined;
  return (
    <section data-export-block className="space-y-3">
      <SectionTitle title="Visiteurs de la page" className="border-b pb-1 text-lg font-medium text-foreground" />
      <TabNotes notes={[note, view.state === "ready" ? ABOUT : null, view.state === "ready" && !view.comparedAny ? noComparison() : null]} />
      {view.state === "ready" && (
        <div className={cn("grid items-start gap-6", forReport ? "grid-cols-2" : "grid-cols-1 xl:grid-cols-2")}>
          {view.panels.map((panel) => (
            <PageAudiencePanel key={panel.dimension} panel={panel} forReport={forReport} info={definition("pageAudience", p)} />
          ))}
        </div>
      )}
    </section>
  );
}
