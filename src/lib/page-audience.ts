import type { PlatformId } from "@/lib/dashboard-data";
import { companySizeLabel } from "@/lib/company-size";

/**
 * Tailles d'entreprise des visiteurs de la page et des abonnés, par période : les chiffres que le réseau montre dans les statistiques de sa page (LinkedIn : « Visiteurs » et
 * « Abonnés », découpage par taille d'entreprise). Il ne les fournit PAS par période à l'outil de synchronisation (le champ des visiteurs est un cumul depuis toujours, celui des abonnés
 * un instantané) : ils sont donc chargés à la main, trimestre par trimestre, dans les tables social_page_audience et social_page_audience_periods (voir seeds/ du client).
 * Ce fichier ne contient que ce qui est partagé par le chargeur et l'affichage (types, découpages, clés) et la vue pure : aucun accès aux données.
 */

/** Réseaux dont la page fournit ce découpage. */
export const PAGE_AUDIENCE_PLATFORMS: PlatformId[] = ["linkedin"];

/**
 * Les découpages, dans l'ordre d'affichage. `key` est la clé stockée ; `metric` ce que compte la valeur (visiteurs de la page sur la période, abonnés à la fin de la période) ;
 * `reportKey` la clé de l'image du rapport (marqueur `{{image.<réseau>.<clé>}}`).
 */
export const PAGE_AUDIENCE_DIMENSIONS = [
  { key: "companySize", metric: "Visiteurs", reportKey: "visitors-companySize" },
  { key: "followersCompanySize", metric: "Abonnés", reportKey: "followers-companySize" },
] as const;
export type PageAudienceDimension = (typeof PAGE_AUDIENCE_DIMENSIONS)[number]["key"];
export const isPageAudienceDimension = (value: unknown): value is PageAudienceDimension =>
  PAGE_AUDIENCE_DIMENSIONS.some((d) => d.key === value);

/** Ligne stockée (table social_page_audience) : `label` est le libellé brut du réseau (un code de tranche d'effectif), mis en français à l'affichage ; `views` est la valeur (visiteurs ou abonnés). */
export type StoredPageAudienceRow = {
  platform: PlatformId; dimension: PageAudienceDimension; period_start: string; period_end: string; label: string; views: number;
};

/**
 * Relevé d'un découpage sur une période (table social_page_audience_periods), tel que le tableau de bord le lit : seuls les relevés aboutis (`synced_at`) sont chargés.
 * Seul un relevé prouve que les chiffres existent pour cette période ; `returned_count` et `total_views` portent sur toute la répartition, y compris les valeurs non stockées
 * (les listes chargées à la main ne contiennent que les plus grandes tailles : la part se calcule sur ce total).
 */
export type PageAudiencePeriod = {
  platform: PlatformId; dimension: PageAudienceDimension; period_start: string; period_end: string;
  returned_count: number | null; total_views: number | null; is_final: boolean; synced_at: string;
};

/** Ce que le chargeur renvoie : les relevés des périodes affichée et comparée, leurs valeurs, et l'échec éventuel de la lecture (jamais confondu avec une absence). */
export type PageAudienceData = { rows: StoredPageAudienceRow[]; periods: PageAudiencePeriod[]; failed: boolean };

/** Nombre de tailles affichées par colonne, à l'écran comme dans le rapport : les cinq plus nombreuses. */
export const PAGE_AUDIENCE_ROWS = 5;

/** Une taille d'entreprise d'une période : sa valeur et sa part du total de la période (en %, nulle si le total est inconnu). */
export type PageAudienceViewRow = { label: string; value: number; share: number | null };
/** `read` : des chiffres existent pour cette période ; `unavailable` : aucun relevé (jamais présenté comme zéro). */
export type PageAudienceColumn = { reading: "read" | "unavailable"; rows: PageAudienceViewRow[] };
export type PageAudiencePanelView = {
  dimension: PageAudienceDimension; metric: string; reportKey: string; current: PageAudienceColumn; compared: PageAudienceColumn;
};
/**
 * `hint` : la période n'est pas un trimestre ni une édition terminés, aucun relevé n'existe pour elle ; `unfetched` : elle l'est, mais rien n'est encore relevé ;
 * `failed` : la lecture a échoué (jamais présentée comme une absence) ; `ready` : au moins un découpage est relevé pour la période affichée.
 */
