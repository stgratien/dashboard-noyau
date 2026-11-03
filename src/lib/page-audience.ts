import type { PlatformId } from "@/lib/dashboard-data";
import { changePercent } from "@/lib/dashboard-format";
import { companySizeLabel } from "@/lib/company-size";

/**
 * Visiteurs de la page : les PAGES VUES de la page d'un réseau, par profil du visiteur (pour l'instant la taille de son entreprise), telles que le réseau les fournit
 * pour une période donnée (LinkedIn : « Visiteurs » de la page, découpage par taille d'entreprise). Ce sont des pages vues, pas des visiteurs uniques.
 * Ce fichier ne contient que ce qui est partagé par la synchronisation, le chargeur et l'affichage (types, découpages, clés) et la vue pure : aucun accès aux données.
 */

/** Réseaux dont la page fournit ce découpage. */
export const PAGE_AUDIENCE_PLATFORMS: PlatformId[] = ["linkedin"];

/** Les découpages, dans l'ordre d'affichage ; `key` est aussi la clé stockée et la fin de `reportKey` (`visitors-<clé>`). */
export const PAGE_AUDIENCE_DIMENSIONS = [
  { key: "companySize", title: "Tailles d’entreprise des visiteurs", noun: "taille d’entreprise" },
] as const;
export type PageAudienceDimension = (typeof PAGE_AUDIENCE_DIMENSIONS)[number]["key"];
export const isPageAudienceDimension = (value: unknown): value is PageAudienceDimension =>
  PAGE_AUDIENCE_DIMENSIONS.some((d) => d.key === value);

/** Une valeur du découpage (ex. une tranche d'effectif) : les pages vues qu'elle a faites sur la période. `label` est le libellé brut du réseau (un code), mis en français à l'affichage. */
export type PageAudienceRow = { label: string; views: number };

/** Ligne stockée (table social_page_audience), avec sa période. */
export type StoredPageAudienceRow = PageAudienceRow & {
  platform: PlatformId; dimension: PageAudienceDimension; period_start: string; period_end: string;
};

/**
 * Relevé d'un découpage sur une période (table social_page_audience_periods), tel que le tableau de bord le lit : seuls les relevés aboutis (`synced_at`)
 * sont chargés, la date de la dernière tentative restant côté serveur. Seule une lecture aboutie prouve que le réseau a répondu pour cette période ;
 * `returned_count` et `total_views` portent sur toutes les valeurs lues, avant la limite de celles qui sont stockées.
 */
export type PageAudiencePeriod = {
  platform: PlatformId; dimension: PageAudienceDimension; period_start: string; period_end: string;
  returned_count: number | null; total_views: number | null; is_final: boolean; synced_at: string;
};

/** Ce que le chargeur renvoie : les relevés aboutis des périodes affichée et comparée, leurs valeurs, et l'échec éventuel de la lecture (jamais confondu avec une absence). */
export type PageAudienceData = { rows: StoredPageAudienceRow[]; periods: PageAudiencePeriod[]; failed: boolean };

/** Clé d'un relevé : plateforme, découpage et dates exactes de la période. */
export const pageAudienceKey = (platform: string, dimension: string, start: string, end: string) => `${platform}|${dimension}|${start}|${end}`;

/** Nombre de valeurs affichées par panneau (à l'écran comme dans le rapport) : les tranches d'effectif tiennent largement dans un top 10. */
export const PAGE_AUDIENCE_ROWS = 10;

/** Pages vues d'une valeur du découpage et sa part du total de la période (en %, nulle si le total est inconnu). */
export type PageAudienceFigures = { views: number; share: number | null };
/** `change` : variation en % des pages vues, seulement quand les deux périodes les connaissent (la valeur comparée est nulle, jamais 0, quand elle est absente de la comparaison). */
export type PageAudienceViewRow = PageAudienceFigures & { label: string; prev: PageAudienceFigures | null; change: number | null };
/** `read` : le réseau a répondu avec des valeurs ; `none` : il a répondu sans aucune (aucune visite) ; `unavailable` : pas de relevé pour cette période. */
export type PageAudienceReading = "read" | "none" | "unavailable";
export type PageAudiencePanelView = {
  dimension: PageAudienceDimension; title: string; reading: PageAudienceReading; compared: PageAudienceReading;
  rows: PageAudienceViewRow[]; /** Valeurs lues par le réseau avant la limite de celles qui sont gardées. */ returned: number | null;
};
/**
 * `hint` : la période n'est pas un trimestre ni une édition terminés, aucun relevé n'existe pour elle ; `unfetched` : elle l'est, mais rien n'est encore relevé ;
 * `failed` : la lecture a échoué (jamais présentée comme une absence) ; `ready` : au moins un découpage est relevé.
 */
