import { useContext, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { client } from "@/lib/client";
import type { PlatformId } from "@/lib/dashboard-data";
import { changePercent, formatChangePercent, formatPoints } from "@/lib/dashboard-format";
import { adAudiencePeriods } from "@/lib/dashboard-periods";
import { definition } from "@/lib/kpi-definitions";
import { AD_AUDIENCE_PLATFORMS, AD_AUDIENCE_REPORT_ROWS, adAudienceView, type AdAudienceFigures, type AdAudiencePanelView, type AdAudienceViewRow } from "@/lib/ad-audience";
import { Panel, ReportRowLimit, SectionTitle, TabNotes, fmt, pct, type SocialData, type ViewPeriods } from "./common";

/** Les périodes relevées : les trimestres terminés et, pour un client qui en a, ses éditions terminées (un client sans édition n'en entend pas parler). */
const readablePeriods = () => (client.events.editions.length > 0 ? "par trimestre ou par édition terminés" : "par trimestre terminé");
const hint = () => `L’audience sponsorisée se relève ${readablePeriods()} : choisissez-en un comme période pour la voir.`;
const UNFETCHED = "L’audience sponsorisée de cette période n’est pas encore relevée.";
const FAILED = "Audience sponsorisée momentanément indisponible.";
const ABOUT = "Personnes touchées par les publicités sur la période, par profil. Les clics comptent tous les clics sur les publicités, comme dans le gestionnaire de publicités du réseau.";
const noComparison = () => `La période comparée n’a pas d’audience sponsorisée relevée (les relevés se font ${readablePeriods()}).`;

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
const countChange = (now: number | null, before: number | null | undefined) => {
  const d = changePercent(now, before);
  return d === undefined ? undefined : formatChangePercent(d);
};
const rateChange = (now: number | null, before: number | null | undefined) => (now == null || before == null ? undefined : formatPoints(now - before));

function Row({ row, max, compared, forReport }: { row: AdAudienceViewRow; max: number; compared: boolean; forReport: boolean }) {
  const prev: AdAudienceFigures | null = row.prev;
  return (
    <li className="space-y-1 text-sm">
      <div className={cn("flex gap-x-3", forReport ? "flex-row items-start" : "flex-col gap-y-1 sm:flex-row sm:items-start")}>
        <span className="line-clamp-2 min-w-0 flex-1 break-words">{row.label}</span>
        <div className={cn("flex shrink-0 gap-x-3", !forReport && "self-end sm:self-auto")}>
          <Cell caption="Impressions" forReport={forReport}>
            <span className="block font-medium">{count(row.impressions)}</span>
            <Versus show={compared} text={count(prev?.impressions)} change={countChange(row.impressions, prev?.impressions)} />
          </Cell>
          <Cell caption="Clics" forReport={forReport}>
            <span className="block font-medium">{count(row.clicks)}</span>
            <Versus show={compared} text={count(prev?.clicks)} change={countChange(row.clicks, prev?.clicks)} />
          </Cell>
          <Cell caption="Taux de clic" forReport={forReport}>
            <span className="block font-medium">{rate(row.ctr)}</span>
            <Versus show={compared} text={rate(prev?.ctr)} change={rateChange(row.ctr, prev?.ctr)} />
          </Cell>
        </div>
      </div>
      <div className="h-1.5 rounded bg-muted">
        <div className="h-1.5 rounded bg-primary" style={{ width: `${max > 0 ? Math.min(100, (row.impressions / max) * 100) : 0}%` }} />
      </div>
    </li>
  );
}

function AdAudiencePanel({ panel, limit, info }: { panel: AdAudiencePanelView; limit: number | undefined; info: string }) {
  const forReport = limit !== undefined;
  const cut = forReport && panel.rows.length > limit;
  const rows = cut ? panel.rows.slice(0, limit) : panel.rows;
  const title = cut ? `${panel.title} (top ${limit})` : panel.title;
  const max = rows.reduce((m, r) => Math.max(m, r.impressions), 0);
  // Un panneau sans valeur n'est pas capturé : une image « Donnée non disponible » n'a rien à faire dans le rapport (son emplacement est retiré).
  const tagged = !forReport || rows.length > 0;
  const compared = panel.compared !== "unavailable";
  return (
    <Panel title={title} info={info} {...(tagged ? { reportKey: `adAudience-${panel.dimension}` } : {})}>
      {panel.reading === "unavailable" ? (
        <p className="text-sm text-muted-foreground">Donnée non disponible</p>
      ) : panel.reading === "none" ? (
        <p className="text-sm text-muted-foreground">Aucune diffusion sur la période</p>
      ) : (
        <>
          {/* Légende des colonnes : toujours dans l'image du rapport (sans classe de fenêtre) ; à l'écran, sur téléphone, chaque cellule porte sa propre légende. */}
          <div className={cn("mb-2 justify-end gap-x-3 text-[11px] text-muted-foreground", forReport ? "flex" : "hidden sm:flex")}>
            <span className="w-[5.5rem] text-right">Impressions</span>
            <span className="w-[5.5rem] text-right">Clics</span>
            <span className="w-[5.5rem] text-right">Taux de clic</span>
          </div>
          <ul className="space-y-3">
            {rows.map((row) => (
              <Row key={row.label} row={row} max={max} compared={compared} forReport={forReport} />
            ))}
          </ul>
          {panel.returned != null && panel.returned > rows.length && (
            <p className="mt-3 text-xs text-muted-foreground">
              {rows.length} valeurs les plus diffusées sur {fmt(panel.returned)}
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

/**
 * « Audience sponsorisée » (onglets des réseaux dont les publicités la fournissent, quand le client l'active) : le profil des personnes touchées par les publicités,
 * par fonction, poste, secteur, entreprise, niveau hiérarchique et lieu, avec la comparaison. Le réseau ne la donne que pour une période entière : seuls les trimestres
 * et éditions terminés ont un relevé (voir adAudiencePeriods), les autres périodes disent comment la voir. Pas de carte « partiel » : une valeur lue est une valeur du réseau.
 */
export function AdAudienceSection({ data, p, period, comparison }: ViewPeriods & { data: SocialData["adAudience"] | undefined; p: PlatformId }) {
  const limit = useContext(ReportRowLimit);
  if (!client.features.adAudience || !AD_AUDIENCE_PLATFORMS.includes(p)) return null;
  const view = adAudienceView(data, p, period, comparison, adAudiencePeriods());
  const note =
    view.state === "hint" ? hint() : view.state === "unfetched" ? UNFETCHED : view.state === "failed" ? FAILED : null;
  const reportLimit = limit === undefined ? undefined : Math.max(limit, AD_AUDIENCE_REPORT_ROWS);
  return (
    <section data-export-block className="space-y-3">
      <SectionTitle title="Audience sponsorisée" className="border-b pb-1 text-lg font-medium text-foreground" />
      <TabNotes notes={[note, view.state === "ready" ? ABOUT : null, view.state === "ready" && !view.comparedAny ? noComparison() : null]} />
      {view.state === "ready" && (
        <div className={cn("grid gap-6", reportLimit !== undefined ? "grid-cols-2" : "grid-cols-1 lg:grid-cols-2")}>
          {view.panels.map((panel) => (
            <AdAudiencePanel key={panel.dimension} panel={panel} limit={reportLimit} info={definition("adAudience", p)} />
          ))}
        </div>
      )}
    </section>
  );
}
