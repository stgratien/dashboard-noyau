import type { GoogleData, SocialData } from "@/components/dashboard/common";
import { client } from "@/lib/client";
import { PLATFORMS } from "@/lib/dashboard-data";
import { videosNote } from "@/lib/dashboard-format";
import type { Period } from "@/lib/dashboard-periods";
import { KEY_FIGURE_COLUMNS, col, exportPeriodLabel, figureRow, followerGrowthRows, keyFiguresTable, networkName, parisLocal, rowOf, type DataExport, type ExportMeta, type ExportRow, type ExportTable, type Figure } from "@/lib/data-export";
import { globalTotals, networkTotals } from "@/lib/global-totals";
import { comparedGlobalNote, globalPartialNote } from "@/lib/partial-note";
import type { RealTotals } from "@/lib/social-totals";
import type { YoutubeData } from "@/lib/youtube";

/**
 * Export de l'onglet Global (Excel et JSON) : le total « Tous réseaux » comme l'affichent ses cartes, puis les chiffres clés de chaque réseau qui l'alimentent. Mêmes règles que l'export d'un
 * réseau (src/lib/data-export.ts) : des valeurs, jamais de texte mis en forme ; un chiffre indisponible est vide avec sa raison en « Remarque » ; une variation est masquée quand les deux
 * périodes ne couvrent pas les mêmes réseaux et sources. Les totaux viennent de src/lib/global-totals.ts, les mêmes objets que l'onglet : rien n'est recalculé ici.
 */

export type GlobalExportInput = {
  data: SocialData;
  /** Ce que reçoit l'onglet Global : les lectures Google Ads et YouTube (YouTube entre dans le total une fois connecté). */
  google: GoogleData | undefined;
  youtube: YoutubeData | undefined;
  youtubeUnavailable: boolean;
  period: Period;
  comparison: Period;
  now?: Date;
};

const SECTION = "Tous réseaux";

/** Les cartes de l'onglet Global, dans l'ordre et avec les libellés de l'écran (TotalCards). Une variation n'existe qu'à couverture égale ; « Abonnés » ne suit pas la comparaison. */
function globalFigures(t: RealTotals): Figure[] {
  const videosOutside = (t.missing["videos"] ?? []).map(networkName);
  return [
    { section: SECTION, label: "Abonnés", unit: "count", key: "followers", mode: "none", previous: false, remark: [t.estimated ? "Valeur estimée" : undefined] },
    { section: SECTION, label: "Posts publiés", unit: "count", key: "posts", mode: "scope" },
    { section: SECTION, label: "Vidéos publiées", unit: "count", key: "videos", mode: "scope" },
    { section: SECTION, label: "Annonces diffusées", unit: "count", key: "adsDelivered", mode: "scope" },
    { section: SECTION, label: "Impressions", unit: "count", key: "impressions", mode: "scope" },
    { section: SECTION, label: "Impressions moy. / post", unit: "count", key: "impressionsPerPost", mode: "scope" },
    { section: SECTION, label: "Vues de vidéo", unit: "count", key: "videoViews", mode: t.videos === 0 && t.videoViews === 0 ? "none" : "scope", remark: [videosNote(t, videosOutside) || undefined] },
    { section: SECTION, label: "Interactions", unit: "count", key: "interactions", mode: "scope" },
    { section: SECTION, label: "Clics sur les liens", unit: "count", key: "clicks", mode: "scope" },
    { section: SECTION, label: "Taux d'engagement", unit: "percent", key: "engagementRate", mode: "points" },
    { section: SECTION, label: "Budget", unit: "euro", key: "spend", mode: "scope" },
    { section: SECTION, label: "CPE moyen", unit: "euro", key: "cpe", mode: "scope" },
    { section: SECTION, label: "CPM moyen", unit: "euro", key: "cpm", mode: "scope" },
  ];
}