export type PageAudienceView = { state: "hint" | "unfetched" | "failed" } | { state: "ready"; panels: PageAudiencePanelView[]; comparedAny: boolean };

const samePeriod = (a: { start: string; end: string }, start: string, end: string) => a.start === start && a.end === end;
/** Libellé affiché d'une valeur : la tranche d'effectif en français (les codes qui donnent le même texte sont additionnés par `merge`). */
const shownLabel = (dimension: PageAudienceDimension, raw: string) => (dimension === "companySize" ? companySizeLabel(raw) : raw.replace(/\s+/g, " ").trim());
/** Valeurs d'un relevé sous leur libellé affiché, les libellés identiques additionnés (deux codes de tranche peuvent donner le même texte). */
function merge(dimension: PageAudienceDimension, rows: StoredPageAudienceRow[]) {
  const out = new Map<string, number>();
  for (const r of rows) {
    const label = shownLabel(dimension, r.label);
    if (label) out.set(label, (out.get(label) ?? 0) + r.views);
  }
  return out;
}
/** Classement d'affichage : pages vues décroissantes, libellé à égalité. */
const compareRows = (a: { label: string; views: number }, b: { label: string; views: number }) =>
  b.views - a.views || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
const shareOf = (views: number, total: number) => (total > 0 ? (views / total) * 100 : null);

/**
 * Ce que la section « Visiteurs de la page » affiche pour la période et sa comparaison. Les relevés sont retrouvés par leurs dates exactes ; `planned` est la liste
 * des périodes relevées (adAudiencePeriods) : une période absente de la liste et sans relevé n'est pas « pas encore relevée » mais « à choisir par trimestre ou édition ».
 * La part se calcule sur le total lu par le réseau (avant la limite des valeurs gardées) ; la valeur comparée se retrouve par son libellé affiché ; absente de la comparaison
 * (hors des valeurs gardées, ou non relevée) elle reste inconnue (null, « — »), jamais zéro.
 */
export function pageAudienceView(
  data: PageAudienceData | undefined, period: { start: string; end: string }, comparison: { start: string; end: string }, planned: { start: string; end: string }[],
  platform: PlatformId = "linkedin",
): PageAudienceView {
  if (!data) return { state: "unfetched" };
  if (data.failed) return { state: "failed" };
  const read = (range: { start: string; end: string }, dimension: PageAudienceDimension) => {
    const reading = data.periods.find((p) => p.platform === platform && p.dimension === dimension && samePeriod({ start: p.period_start, end: p.period_end }, range.start, range.end));
    if (!reading) return { reading: "unavailable" as PageAudienceReading, values: new Map<string, number>(), total: 0, returned: null };
    const values = merge(dimension, data.rows.filter((r) => r.platform === platform && r.dimension === dimension && r.period_start === range.start && r.period_end === range.end));
    // Un relevé abouti sans valeur n'est « aucune visite » que si le réseau n'a rien renvoyé non plus (returned_count) ; des valeurs perdues ne sont pas une absence.
    if (values.size === 0 && (reading.returned_count ?? 1) > 0) return { reading: "unavailable" as PageAudienceReading, values, total: 0, returned: reading.returned_count };
    const kept = [...values.values()].reduce((sum, v) => sum + v, 0);
    return { reading: (values.size ? "read" : "none") as PageAudienceReading, values, total: reading.total_views != null && reading.total_views > 0 ? reading.total_views : kept, returned: reading.returned_count };
  };
  const current = PAGE_AUDIENCE_DIMENSIONS.map((d) => ({ d, ...read(period, d.key) }));
  if (current.every((c) => c.reading === "unavailable")) return { state: planned.some((p) => samePeriod(p, period.start, period.end)) ? "unfetched" : "hint" };
  const panels = current.map(({ d, reading, values, total, returned }): PageAudiencePanelView => {
    const before = read(comparison, d.key);
    const rows = [...values].map(([label, views]) => {
      const was = before.values.get(label);
      const prev = was === undefined ? null : { views: was, share: shareOf(was, before.total) };
      return { label, views, share: shareOf(views, total), prev, change: changePercent(views, prev?.views) ?? null };
    }).sort(compareRows);
    return { dimension: d.key, title: d.title, reading, compared: before.reading, rows, returned };
  });
  return { state: "ready", panels, comparedAny: panels.some((p) => p.compared !== "unavailable") };
}
