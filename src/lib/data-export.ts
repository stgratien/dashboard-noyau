import type { SocialData } from "@/components/dashboard/common";
import { client } from "@/lib/client";
import { coverageDescription } from "@/lib/coverage-text";
import { PLATFORMS, type PlatformId } from "@/lib/dashboard-data";
import { changePercent, videosNote } from "@/lib/dashboard-format";
import { adAudiencePeriods, yesterdayISO, type Period } from "@/lib/dashboard-periods";
import { AD_AUDIENCE_PLATFORMS, adAudienceView } from "@/lib/ad-audience";
import { PAGE_AUDIENCE_PLATFORMS, pageAudienceView } from "@/lib/page-audience";
import { comparedPartialNote, partialNote } from "@/lib/partial-note";
import { comparisonGapNote } from "@/lib/comparison-note";
import { periodName } from "@/lib/report-tokens";
import { audienceBreakdowns, audiencePanels, formatOptions, paidAdStats, postStats, sortRows, type PostStats } from "@/lib/top-posts";
import { audienceSeries } from "@/lib/social-followers";
import { storiesTotals, storyComplete, storyDelta, storyNote, type StoryMetric } from "@/lib/social-stories";
import { realBlendedTotals, type RealTotals } from "@/lib/social-totals";

/**
 * Export des chiffres de l'onglet d'un réseau (Excel et JSON) : le modèle ci-dessous ne contient que des valeurs (nombres, textes, dates ISO), jamais de texte mis en forme
 * (« 1,4K ») pour que le destinataire puisse calculer ; un chiffre indisponible est vide (null), jamais zéro, et sa raison est dans la colonne « Remarque » ou dans la feuille « Notes ».
 * Les règles sont celles de l'écran (mêmes calculs, mêmes périodes, mêmes variations masquées quand la couverture diffère). Ce fichier ne lit aucune donnée : tout vient de `data`.
 */

/** Façon de lire une valeur : les nombres gardent leur type à l'export (Excel les calcule), `percent` est un nombre de pourcentage (22,3 pour 22,3 %) sur une décimale. */
export type CellKind = "text" | "integer" | "decimal" | "percent" | "euro" | "date" | "datetime";
export type ExportValue = string | number | null;
export type ExportColumn = { key: string; label: string; kind: CellKind; width: number };
/** Une ligne : ses valeurs par colonne ; `kinds` remplace la façon de lire une colonne pour cette ligne seulement (une colonne de chiffres clés mêle nombres, euros et pourcentages). */
export type ExportRow = { values: Record<string, ExportValue>; kinds?: Record<string, CellKind> };
/** `plain` : une liste de rubriques à lire, pas un tableau de données (le classeur n'y met ni filtre ni volet figé). */
export type ExportTable = { id: string; name: string; columns: ExportColumn[]; rows: ExportRow[]; plain?: true };
export type ExportMeta = {
  dashboard: string; network: PlatformId; networkName: string;
  period: { start: string; end: string; name: string }; comparison: { start: string; end: string; name: string };
  generatedAt: string;
};
export type DataExport = { meta: ExportMeta; tables: ExportTable[] };

export type DataExportInput = {
  data: SocialData; p: PlatformId; period: Period; comparison: Period; now?: Date;
};

const col = (key: string, label: string, kind: CellKind, width: number): ExportColumn => ({ key, label, kind, width });
const rowOf = (values: Record<string, ExportValue>, kinds?: Record<string, CellKind>): ExportRow => (kinds ? { values, kinds } : { values });
const finite = (n: number | null | undefined): number | null => (n == null || !Number.isFinite(n) ? null : n);
const networkName = (p: string) => PLATFORMS.find((x) => x.id === p)?.name ?? p;

/** Même couverture (listes `missing`) pour les deux périodes : sinon un changement de périmètre se lirait comme une performance (comparableDelta de l'écran). */
const sameScope = (t: RealTotals, o: RealTotals, key: string) => JSON.stringify(t.missing[key] ?? []) === JSON.stringify(o.missing[key] ?? []);

