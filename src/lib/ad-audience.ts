import type { PlatformId } from "@/lib/dashboard-data";

/**
 * Audience sponsorisée : le profil (fonction, poste, secteur, entreprise, niveau hiérarchique, lieu) des personnes que les publicités ont touchées,
 * tel que le réseau le fournit pour une période donnée (LinkedIn Ads : « Données démographiques » du Campaign Manager).
 * Ce fichier ne contient que ce qui est partagé par la synchronisation, le chargeur et l'affichage (types, découpages, clés) : aucun accès aux données.
 */

/** Réseaux dont les publicités fournissent ce découpage. */
export const AD_AUDIENCE_PLATFORMS: PlatformId[] = ["linkedin"];

/** Les découpages, dans l'ordre d'affichage (celui des diapositives du rapport) ; `key` est aussi la clé stockée et la fin de `reportKey`. */
export const AD_AUDIENCE_DIMENSIONS = [
  { key: "function", title: "Fonctions touchées", noun: "fonction" },
  { key: "title", title: "Postes touchés", noun: "poste" },
  { key: "industry", title: "Secteurs d’activité touchés", noun: "secteur" },
  { key: "company", title: "Entreprises touchées", noun: "entreprise" },
  { key: "seniority", title: "Niveaux hiérarchiques touchés", noun: "niveau hiérarchique" },
  { key: "region", title: "Lieux touchés", noun: "lieu" },
] as const;
export type AdAudienceDimension = (typeof AD_AUDIENCE_DIMENSIONS)[number]["key"];
export const isAdAudienceDimension = (value: unknown): value is AdAudienceDimension =>
  AD_AUDIENCE_DIMENSIONS.some((d) => d.key === value);

/** Une valeur du découpage (ex. une fonction) : ce que les annonces y ont fait sur la période. `clicks` : tous les clics, comme le Campaign Manager. */
export type AdAudienceRow = { label: string; impressions: number; clicks: number | null };

/** Ligne stockée (table social_ad_audience), avec sa période. */
export type StoredAdAudienceRow = AdAudienceRow & {
  platform: PlatformId; dimension: AdAudienceDimension; period_start: string; period_end: string;
};

/**
 * Relevé d'un découpage sur une période (table social_ad_audience_periods), tel que le tableau de bord le lit : seuls les relevés aboutis (`synced_at`)
 * sont chargés, la date de la dernière tentative restant côté serveur. Seule une lecture aboutie prouve que le réseau a répondu pour cette période ;
 * `returned_count` et les totaux portent sur toutes les valeurs lues, avant la limite de celles qui sont stockées.
 */
export type AdAudiencePeriod = {
  platform: PlatformId; dimension: AdAudienceDimension; period_start: string; period_end: string;
  returned_count: number | null; total_impressions: number | null; total_clicks: number | null;
  is_final: boolean; synced_at: string;
};

/** Ce que le chargeur renvoie : les relevés aboutis des périodes affichée et comparée, leurs valeurs, et l'échec éventuel de la lecture (jamais confondu avec une absence). */
export type AdAudienceData = { rows: StoredAdAudienceRow[]; periods: AdAudiencePeriod[]; failed: boolean };

/** Clé d'un relevé : plateforme, découpage et dates exactes de la période. */
export const adAudienceKey = (platform: string, dimension: string, start: string, end: string) => `${platform}|${dimension}|${start}|${end}`;

/** Nombre de valeurs par panneau quand la section est rendue pour le rapport (les classements démographiques sont plus longs que les autres : un top 10 tient sur une diapositive). */
export const AD_AUDIENCE_REPORT_ROWS = 10;

/** Chiffres d'une valeur du découpage ; le taux de clic (en %) se calcule à la lecture, jamais depuis un taux stocké. */
export type AdAudienceFigures = { impressions: number; clicks: number | null; ctr: number | null };
export type AdAudienceViewRow = AdAudienceFigures & { label: string; prev: AdAudienceFigures | null };
/** `read` : le réseau a répondu avec des valeurs ; `none` : il a répondu sans aucune (aucune diffusion) ; `unavailable` : pas de relevé pour cette période. */
export type AdAudienceReading = "read" | "none" | "unavailable";
export type AdAudiencePanelView = {
  dimension: AdAudienceDimension; title: string; reading: AdAudienceReading; compared: AdAudienceReading;
  rows: AdAudienceViewRow[]; /** Valeurs lues par le réseau avant la limite de celles qui sont gardées. */ returned: number | null;
};
/**
 * `hint` : la période n'est pas un trimestre ni une édition terminés, aucun relevé n'existe pour elle ; `unfetched` : elle l'est, mais rien n'est encore relevé ;
 * `failed` : la lecture a échoué (jamais présentée comme une absence) ; `ready` : au moins un découpage est relevé.
 */