function keyFiguresOfGlobal(t: RealTotals, o: RealTotals): ExportTable {
  const rows: ExportRow[] = [];
  for (const f of globalFigures(t)) {
    rows.push(figureRow(f, t, o));
    // La carte « Abonnés » dit la croissance dans la période affichée sous sa valeur : deux lignes, comme dans l'export d'un réseau.
    if (f.key === "followers") rows.push(...followerGrowthRows(f.section, t));
  }
  return { id: "keyFigures", name: "Chiffres clés", columns: KEY_FIGURE_COLUMNS, rows };
}

/** Les chiffres clés de chaque réseau, les mêmes que sur son onglet (même fonction que l'export du réseau) : de quoi retrouver le total et le détail dans un seul tableau. */
function networksTable(input: GlobalExportInput, rows: ReturnType<typeof networkTotals>): ExportTable {
  const { data, period, comparison } = input;
  const out: ExportRow[] = [];
  for (const row of rows) {
    for (const r of keyFiguresTable({ data, p: row.p, period, comparison }, row.current, row.previous).rows) {
      out.push({ ...r, values: { network: networkName(row.p), ...r.values } });
    }
  }
  return { id: "networks", name: "Par réseau", columns: [col("network", "Réseau", "text", 14), ...KEY_FIGURE_COLUMNS], rows: out };
}

/** Phrases grises de l'écran (chiffres partiels sur la période affichée et sur la comparée) : un titre, puis une ligne par réseau, pour qu'un « partiel » ne se lise jamais sans sa raison. */
function notesRows(blocks: ({ title: string; items: string[] } | null)[]): ExportRow[] {
  return blocks.flatMap((block) => (block ? block.items.map((item, i) => rowOf({ item: i === 0 ? block.title : null, value: item })) : []));
}

/** Tout ce que l'export contient pour l'onglet Global, à la période et à la comparaison choisies. */
export function buildGlobalExport(input: GlobalExportInput): DataExport {
  const { data, google, youtube, youtubeUnavailable, period, comparison } = input;
  const rows = networkTotals(data, period, comparison);
  const { t, o } = globalTotals(rows, google, youtube, youtubeUnavailable, period, comparison);
  const generatedAt = (input.now ?? new Date()).toISOString();
  const periodLabel = exportPeriodLabel(period), comparisonLabel = exportPeriodLabel(comparison);
  const meta: ExportMeta = {
    dashboard: client.brand.headline, network: "overview", networkName: "Global",
    period: { start: period.start, end: period.end, name: periodLabel }, comparison: { start: comparison.start, end: comparison.end, name: comparisonLabel },
    generatedAt,
  };
  const partial = globalPartialNote(data.days, rows.map((row) => row.current), t, period);
  const comparedPartial = comparedGlobalNote(data.days, rows.map((row) => row.previous), t, o, comparison);
  const networks = PLATFORMS.map((x) => x.name).join(", ");
  const summary: ExportTable = {
    id: "summary", name: "Résumé", plain: true,
    columns: [col("item", "Rubrique", "text", 28), col("value", "Valeur", "text", 80)],
    rows: [
      rowOf({ item: "Tableau de bord", value: meta.dashboard }),
      rowOf({ item: "Onglet", value: "Global (tous réseaux)" }),
      rowOf({ item: "Réseaux additionnés", value: youtube?.lastSuccess ? `${networks} et YouTube (abonnés, publications, vues de vidéo et interactions seulement)` : networks }),
      rowOf({ item: "Période", value: `${periodLabel} (${period.start} au ${period.end})` }),
      rowOf({ item: "Période comparée", value: `${comparisonLabel} (${comparison.start} au ${comparison.end})` }),
      rowOf({ item: "Export généré le (heure de Paris)", value: parisLocal(Date.parse(generatedAt)) }),
      ...notesRows([partial, comparedPartial]),
      rowOf({ item: "Lecture", value: "Les chiffres sont des valeurs numériques. Une cellule vide est un chiffre non disponible, jamais zéro ; sa raison est dans la colonne « Remarque ». La feuille « Par réseau » donne les chiffres clés de chaque réseau, ceux de son onglet." }),
    ],
  };
  return { meta, tables: [summary, keyFiguresOfGlobal(t, o), networksTable(input, rows)] };
}
