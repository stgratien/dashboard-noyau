import { useContext } from "react";
import { cn } from "@/lib/utils";
import { client } from "@/lib/client";
import type { PlatformId } from "@/lib/dashboard-data";
import { adAudiencePeriods } from "@/lib/dashboard-periods";
import { periodName } from "@/lib/report-tokens";
import { PAGE_AUDIENCE_PLATFORMS, pageAudienceView, type PageAudienceColumn, type PageAudiencePanelView } from "@/lib/page-audience";
import { Panel, ReportRowLimit, SectionTitle, TabNotes, type SocialData, type ViewPeriods } from "./common";

/** Les périodes relevées : les trimestres terminés et, pour un client qui en a, ses éditions terminées (un client sans édition n'en entend pas parler). */
const readablePeriods = () => (client.events.editions.length > 0 ? "par trimestre ou par édition terminés" : "par trimestre terminé");
const hint = () => `Les tailles d’entreprise des visiteurs et des abonnés se relèvent ${readablePeriods()} : choisissez-en un comme période pour les voir.`;
const UNFETCHED = "Les tailles d’entreprise de cette période ne sont pas encore relevées.";
const FAILED = "Tailles d’entreprise momentanément indisponibles.";
const ABOUT = "Chiffres relevés dans les statistiques de la page du réseau, par taille d’entreprise (tranche d’effectif) : les visiteurs de la page sur la période, les abonnés à la fin de la période. Les cinq tailles les plus nombreuses sont affichées, la part est celle de l’ensemble.";
const noComparison = () => `La période comparée n’a pas de tailles d’entreprise relevées (les relevés se font ${readablePeriods()}).`;

/** Nombres entiers avec séparateur de milliers (« 8 499 »), part avec une décimale sans zéro inutile (« 31,6% », « 7% »). */
const amount = (n: number) => n.toLocaleString("fr-FR");
const share = (n: number | null) => (n == null ? "—" : `${String(Math.round(n * 10) / 10).replace(".", ",")}%`);

/** Une période : son titre (« Visiteurs T2 2026 ») puis ses tailles, la barre proportionnelle à la part (même échelle pour les deux colonnes). */
function Column({ heading, column, maxShare }: { heading: string; column: PageAudienceColumn; maxShare: number }) {
  return (
    <div className="min-w-0 space-y-3">
      <h3 className="text-base font-semibold">{heading}</h3>
      {column.reading === "unavailable" ? (
        <p className="text-sm text-muted-foreground">Donnée non disponible</p>
      ) : (
        <ul className="space-y-3">
          {column.rows.map((row) => (
            <li key={row.label} className="space-y-1 text-sm">
              <p className="break-words">
                <span className="font-medium">{row.label}</span>
                <span className="text-muted-foreground"> · {amount(row.value)} ({share(row.share)})</span>
              </p>
              <div className="h-1.5 rounded bg-muted">
                <div className="h-1.5 rounded bg-primary" style={{ width: `${maxShare > 0 && row.share != null ? Math.min(100, (row.share / maxShare) * 100) : 0}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PageAudiencePanel({ panel, periods, forReport }: { panel: PageAudiencePanelView; periods: ViewPeriods; forReport: boolean }) {
  const maxShare = [...panel.current.rows, ...panel.compared.rows].reduce((m, r) => Math.max(m, r.share ?? 0), 0);
  // Un panneau sans chiffres pour la période affichée n'est pas capturé : une image « Donnée non disponible » n'a rien à faire dans le rapport (son emplacement est retiré).
  const tagged = !forReport || panel.current.reading === "read";
  return (
    <Panel title="" bare {...(tagged ? { reportKey: panel.reportKey } : {})}>
      <div className={cn("grid items-start gap-x-8 gap-y-6", forReport ? "grid-cols-2" : "grid-cols-1 md:grid-cols-2")}>
        <Column heading={`${panel.metric} ${periodName(periods.period)}`} column={panel.current} maxShare={maxShare} />
        <Column heading={`${panel.metric} ${periodName(periods.comparison)}`} column={panel.compared} maxShare={maxShare} />
      </div>
    </Panel>
  );
}

/**
 * « Tailles d'entreprise » (onglets des réseaux dont la page les fournit, quand le client l'active) : les visiteurs de la page puis les abonnés par taille d'entreprise,
 * la période affichée à gauche et la période comparée à droite. Le réseau ne donne ces chiffres que dans ses écrans de statistiques : ils sont chargés à la main pour les
 * trimestres (et éditions) terminés (voir adAudiencePeriods), les autres périodes disent comment les voir. Pas de carte « partiel » : un chiffre chargé est un chiffre du réseau.
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
      <SectionTitle title="Tailles d’entreprise" className="border-b pb-1 text-lg font-medium text-foreground" />
      <TabNotes notes={[note, view.state === "ready" ? ABOUT : null, view.state === "ready" && !view.comparedAny ? noComparison() : null]} />
      {view.state === "ready" && (
        <div className="space-y-6">
          {view.panels.map((panel) => (
            <PageAudiencePanel key={panel.dimension} panel={panel} periods={{ period, comparison }} forReport={forReport} />
          ))}
        </div>
      )}
    </section>
  );
}