export type PageAudienceView = { state: "hint" | "unfetched" | "failed" } | { state: "ready"; panels: PageAudiencePanelView[]; comparedAny: boolean };

const samePeriod = (a: { start: string; end: string }, start: string, end: string) => a.start === start && a.end === end;
/** Libellé affiché d'une valeur : la tranche d'effectif en français (les codes qui donnent le même texte sont additionnés par `merge`). */
const shownLabel = (raw: string) => companySizeLabel(raw);
/** Valeurs d'un relevé sous leur libellé affiché, les libellés identiques additionnés (deux codes de tranche peuvent donner le même texte). */
function merge(rows: StoredPageAudienceRow[]) {
  const out = new Map<string, number>();
  for (const r of rows) {
    const label = shownLabel(r.label);
    if (label) out.set(label, (out.get(label) ?? 0) + r.views);
  }
  return out;
}
/** Classement d'affichage : valeur décroissante, libellé à égalité. */
const compareRows = (a: { label: string; value: number }, b: { label: string; value: number }) =>
  b.value - a.value || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
const shareOf = (value: number, total: number) => (total > 0 ? (value / total) * 100 : null);

/**
 * Ce que la section « Tailles d'entreprise » affiche pour la période et sa comparaison : un panneau par découpage (visiteurs, abonnés), une colonne par période. Les relevés sont
 * retrouvés par leurs dates exactes ; `planned` est la liste des périodes relevées (adAudiencePeriods) : une période absente de la liste et sans relevé n'est pas « pas encore relevée »
 * mais « à choisir par trimestre ou édition ». La part se calcule sur le total de la répartition complète (`total_views`), pas sur les seules tailles affichées.
 */
export function pageAudienceView(
  data: PageAudienceData | undefined, period: { start: string; end: string }, comparison: { start: string; end: string }, planned: { start: string; end: string }[],
  platform: PlatformId = "linkedin",
): PageAudienceView {
  if (!data) return { state: "unfetched" };
  if (data.failed) return { state: "failed" };
  const read = (range: { start: string; end: string }, dimension: PageAudienceDimension): PageAudienceColumn => {
    const reading = data.periods.find((p) => p.platform === platform && p.dimension === dimension && samePeriod({ start: p.period_start, end: p.period_end }, range.start, range.end));
    const unavailable: PageAudienceColumn = { reading: "unavailable", rows: [] };
    if (!reading) return unavailable;
    const values = merge(data.rows.filter((r) => r.platform === platform && r.dimension === dimension && r.period_start === range.start && r.period_end === range.end));
    // Un relevé sans aucune valeur stockée n'est pas une répartition vide : des valeurs perdues ne sont jamais présentées comme zéro.
    if (values.size === 0) return unavailable;
    const kept = [...values.values()].reduce((sum, v) => sum + v, 0);
    // Le total de la répartition COMPLÈTE : sans lui, les valeurs gardées ne le remplacent que si elles sont toute la répartition (`returned_count` ne dit pas le contraire) ;
    // une liste partielle sans total n'a pas de part (« — »), jamais une part gonflée. Un total inférieur aux valeurs gardées est incohérent : il ne peut pas être plus petit qu'elles (aucune part au-dessus de 100 %).
    const known = reading.total_views != null && reading.total_views > 0 ? reading.total_views : null;
    const whole = reading.returned_count == null || reading.returned_count <= values.size;
    const total = known != null ? Math.max(known, kept) : whole ? kept : 0;
    const rows = [...values].map(([label, value]) => ({ label, value, share: shareOf(value, total) })).sort(compareRows).slice(0, PAGE_AUDIENCE_ROWS);
    return { reading: "read", rows };
  };
  const panels = PAGE_AUDIENCE_DIMENSIONS.map((d): PageAudiencePanelView => ({
    dimension: d.key, metric: d.metric, reportKey: d.reportKey, current: read(period, d.key), compared: read(comparison, d.key),
  }));
  if (panels.every((p) => p.current.reading === "unavailable")) return { state: planned.some((p) => samePeriod(p, period.start, period.end)) ? "unfetched" : "hint" };
  return { state: "ready", panels, comparedAny: panels.some((p) => p.compared.reading === "read") };
}
