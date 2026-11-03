import { PLATFORMS, type PlatformId } from "./dashboard-data";
import { PLATFORM_SOURCES } from "../core/client-config";
import { comparisonGapNote, organicHistoryStart } from "./comparison-note";
import { videoLack } from "./coverage-text";
import { plural } from "./dashboard-format";
import { calendarDate, type Period } from "./dashboard-periods";
import { periodName } from "./report-tokens";
import type { RealTotals, SocialDay } from "./social-totals";

/**
 * Cartes d'un onglet réseau qui portent la mention « partiel » (coverageDetails dans platform-view.tsx). Sur TikTok, la carte CPE est remplacée par le CPV,
 * qui n'a pas de couverture : la clé « cpe » y est écartée (PlatformId « tiktok »).
 */
export const NETWORK_PARTIAL_KEYS = [
  "impressions",
  "impressionsPerPost",
  "videoViews",
  "interactions",
  "engagementRate",
  "clicks",
  "cpe",
] as const;
/** Cartes de Global qui portent la mention « partiel » : toutes passent par coverageDetails (TotalCards dans overview.tsx). */
export const GLOBAL_PARTIAL_KEYS = [
  "followers",
  "posts",
  "videos",
  "adsDelivered",
  "impressions",
  "impressionsPerPost",
  "videoViews",
  "interactions",
  "clicks",
  "engagementRate",
  "spend",
  "cpe",
  "cpm",
] as const;
/**
 * Cartes d'un onglet réseau dont la valeur comparée (« vs … ») passe par prevShown (common.tsx). Les réseaux ne tiennent une liste de couverture que pour les chiffres de
 * NETWORK_PARTIAL_KEYS ; les autres (publications, vidéos, budget, annonces, CPM, CPC, CPV) sont listés pour qu'une liste de couverture qui leur serait un jour ajoutée soit lue.
 * Le CPE n'existe pas sur TikTok (CPV à la place) et le CPV pas ailleurs.
 */
export const NETWORK_COMPARED_KEYS = [
  "posts",
  "videos",
  "impressions",
  "impressionsPerPost",
  "videoViews",
  "interactions",
  "engagementRate",
  "clicks",
  "spend",
  "adsDelivered",
  "cpm",
  "cpc",
  "cpv",
  "cpe",
] as const;
/** Cartes de Global dont la valeur comparée passe par prevShown (TotalCards dans overview.tsx) : toutes sauf les abonnés, qui ne se comparent pas. */
export const GLOBAL_COMPARED_KEYS = [
  "posts",
  "videos",
  "adsDelivered",
  "impressions",
  "impressionsPerPost",
  "videoViews",
  "interactions",
  "clicks",
  "engagementRate",
  "spend",
  "cpe",
  "cpm",
] as const;

/** Le bloc d'une note à plusieurs lignes (Global : un titre, puis une ligne par réseau). */
export type NoteBlock = { title: string; items: string[] };

type Kind =
  | "account" // organique du compte (impressions, interactions...)
  | "clicks" // clics organiques sur les liens
  | "videoViews"
  | "videoViewsNone" // le réseau n'a aucune vue de vidéo pour la période (identifiant nu, Global)
  | "publications"
  | "videoCount" // nombre de vidéos indéterminé alors que le nombre de publications est connu
  | "paid"
  | "ads"
  | "export"
  | "videos"
  | "cpeSkip"
  | "followers"
  | "youtube"
  | "other";
/** Une raison de couverture lue dans un identifiant : le réseau, la carte (clé de RealTotals.missing) qui la porte, et ce que l'identifiant ajoute (dernier jour de l'export, nombre de vidéos). */
type Entry = { platform: string; key: string; kind: Kind; lastDay?: string; count?: number };

/** Ordre des phrases d'un réseau : l'organique d'abord, les détails de publications à la fin. */
const ORDER: Kind[] = [
  "account",
  "clicks",
  "videoViews",
  "videoViewsNone",
  "publications",
  "videoCount",
  "paid",
  "ads",
  "export",
  "videos",
  "cpeSkip",
  "other",
  "youtube",
];