/** Heure de Paris d'un horodatage, « AAAA-MM-JJTHH:MM:SS » sans fuseau : c'est l'heure que lit le client (le fichier la dit dans l'en-tête de la colonne). */
const PARIS = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
export function parisLocal(ms: number): string | null {
  if (!Number.isFinite(ms)) return null;
  const parts = Object.fromEntries(PARIS.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}T${parts["hour"]}:${parts["minute"]}:${parts["second"]}`;
}

type Unit = "count" | "euro" | "percent";
const UNIT_LABEL: Record<Unit, string> = { count: "nombre", euro: "€", percent: "%" };
const UNIT_KIND: Record<Unit, CellKind> = { count: "integer", euro: "euro", percent: "percent" };

/** Remarque d'un chiffre : pourquoi il est partiel (comme la mention « partiel » de l'écran), indisponible, ou provisoire. */
function coverageRemark(t: RealTotals, o: RealTotals, key: string): string[] {
  const names = (platform: string) => networkName(platform);
  const own = (t.missing[key] ?? []).map((id) => coverageDescription(id, key, names, true));
  const remarks: string[] = [];
  if (own.length) remarks.push(`partiel : ${own.join(" ; ")}`);
  const theirs = o.missing[key] ?? [];
  if (theirs.length && !sameScope(t, o, key)) remarks.push(`période comparée partielle : ${theirs.map((id) => coverageDescription(id, key, names, true)).join(" ; ")}`);
  return remarks;
}

type Figure = {
  section: string; label: string; unit: Unit; key: keyof RealTotals & string;
  /** `plain` : variation de l'écran sans contrôle de couverture ; `scope` : seulement à couverture égale ; `points` : écart de points d'un taux ; `none` : aucune variation. */
  mode: "plain" | "scope" | "points" | "none";
  /** Faux seulement pour « Abonnés », dont la carte n'affiche aucune période comparée (son écart est la croissance dans la période) ; les autres cartes montrent « vs X » même sans variation. */
  previous?: boolean;
  remark?: (string | undefined)[];
};

/** Les chiffres clés de l'onglet d'un réseau, dans l'ordre et avec les libellés de l'écran. */
function figuresFor(p: PlatformId, t: RealTotals, period: Period): Figure[] {
  const tk = p === "tiktok";
  const noTikTokVideo = tk && t.videos === 0;
  const cohort = noTikTokVideo ? "none" : "scope";
  const noVideoViews = t.videos === 0 && t.videoViews === 0 ? "none" : "scope";
  const noTikTokNote = noTikTokVideo ? "Aucune vidéo publiée sur la période" : undefined;
  const clicksNote = p === "linkedin" ? "Publicité uniquement : LinkedIn ne distingue pas les clics sur liens en organique." : p === "instagram" ? "Publicité uniquement." : undefined;
  const newFollowersLate = p === "linkedin" && t.newFollowers == null && period.end >= yesterdayISO() ? "LinkedIn publie ces gains avec 2 jours de retard" : undefined;
  return [
    { section: "Activité", label: "Abonnés", unit: "count", key: "followers", mode: "none", previous: false, remark: [t.estimated ? "Valeur estimée" : undefined] },
    { section: "Activité", label: tk ? "Nouveaux abonnés (variation nette)" : "Nouveaux abonnés", unit: "count", key: "newFollowers", mode: t.newFollowersProvisional ? "none" : "plain", remark: [newFollowersLate, t.newFollowersProvisional ? "Provisoire : les derniers jours ne sont pas encore publiés par le réseau" : undefined] },
    { section: "Activité", label: tk ? "Vidéos publiées" : "Publications", unit: "count", key: "posts", mode: "plain" },
    ...(tk ? [] : [{ section: "Activité", label: "Vidéos publiées", unit: "count", key: "videos", mode: "plain" } as Figure]),
    { section: "Visibilité", label: "Impressions totales", unit: "count", key: "impressions", mode: cohort, remark: [noTikTokNote] },
    { section: "Visibilité", label: "Impressions moy. / post", unit: "count", key: "impressionsPerPost", mode: cohort },
    { section: "Visibilité", label: "Vues de vidéo", unit: "count", key: "videoViews", mode: noVideoViews, remark: [videosNote(t) || undefined] },
    { section: "Engagement", label: "Interactions totales", unit: "count", key: "interactions", mode: cohort, remark: [noTikTokNote] },
    { section: "Engagement", label: "Taux d'engagement (sur impressions)", unit: "percent", key: "engagementRate", mode: noTikTokVideo ? "none" : "points" },
    { section: "Engagement", label: "Clics sur les liens", unit: "count", key: "clicks", mode: "scope", remark: [clicksNote] },
    { section: "Média", label: "Budget dépensé", unit: "euro", key: "spend", mode: "plain" },
    { section: "Média", label: "Annonces diffusées", unit: "count", key: "adsDelivered", mode: "plain" },
    { section: "Coûts média", label: "CPM", unit: "euro", key: "cpm", mode: "plain" },
    { section: "Coûts média", label: "CPC", unit: "euro", key: "cpc", mode: "plain" },
    tk ? { section: "Coûts média", label: "CPV (coût par vue)", unit: "euro", key: "cpv", mode: "plain" } : { section: "Coûts média", label: "CPE (coût par engagement)", unit: "euro", key: "cpe", mode: "scope" },
  ];
}

const STORY_FIGURES: { label: string; key: StoryMetric; unit: Unit }[] = [
  { label: "Stories publiées", key: "count", unit: "count" }, { label: "Impressions des stories", key: "views", unit: "count" },
  { label: "Impressions moy. / story", key: "viewsPerStory", unit: "count" }, { label: "Interactions des stories", key: "interactions", unit: "count" },
];

function keyFiguresTable(input: DataExportInput, t: RealTotals, o: RealTotals): ExportTable {
  const { data, p, period, comparison } = input;
  const groups: ExportRow[][] = [];
  const sectionRows = new Map<string, ExportRow[]>();
  const rowsOf = (section: string) => {
    let rows = sectionRows.get(section);
    if (!rows) { rows = []; sectionRows.set(section, rows); groups.push(rows); }
    return rows;
  };
  for (const f of figuresFor(p, t, period)) {
    const current = finite(t[f.key] as number | null | undefined), previous = finite(o[f.key] as number | null | undefined);
    const shownPrevious = f.previous === false ? null : previous;
    let change: number | null = null, changeUnit = "";
    if (f.mode === "plain") change = finite(changePercent(current, previous)) ?? null;
    else if (f.mode === "scope") change = sameScope(t, o, f.key) ? finite(changePercent(current, previous)) : null;
    else if (f.mode === "points") change = sameScope(t, o, f.key) && current != null && previous != null ? current - previous : null;
    if (change != null) changeUnit = f.mode === "points" ? "points" : "%";
    let remarks = [...coverageRemark(t, o, f.key), ...(f.remark ?? [])].filter((x): x is string => !!x);
    // Comme l'écran : « partiel » qualifie un chiffre affiché, il disparaît à côté de « Donnée non disponible » (les autres mentions restent).
    if (current == null) remarks = [t.sourceUnavailable ? "Source indisponible" : "Donnée non disponible", ...remarks.filter((x) => !x.startsWith("partiel"))];
    const kind = UNIT_KIND[f.unit];
    const rows = rowsOf(f.section);
    rows.push(rowOf(
      { section: f.section, indicator: f.label, unit: UNIT_LABEL[f.unit], period: current, compared: shownPrevious, change, changeUnit, remark: remarks.join(" · ") || null },
      { period: kind, compared: kind, change: "percent" },
    ));
    // Évolution des abonnés dans la période affichée (la carte « Abonnés » ne suit pas la comparaison : son écart est cette croissance).
    if (f.key === "followers") {
      rows.push(rowOf({ section: f.section, indicator: "Évolution des abonnés sur la période", unit: "nombre", period: finite(t.followerGrowth), compared: null, change: null, changeUnit: "", remark: null }, { period: "integer" }));
      rows.push(rowOf({ section: f.section, indicator: "Évolution des abonnés sur la période (%)", unit: "%", period: finite(t.followerGrowthPercent), compared: null, change: null, changeUnit: "", remark: null }, { period: "percent" }));
    }
    // Stories (Instagram) : entre Engagement et Média, comme à l'écran.
    if (p === "instagram" && f.key === "clicks") {
      const st = storiesTotals(data.stories, data.storyPulls, period, { failed: data.storiesFailed });
      const so = storiesTotals(data.stories, data.storyPulls, comparison, { failed: data.storiesFailed });
      const stories = rowsOf("Stories");
      for (const sf of STORY_FIGURES) {
        const cur = finite(st[sf.key]), prev = finite(so[sf.key]);
        const delta = storyDelta(st, so, sf.key);
        const note = storyNote(st, sf.key, true);
        const notes = [note, !note && !storyComplete(st, sf.key) && cur != null ? "partiel" : undefined].filter((x): x is string => !!x);
        if (cur == null && notes.length === 0) notes.push("Donnée non disponible");
        stories.push(rowOf(
          { section: "Stories", indicator: sf.label, unit: UNIT_LABEL[sf.unit], period: cur, compared: prev, change: delta == null ? null : delta, changeUnit: delta == null ? "" : "%", remark: notes.join(" · ") || null },
          { period: UNIT_KIND[sf.unit], compared: UNIT_KIND[sf.unit], change: "percent" },
        ));
      }
    }
  }
  return {
    id: "keyFigures", name: "Chiffres clés",
    columns: [
      col("section", "Rubrique", "text", 16), col("indicator", "Indicateur", "text", 40), col("unit", "Unité", "text", 8),
      col("period", "Période", "decimal", 16), col("compared", "Période comparée", "decimal", 18), col("change", "Variation", "percent", 12),
      col("changeUnit", "Unité de la variation", "text", 14), col("remark", "Remarque", "text", 70),
    ],
    rows: groups.flat(),
  };
}

/** Publications de la période, publications plus anciennes promues pendant celle-ci et annonces sans publication : toutes les lignes du tableau « Performance des publications », pas seulement sa page affichée. */
function publicationRows(input: DataExportInput) {
  const { data, p, period } = input;
  const statGaps = new Set(data.unusableStatMonths);
  const inPeriod = (post: { published_at: string }) => post.published_at.slice(0, 10) >= period.start && post.published_at.slice(0, 10) <= period.end;
  const inPeriodPosts = data.posts.filter((x) => x.platform === p && inPeriod(x)).map((x) => postStats(x, statGaps));
  const promoted = data.promotedPosts.filter((x) => x.platform === p && !inPeriod(x)).map((x) => postStats(x, statGaps));
  const ads = data.paidAds.filter((a) => a.platform === p).map(paidAdStats);
  return { inPeriodPosts, all: sortRows([...inPeriodPosts, ...promoted, ...ads], "ts", "desc") };
}

function publicationsTable(p: PlatformId, rows: PostStats[]): ExportTable {
  const tk = p === "tiktok";
  return {
    id: "publications", name: "Publications",
    columns: [
      col("date", "Date de publication (heure de Paris ; 1re diffusion pour une publicité)", "datetime", 24), col("type", "Type", "text", 12), col("format", "Format", "text", 14), col("title", "Titre", "text", 60),
      col("link", "Lien", "text", 40), col("impressions", tk ? "Vues" : "Impressions", "integer", 14), col("likes", "J'aime", "integer", 10), col("comments", "Commentaires", "integer", 14),
      col("shares", "Partages", "integer", 10), col("interactions", "Interactions", "integer", 13), col("engagementRate", "Taux d'engagement (%)", "percent", 14),
      col("spend", "Budget (€)", "euro", 12), col("cpm", "CPM (€)", "euro", 11), col("cpe", "CPE (€)", "euro", 11),
    ],
    rows: rows.map((r) => rowOf({
      // Une publicité n'a que son premier jour de diffusion (comme à l'écran) : le jour seul, jamais une heure inventée.
      date: r.format === "Publicité" ? new Date(r.ts).toISOString().slice(0, 10) : parisLocal(r.ts), type: r.type, format: r.format, title: r.title, link: r.permalink || null,
      impressions: finite(r.impressions), likes: finite(r.likes), comments: finite(r.comments), shares: finite(r.shares), interactions: finite(r.interactions),
      engagementRate: finite(r.rate), spend: finite(r.spend), cpm: finite(r.cpm), cpe: finite(r.cpe),
    }, r.format === "Publicité" ? { date: "date" } : undefined)),
  };
}

function formatsTable(rows: PostStats[]): ExportTable {
  const unique = [...new Map(rows.map((r) => [r.id, r])).values()];
  const counts = formatOptions(unique).map((format) => ({ format, count: unique.filter((r) => r.format === format).length }));
  return {
    id: "formats", name: "Formats",
    columns: [col("format", "Format", "text", 20), col("count", "Publications", "integer", 14)],
    rows: counts.map((c) => rowOf({ format: c.format, count: c.count })),
  };
}

function interactionsTable(t: RealTotals): ExportTable {
  return {
    id: "interactions", name: "Interactions",
    columns: [col("interaction", "Interaction", "text", 22), col("volume", "Volume", "integer", 14), col("share", "Part (%)", "percent", 12)],
    // Comme l'écran : la part est celle du total des interactions, indisponible dès qu'une des trois est inconnue (jamais calculée sur un total partiel).
    rows: t.interactionBreakdown.map((x) => rowOf({ interaction: x.name, volume: finite(x.v), share: x.v == null || !t.interactions ? null : (x.v / t.interactions) * 100 })),
  };
}

function followersTable(input: DataExportInput): ExportTable {
  const points = audienceSeries(input.data.days, input.p, input.period);
  return {
    id: "followersEvolution", name: "Évolution des abonnés",
    columns: [col("date", "Date", "date", 14), col("followers", "Abonnés", "integer", 14), col("estimated", "Valeur estimée", "text", 16)],
    rows: points.map((x) => rowOf({ date: x.date, followers: finite(x.followers), estimated: x.estimated ? "oui" : x.followers == null ? null : "non" })),
  };
}

function audienceTable(input: DataExportInput): ExportTable {
  const panels = audiencePanels(input.p, audienceBreakdowns(input.data.audience, input.p));
  const rows: ExportRow[] = [];
  for (const panel of panels) {
    // Un panneau sans valeur dit « Donnée non disponible » à l'écran ; ici aussi, pour ne pas le confondre avec un panneau non exporté.
    if (panel.items.length === 0) rows.push(rowOf({ breakdown: panel.title, label: "Donnée non disponible", value: null, share: null }));
    for (const item of panel.items) {
      const value = finite(Number(item.value));
      rows.push(rowOf({ breakdown: panel.title, label: item.label, value, share: finite(Number(item.percent)) }, { value: value != null && Number.isInteger(value) ? "integer" : "decimal" }));
    }
  }
  return {
    id: "audience", name: "Audience",
    columns: [col("breakdown", "Découpage", "text", 28), col("label", "Libellé", "text", 36), col("value", "Valeur (nombre, ou % selon la source)", "decimal", 20), col("share", "Part (%)", "percent", 12)],
    rows,
  };
}

function sponsoredAudienceTable(input: DataExportInput): ExportTable | null {
  const { data, p, period, comparison } = input;
  if (!client.features.adAudience || !AD_AUDIENCE_PLATFORMS.includes(p)) return null;
  const view = adAudienceView(data.adAudience, p, period, comparison, adAudiencePeriods());
  if (view.state !== "ready") return null;
  const rows: ExportRow[] = [];
  for (const panel of view.panels) {
    const comparedNote = panel.compared === "unavailable" ? "Période comparée non relevée" : null;
    // Comme l'écran : un découpage non relevé ou sans diffusion le dit, il n'est jamais absent sans explication.
    if (panel.reading !== "read") {
      rows.push(rowOf({ breakdown: panel.title, label: panel.reading === "none" ? "Aucune diffusion sur la période" : "Donnée non disponible", remark: comparedNote }));
      continue;
    }
    for (const r of panel.rows) {
      rows.push(rowOf({
        breakdown: panel.title, label: r.label, impressions: finite(r.impressions), clicks: finite(r.clicks), ctr: finite(r.ctr),
        comparedImpressions: finite(r.prev?.impressions), comparedClicks: finite(r.prev?.clicks), comparedCtr: finite(r.prev?.ctr), remark: comparedNote,
      }));
    }
  }
  return {
    id: "sponsoredAudience", name: "Audience sponsorisée",
    columns: [
      col("breakdown", "Découpage", "text", 22), col("label", "Libellé", "text", 40), col("impressions", "Impressions", "integer", 14), col("clicks", "Clics", "integer", 10),
      col("ctr", "Taux de clic (%)", "percent", 14), col("comparedImpressions", "Impressions (période comparée)", "integer", 18), col("comparedClicks", "Clics (période comparée)", "integer", 16),
      col("comparedCtr", "Taux de clic (période comparée, %)", "percent", 20), col("remark", "Remarque", "text", 30),
    ],
    rows,
  };
}

function companySizesTable(input: DataExportInput): ExportTable | null {
  const { data, p, period, comparison } = input;
  if (!client.features.pageAudience || !PAGE_AUDIENCE_PLATFORMS.includes(p)) return null;
  const view = pageAudienceView(data.pageAudience, period, comparison, adAudiencePeriods(), p);
  if (view.state !== "ready") return null;
  const rows: ExportRow[] = [];
  for (const panel of view.panels) {
    for (const [range, column] of [[period, panel.current], [comparison, panel.compared]] as const) {
      const base = { measure: panel.metric, period: periodName(range), start: range.start, end: range.end };
      if (column.reading !== "read") {
        rows.push(rowOf({ ...base, size: "Donnée non disponible", value: null, share: null }));
        continue;
      }
      for (const r of column.rows) rows.push(rowOf({ ...base, size: r.label, value: finite(r.value), share: finite(r.share) }));
    }
  }
  return {
    id: "companySizes", name: "Tailles d'entreprise",
    columns: [
      col("measure", "Mesure", "text", 12), col("period", "Période", "text", 22), col("start", "Début", "date", 12), col("end", "Fin", "date", 12),
      col("size", "Taille d'entreprise", "text", 26), col("value", "Valeur", "integer", 12), col("share", "Part (%)", "percent", 10),
    ],
    rows,
  };
}

/** Phrases grises de l'écran (chiffres partiels, comparaison vide) : une ligne par phrase, pour qu'un « partiel » ne se lise jamais sans sa raison. */
function notesFor(input: DataExportInput, t: RealTotals, o: RealTotals): string[] {
  const { data, p, period, comparison } = input;
  const notes = [partialNote(p, data.days, t, period), comparisonGapNote(p, data.days, t, o, comparison), comparedPartialNote(p, data.days, t, o, comparison)];
  return notes.filter((n): n is string => typeof n === "string" && n !== "");
}

export const exportPeriodLabel = (period: Period) => periodName(period);

/** Tout ce que l'export contient pour l'onglet d'un réseau, à la période et à la comparaison choisies. */
export function buildDataExport(input: DataExportInput): DataExport {
  const { data, p, period, comparison } = input;
  const t = realBlendedTotals(p, data.days, data.posts, period, data.statuses, data.ads, data.adCoverage);
  const o = realBlendedTotals(p, data.days, data.posts, comparison, data.statuses, data.ads, data.adCoverage);
  const generatedAt = (input.now ?? new Date()).toISOString();
  const periodLabel = exportPeriodLabel(period), comparisonLabel = exportPeriodLabel(comparison);
  const meta: ExportMeta = {
    dashboard: client.brand.headline, network: p, networkName: networkName(p),
    period: { start: period.start, end: period.end, name: periodLabel }, comparison: { start: comparison.start, end: comparison.end, name: comparisonLabel },
    generatedAt,
  };
  const publications = publicationRows(input);
  const notes = notesFor(input, t, o);
  const summary: ExportTable = {
    id: "summary", name: "Résumé", plain: true,
    columns: [col("item", "Rubrique", "text", 28), col("value", "Valeur", "text", 80)],
    rows: [
      rowOf({ item: "Tableau de bord", value: meta.dashboard }),
      rowOf({ item: "Réseau", value: meta.networkName }),
      rowOf({ item: "Période", value: `${periodLabel} (${period.start} au ${period.end})` }),
      rowOf({ item: "Période comparée", value: `${comparisonLabel} (${comparison.start} au ${comparison.end})` }),
      rowOf({ item: "Export généré le (heure de Paris)", value: parisLocal(Date.parse(generatedAt)) }),
      ...notes.map((n, i) => rowOf({ item: i === 0 ? "Chiffres partiels et comparaison" : null, value: n })),
      rowOf({ item: "Lecture", value: "Les chiffres sont des valeurs numériques. Une cellule vide est un chiffre non disponible, jamais zéro ; sa raison est dans la colonne « Remarque »." }),
    ],
  };
  const tables: (ExportTable | null)[] = [
    summary, keyFiguresTable(input, t, o), interactionsTable(t), formatsTable(publications.inPeriodPosts), publicationsTable(p, publications.all),
    followersTable(input), audienceTable(input), sponsoredAudienceTable(input), companySizesTable(input),
  ];
  return { meta, tables: tables.filter((x): x is ExportTable => x !== null) };
}

/** JSON de l'export : les métadonnées, puis chaque feuille avec ses colonnes (clé, libellé, type) et ses lignes en objets (clé → valeur). */
export function exportToJson(model: DataExport): string {
  const sheets = Object.fromEntries(model.tables.map((table) => [table.id, {
    name: table.name,
    columns: table.columns.map(({ key, label, kind }) => ({ key, label, type: kind })),
    rows: table.rows.map((r) => r.values),
  }]));
  return `${JSON.stringify({ meta: model.meta, sheets }, null, 2)}\n`;
}

const ascii = (s: string) => s.replace(/œ/gi, "oe").replace(/æ/gi, "ae").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/** Nom du fichier : « <tableau>-<réseau>-<période>.<extension> », sans accent ni espace, au plus 80 caractères avant l'extension ; une partie sans lettre ni chiffre devient « export ». */
export function exportFileName(model: DataExport, extension: "xlsx" | "json") {
  const parts = [client.brand.shortName, model.meta.networkName, model.meta.period.name].map((x) => ascii(x).slice(0, 40).replace(/-+$/g, "") || "export");
  return `${parts.join("-").slice(0, 80).replace(/-+$/g, "")}.${extension}`;
}