export type AdAudienceView = { state: "hint" | "unfetched" | "failed" } | { state: "ready"; panels: AdAudiencePanelView[]; comparedAny: boolean };

const ctrOf = (impressions: number, clicks: number | null) => (clicks == null || !(impressions > 0) ? null : (clicks / impressions) * 100);
const samePeriod = (a: { start: string; end: string }, start: string, end: string) => a.start === start && a.end === end;
/** Classement d'affichage : impressions décroissantes, clics puis libellé à égalité (clics inconnus en dernier). */
const compareRows = (a: AdAudienceFigures & { label: string }, b: AdAudienceFigures & { label: string }) =>
  b.impressions - a.impressions || (b.clicks ?? -1) - (a.clicks ?? -1) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);

/**
 * Ce que la section « Audience sponsorisée » affiche pour la période et sa comparaison. Les relevés sont retrouvés par leurs dates exactes ; `planned` est la liste
 * des périodes relevées (adAudiencePeriods) : une période absente de la liste et sans relevé n'est pas « pas encore relevée » mais « à choisir par trimestre ou édition ».
 * La valeur comparée se retrouve par son libellé ; absente de la comparaison (hors des valeurs gardées, ou non relevée) elle reste inconnue (« — »), jamais zéro.
 */
export function adAudienceView(
  data: AdAudienceData | undefined, platform: PlatformId, period: { start: string; end: string }, comparison: { start: string; end: string }, planned: { start: string; end: string }[],
): AdAudienceView {
  if (!data) return { state: "unfetched" };
  if (data.failed) return { state: "failed" };
  const read = (range: { start: string; end: string }, dimension: AdAudienceDimension) => {
    const reading = data.periods.find((p) => p.platform === platform && p.dimension === dimension && samePeriod({ start: p.period_start, end: p.period_end }, range.start, range.end));
    if (!reading) return { reading: "unavailable" as AdAudienceReading, rows: [] as StoredAdAudienceRow[], returned: null };
    const rows = data.rows.filter((r) => r.platform === platform && r.dimension === dimension && r.period_start === range.start && r.period_end === range.end);
    // Un relevé abouti sans valeur n'est « aucune diffusion » que si le réseau n'a rien renvoyé non plus (returned_count) ; des valeurs perdues ne sont pas une absence.
    if (rows.length === 0 && (reading.returned_count ?? 1) > 0) return { reading: "unavailable" as AdAudienceReading, rows, returned: reading.returned_count };
    return { reading: (rows.length ? "read" : "none") as AdAudienceReading, rows, returned: reading.returned_count };
  };
  const current = AD_AUDIENCE_DIMENSIONS.map((d) => ({ d, ...read(period, d.key) }));
  if (current.every((c) => c.reading === "unavailable")) return { state: planned.some((p) => samePeriod(p, period.start, period.end)) ? "unfetched" : "hint" };
  const panels = current.map(({ d, reading, rows, returned }): AdAudiencePanelView => {
    const before = read(comparison, d.key);
    const prev = new Map(before.rows.map((r) => [r.label.trim(), { impressions: r.impressions, clicks: r.clicks, ctr: ctrOf(r.impressions, r.clicks) }]));
    const ranked = rows
      .map((r) => ({ label: r.label, impressions: r.impressions, clicks: r.clicks, ctr: ctrOf(r.impressions, r.clicks), prev: prev.get(r.label.trim()) ?? null }))
      .sort(compareRows);
    return { dimension: d.key, title: d.title, reading, compared: before.reading, rows: ranked, returned };
  });
  return { state: "ready", panels, comparedAny: panels.some((p) => p.compared !== "unavailable") };
}