/** Cartes que touche la réaction d'un jour hors de l'historique importé (j'aime et commentaires : interactions, taux d'engagement, CPE). */
const CARD_NAMES: Record<string, string> = {
  interactions: "Interactions",
  engagementRate: "Taux d’engagement",
  cpe: "CPE",
};

const networkName = (platform: string) =>
  PLATFORMS.find((x) => x.id === platform)?.name ?? platform;
const frDate = (iso: string) => calendarDate(iso).toLocaleDateString("fr-FR");
const joinNames = (names: string[]) =>
  names.length < 2
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`;

/** Premier jour, parmi les lignes d'une source d'un réseau, qui satisfait le test (null sans aucun). */
function firstDay(
  days: readonly SocialDay[],
  p: string,
  source: string,
  usable: (d: SocialDay) => boolean,
) {
  let first: string | null = null;
  for (const d of days)
    if (d.platform === p && d.source === source && usable(d) && (first === null || d.day < first))
      first = d.day;
  return first;
}

/**
 * Lecture d'un identifiant de couverture (RealTotals.missing[key]) pour la note « Chiffres partiels ». Les identifiants « <réseau>:organic », « :paid », « :export:<jour> » et « :videos:<n> »
 * sont ceux de realBlendedTotals ; l'identifiant nu (le réseau seul) n'existe que dans Global : un réseau dont la carte n'a aucune valeur et qu'aucun détail n'explique.
 * « organic » ne dit pas la même chose selon la carte : les clics organiques sur les liens et les vues de vidéo sont des séries à part de l'organique du compte.
 * `rows` : les totaux de chaque réseau de la période lue (Global), pour les identifiants nus.
 */
function classify(key: string, id: string, rows: readonly RealTotals[]): Entry {
  const [platform = "", source, extra = ""] = id.split(":");
  const entry = (kind: Kind, more: Partial<Entry> = {}): Entry => ({
    platform,
    key,
    kind,
    ...more,
  });
  // « YouTube » est ajouté à plusieurs cartes pour des raisons différentes (pas de donnée, abonnés absents, interactions incomplètes, lecture en cours ou en échec) : rien de plus précis n'est affirmé.
  if (platform === "YouTube") return entry("youtube");
  if (source === "organic")
    return entry(key === "clicks" ? "clicks" : key === "videoViews" ? "videoViews" : "account");
  if (source === "paid") return entry("paid");
  if (source === "export") return entry("export", { lastDay: extra });
  if (source === "videos") return entry("videos", { count: Number(extra) });
  if (source) return entry("other");
  const row = rows.find((t) => t.platform === platform);
  if (key === "followers") return entry("followers");
  // « Vidéos publiées » est vide quand le nombre de publications l'est, mais aussi quand le format de certaines publications est inconnu : le nombre de publications, lui, est alors affiché.
  if (key === "videos") return entry(row && row.posts != null ? "videoCount" : "publications");
  if (key === "posts" || key === "impressionsPerPost") return entry("publications");
  if (key === "adsDelivered") return entry("ads");
  if (key === "videoViews") return entry("videoViewsNone");
  if (key === "cpe") {
    // Global : le budget d'un TikTok sans interaction (aucune vidéo publiée) est écarté du CPE ; sinon c'est le budget qui manque.
    return entry(
      row?.spend != null && row.interactions === 0 && platform === "tiktok" ? "cpeSkip" : "paid",
    );
  }
  return entry(key === "spend" || key === "clicks" || key === "cpm" ? "paid" : "other");
}

/** Une carte montre un chiffre (« Donnée non disponible » : la mention « partiel » n'y est pas écrite, Kpi dans common.tsx, donc rien à expliquer ni à comparer). */
const hasValue = (t: RealTotals, key: string) => {
  const value = (t as unknown as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value);
};
const sameList = (a: readonly string[] | undefined, b: readonly string[] | undefined) =>
  JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
/** Les cartes d'un onglet réseau parmi `keys` : le CPE n'existe pas sur TikTok (CPV à la place) et le CPV pas ailleurs. */
export const networkKeys = (p: string, keys: readonly string[]) =>
  keys.filter((k) => (p === "tiktok" ? k !== "cpe" : k !== "cpv"));

/** Cartes de la période affichée que l'écran montre avec la mention « partiel » : une liste de couverture non vide ET une valeur affichée. */
export function partialKeys(t: RealTotals, keys: readonly string[]): string[] {
  return keys.filter((key) => hasValue(t, key) && (t.missing[key]?.length ?? 0) > 0);
}
/**
 * Cartes dont la valeur comparée (« vs … ») est marquée « (partiel) » : la règle de prevShown (common.tsx), une liste de couverture de la période comparée non vide ET différente de celle
 * de la période affichée (deux périodes qui ont les mêmes trous se comparent sans marque), et une valeur comparée affichée.
 */
export function partialComparedKeys(
  t: RealTotals,
  o: RealTotals,
  keys: readonly string[],
): string[] {
  return keys.filter(
    (key) =>
      hasValue(o, key) &&
      (o.missing[key]?.length ?? 0) > 0 &&
      !sameList(o.missing[key], t.missing[key]),
  );
}
/** Les raisons (une par identifiant de couverture) des cartes données, lues dans les listes de couverture de `source`. */
const entriesOf = (source: RealTotals, keys: readonly string[], rows: readonly RealTotals[]) =>
  keys.flatMap((key) => (source.missing[key] ?? []).map((id) => classify(key, id, rows)));

/** Ce que les phrases d'un réseau disent : la période (ses dates), la lecture (affichée ou comparée), et s'il faut taire l'organique du compte (déjà dit ailleurs). */
type Scope = {
  days: readonly SocialDay[];
  period: Period;
  where: "displayed" | "compared";
  /** Période comparée dont comparisonGapNote dit déjà que l'organique du compte manque : la phrase de l'organique (et des clics qui s'arrêtent le même jour) n'est pas répétée. */
  skipAccount?: boolean;
};

/** Phrases d'un réseau, sans doublon, dans un ordre stable. Les dates se lisent dans les jours chargés (premier jour utilisable de chaque source). */
function clauses(platform: string, entries: Entry[], scope: Scope): string[] {
  const { days, period, where, skipAccount } = scope;
  const mine = entries.filter((e) => e.platform === platform);
  const has = (kind: Kind) => mine.some((e) => e.kind === kind);
  const p = platform as PlatformId;
  // « sur la période » (période affichée) ; la période comparée a son titre, la phrase n'y revient pas.
  const on = where === "displayed" ? " sur la période" : "";
  // Début de la source : « ne remonte pas avant le … » quand la période commence avant, sinon la source a des trous (« est incomplet »).
  const accountStart = () => (p === "tiktok" ? null : organicHistoryStart(days, p));
  const clicksStart = () =>
    firstDay(days, p, PLATFORM_SOURCES[p]?.[0] ?? "", (d) => d.metrics["linkClicks"] != null);
  const paidStart = () =>
    firstDay(days, p, PLATFORM_SOURCES[p]?.[1] ?? "", (d) => d.metrics["spend"] != null);
  const before = (start: string | null) => (start && period.start < start ? start : null);
  const out: { rank: number; text: string }[] = [];
  const add = (kind: Kind, text: string) => out.push({ rank: ORDER.indexOf(kind), text });
  // L'organique du compte reste « présent » même quand sa phrase est tue : les vues de vidéo en suivent la cause.
  const account = has("account"),
    clicks = has("clicks");
  const addAccount = (text: string) => {
    if (!skipAccount) add("account", text);
  };
  const accountBefore = account && p !== "tiktok" ? before(accountStart()) : null;
  const clicksBefore = clicks ? before(clicksStart()) : null;
  if (account && p === "tiktok") addAccount(`l’organique des publications est incomplet${on}`);
  // L'organique du compte et les clics sur les liens qui s'arrêtent à la même date ne font qu'une phrase.
  if (account && p !== "tiktok" && clicks && accountBefore === clicksBefore)
    addAccount(
      accountBefore
        ? `l’organique du compte et les clics sur les liens ne remontent pas avant le ${frDate(accountBefore)}`
        : `l’organique du compte et les clics sur les liens sont incomplets${on}`,
    );
  else {
    if (account && p !== "tiktok")
      addAccount(
        accountBefore
          ? `l’organique du compte ne remonte pas avant le ${frDate(accountBefore)}`
          : `l’organique du compte est incomplet${on}`,
      );
    if (clicks)
      add(
        "clicks",
        clicksBefore
          ? `les clics organiques sur les liens ne remontent pas avant le ${frDate(clicksBefore)}`
          : `les clics organiques sur les liens sont incomplets${on}`,
      );
  }
  // Les vues de vidéo suivent l'organique du compte quand celui-ci manque déjà (même cause) ; sinon elles ont leurs propres trous (une source qui n'en a pas).
  if (has("videoViews") && !account) add("videoViews", `les vues de vidéo sont incomplètes${on}`);
  if (has("videoViewsNone") && !account) add("videoViewsNone", `les vues de vidéo ne sont pas relevées${on}`);
  if (has("publications")) add("publications", `le nombre de publications n’est pas relevé${on}`);
  if (has("videoCount"))
    add(
      "videoCount",
      "le nombre de vidéos n’est pas déterminé (format de certaines publications inconnu)",
    );
  if (has("paid")) {
    const start = before(paidStart());
    add(
      "paid",
      start ? `le payant ne remonte pas avant le ${frDate(start)}` : `le payant est incomplet${on}`,
    );
  }
  if (has("ads")) add("ads", `le relevé des annonces est incomplet${on}`);
  // Réactions d'un historique importé arrêté avant la fin de la période : les jours suivants viennent d'une autre source, moins complète (le connecteur ne donne pas les réactions des vidéos
  // ni celles que les annonces gagnent après coup). On cite les cartes touchées : ce sont celles qui lisent les j'aime et les commentaires.
  const exportEntries = mine.filter((e) => e.kind === "export");
  if (exportEntries.length) {
    const lastDay = exportEntries
      .map((e) => e.lastDay ?? "")
      .find((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    const names = Object.keys(CARD_NAMES).filter((key) => exportEntries.some((e) => e.key === key));
    add(
      "export",
      `les j’aime et commentaires ${lastDay && period.end > lastDay ? `après le ${frDate(lastDay)}` : "de certains jours"} viennent d’une autre source, moins complète${
        names.length ? ` (${joinNames(names.map((key) => CARD_NAMES[key] ?? key))})` : ""
      }`,
    );
  }
  for (const e of mine)
    if (e.kind === "videos") {
      const n = e.count ?? 0;
      add("videos", `${n} ${plural(n, "vidéo")} ${videoLack(e.key)}`);
    }
  if (has("cpeSkip")) add("cpeSkip", `son budget est écarté du CPE faute de vidéo publiée${on}`);
  if (has("other")) add("other", `des chiffres sont incomplets${on}`);
  if (has("youtube")) add("youtube", `chiffres incomplets${on}`);
  return [...new Set(out.sort((a, b) => a.rank - b.rank).map((x) => x.text))];
}

/** « Chiffres partiels : a ; b. » (null sans phrase). */
const sentence = (prefix: string, list: string[]) =>
  list.length ? `${prefix} ${list.join(" ; ")}.` : null;

/** Une ligne par réseau, dans l'ordre des onglets : « Facebook : a ; b. » (les abonnés n'ont pas de phrase de réseau : clauses() ignore leurs entrées). */
function networkLines(entries: Entry[], rows: readonly RealTotals[], scope: Scope): string[] {
  const platforms = [
    ...new Set([...rows.map((t) => t.platform), ...entries.map((e) => e.platform)]),
  ];
  return platforms.flatMap((platform) => {
    const line = sentence(`${networkName(platform)} :`, clauses(platform, entries, scope));
    return line ? [line] : [];
  });
}

/** Libellé de la période comparée dans la phrase : le nom que le rapport lui donne (« T3 2024 », une édition du client, un mois, une année), sinon ses dates en toutes lettres. */
const comparedTitle = (comparison: Period) =>
  `Période comparée (${periodName(comparison)}) partielle :`;

/**
 * Pourquoi des cartes d'un onglet réseau portent la mention « partiel » (période AFFICHÉE ; la période comparée a ses phrases, comparedPartialNote et comparisonGapNote). Une seule ligne,
 * sans doublon : « Chiffres partiels : l’organique du compte ne remonte pas avant le … ; … ». Null quand aucune carte montrée n'est partielle (les cartes « Donnée non disponible »
 * ne portent pas la mention).
 */
export function partialNote(
  p: PlatformId,
  days: readonly SocialDay[],
  t: RealTotals,
  period: Period,
): string | null {
  const keys = partialKeys(t, networkKeys(p, NETWORK_PARTIAL_KEYS));
  const entries = entriesOf(t, keys, [t]);
  return sentence("Chiffres partiels :", clauses(p, entries, { days, period, where: "displayed" }));
}

/**
 * Pourquoi la valeur comparée de cartes d'un onglet réseau porte « (partiel) » : la période comparée ne couvre pas les mêmes sources que la période affichée (prevShown, common.tsx).
 * « Période comparée (T3 2024) partielle : l’organique du compte ne remonte pas avant le … ». Quand comparisonGapNote dit déjà que l'organique du compte manque sur la période comparée
 * (la période affichée en a), cette phrase-là n'est pas répétée : il ne reste ici que ce qu'elle ne dit pas (clics à une autre date, payant, vidéos...). Null sans carte à expliquer.
 */
export function comparedPartialNote(
  p: PlatformId,
  days: readonly SocialDay[],
  t: RealTotals,
  o: RealTotals,
  comparison: Period,
): string | null {
  const keys = partialComparedKeys(t, o, networkKeys(p, NETWORK_COMPARED_KEYS));
  const skipAccount = comparisonGapNote(p, days, t, o, comparison) !== null;
  const entries = entriesOf(o, keys, [o]);
  return sentence(
    comparedTitle(comparison),
    clauses(p, entries, { days, period: comparison, where: "compared", skipAccount }),
  );
}

/**
 * Pourquoi les cartes de Global portent la mention « partiel » (période AFFICHÉE) : une ligne par réseau (ses sources manquantes), puis les abonnés, que les cartes lisent à la fin de la période.
 * `rows` : les totaux de chaque réseau (ordre des onglets), `total` : le total affiché (YouTube compris).
 */
export function globalPartialNote(
  days: readonly SocialDay[],
  rows: readonly RealTotals[],
  total: RealTotals,
  period: Period,
): NoteBlock | null {
  const entries = entriesOf(total, partialKeys(total, GLOBAL_PARTIAL_KEYS), rows);
  const items = networkLines(entries, rows, { days, period, where: "displayed" });
  const noFollowers = [
    ...new Set(entries.filter((e) => e.kind === "followers").map((e) => e.platform)),
  ];
  if (noFollowers.length)
    items.push(
      `Abonnés : aucun relevé jusqu’au ${frDate(period.end)} pour ${joinNames(noFollowers.map(networkName))}.`,
    );
  return items.length ? { title: "Chiffres partiels :", items } : null;
}

/**
 * Pourquoi la valeur comparée de cartes de Global porte « (partiel) » : une ligne par réseau, sous « Période comparée (T3 2024) partielle : ». Global n'a pas de phrase de comparaison vide
 * (comparisonGapNote est propre aux onglets réseau), tout y est donc dit, l'organique du compte compris.
 * `rows` : les totaux de chaque réseau sur la période COMPARÉE, `t` et `o` les totaux affiché et comparé (YouTube compris).
 */
export function comparedGlobalNote(
  days: readonly SocialDay[],
  rows: readonly RealTotals[],
  t: RealTotals,
  o: RealTotals,
  comparison: Period,
): NoteBlock | null {
  const entries = entriesOf(o, partialComparedKeys(t, o, GLOBAL_COMPARED_KEYS), rows);
  const items = networkLines(entries, rows, { days, period: comparison, where: "compared" });
  return items.length ? { title: comparedTitle(comparison), items } : null;
}
