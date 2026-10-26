import { dayNumber, isoFromDay, periodDays, yesterdayISO, type Period } from "./dashboard-periods";
import { changePercent } from "./dashboard-format";

/**
 * Stories Instagram. Instagram ne donne les chiffres d'une story que pendant les 24 h de sa vie : la synchronisation les relève plusieurs fois
 * par jour (social_stories) et note les jours relevés (social_story_coverage). Avant le premier relevé il n'existe aucune donnée :
 * la période est alors « non disponible », jamais un zéro inventé.
 */
export type SocialStory = {
  platform: string;
  story_id: string;
  published_at: string;
  views: number | null;
  reach: number | null;
  replies: number | null;
  shares: number | null;
  interactions: number | null;
};
/**
 * Entrée de couverture. Relevé en direct : `day` = jour du relevé, `pulls` > 0 relevés réussis, `maxGapMinutes` = plus long intervalle entre deux relevés réussis
 * qui se termine ce jour-là (null : inconnu / premier relevé). Fenêtre importée (historique des exports Meta) : `through` = dernier jour de Paris couvert
 * (`day` = premier), `level` dit si la liste des stories de ces jours est complète ou probablement incomplète.
 */
export type StoryPull = { platform: string; day: string; pulls: number; maxGapMinutes?: number | null; through?: string; level?: "complete" | "partial" };

/** Un total (vues, interactions) n'est donné que si au moins cette part des stories de la période a le chiffre : la somme de 1 story sur 240 serait trompeuse même marquée partielle. */
export const STORY_MIN_KNOWN_SHARE = 0.5;

/** Intervalle maximal toléré entre deux relevés : au-delà, des stories ont pu naître et expirer sans être vues. Les relevés ont lieu toutes les 3 h. */
export const STORY_MAX_GAP_MINUTES = 360;

const parisDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
/** Jour de Paris d'une date-heure ISO (une story publiée à 00 h 30 à Paris appartient à ce jour, pas à la veille UTC). */
export const storyDay = (iso: string) => {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? parisDate.format(time) : "";
};

/** Interactions d'une story : le total fourni par Instagram, sinon réponses + partages quand les deux sont connus. */
export const storyInteractions = (s: Pick<SocialStory, "interactions" | "replies" | "shares">): number | null =>
  s.interactions ?? (s.replies != null && s.shares != null ? s.replies + s.shares : null);

export type StoryCoverage = "full" | "partial" | "none";
export type StoryTotals = {
  coverage: StoryCoverage;
  /** Jours de la période dont toutes les stories ont pu être relevées / jours de la période. */
  coveredDays: number;
  days: number;
  /** Premier jour relevé de la période (null sans relevé). */
  firstCoveredDay: string | null;
  /** Jours de la période avant le premier jour relevé. */
  headDays: number;
  /** Jours relevés d'un seul tenant (sans trou entre le premier et le dernier jour relevé). */
  contiguous: boolean;
  /** Jours de la période après le dernier jour relevé (aujourd'hui, et hier avant le premier relevé du jour, ne sont pas encore couverts). */
  tailDays: number;
  /** La période touche hier ou aujourd'hui : son dernier jour peut n'être pas encore couvert sans qu'il y ait eu de trou. */
  tailOpen: boolean;
  /** Jours de la période connus seulement par un historique probablement incomplet (fenêtre « partial ») : ils ne comptent pas comme couverts. */
  incompleteDays: number;
  /** La lecture des stories a échoué : « momentanément indisponible », pas « suivi non actif ». */
  failed: boolean;
  count: number | null;
  views: number | null;
  viewsPerStory: number | null;
  interactions: number | null;
  /** Stories de la période dont Instagram n'a pas donné le chiffre : le total les ignore et est alors partiel. */
  withoutViews: number;
  withoutInteractions: number;
};

const NONE = (days: number, failed = false): StoryTotals => ({
  coverage: "none", coveredDays: 0, days, firstCoveredDay: null, headDays: days, contiguous: true, tailDays: 0, tailOpen: false, incompleteDays: 0, failed,
  count: null, views: null, viewsPerStory: null, interactions: null, withoutViews: 0, withoutInteractions: 0,
});

/**
 * Chiffres des stories d'une période. Un jour est couvert par un relevé en direct quand un relevé a eu lieu ce jour-là ET le lendemain, sans intervalle de plus de
 * STORY_MAX_GAP_MINUTES entre deux relevés ces deux jours-là (toute story publiée ce jour-là a alors vécu entre deux relevés), ou par une fenêtre d'historique
 * importé « complete » ; aujourd'hui n'est donc jamais couvert par un relevé en direct. Un jour d'une fenêtre « partial » n'est pas couvert : ses stories connues sont comptées mais la période
 * reste partielle, et sans aucune story connue elle est non disponible (le zéro d'un export probablement incomplet serait inventé). Sans jour couvert ni connu la période
 * est non disponible ; avec quelques jours seulement les chiffres sont partiels (les stories connues sont comptées, celles d'avant le suivi ou d'un trou manquent).
 * `failed` : la lecture a échoué, rien n'est affirmé. `yesterday` (hier à Paris par défaut) dit si la période est récente : seule une période récente peut avoir
 * son dernier jour « en cours ».
 */
export function storiesTotals(
  stories: SocialStory[],
  pulls: StoryPull[],
  period: Period,
  { failed = false, platform = "instagram", yesterday = yesterdayISO() }: { failed?: boolean | undefined; platform?: string; yesterday?: string } = {},
): StoryTotals {
  const days = periodDays(period);
  if (failed) return NONE(days, true);
  const live = new Map<string, number>();
  const imported = { complete: new Set<string>(), partial: new Set<string>() };
  for (const p of pulls.filter((x) => x.platform === platform)) {
    if (p.through) {
      // Seuls les jours de la période comptent (une fenêtre d'historique peut durer des années).
      for (let d = Math.max(dayNumber(p.day), dayNumber(period.start)); d <= Math.min(dayNumber(p.through), dayNumber(period.end)); d++) imported[p.level === "partial" ? "partial" : "complete"].add(isoFromDay(d));
    } else if (p.pulls > 0) live.set(p.day, p.maxGapMinutes ?? 0);
  }
  const steady = (day: string) => live.has(day) && (live.get(day) ?? 0) <= STORY_MAX_GAP_MINUTES;
  let coveredDays = 0, incompleteDays = 0, first = -1, last = -1;
  for (let i = 0; i < days; i++) {
    const day = isoFromDay(dayNumber(period.start) + i);
    if (imported.complete.has(day) || (steady(day) && steady(isoFromDay(dayNumber(day) + 1)))) {
      coveredDays++;
      if (first < 0) first = i;
      last = i;
    } else if (imported.partial.has(day)) incompleteDays++;
  }
  if (coveredDays === 0 && incompleteDays === 0) return NONE(days);
  const own = [
    ...new Map(
      stories
        .filter((s) => s.platform === platform)
        .filter((s) => {
          const day = storyDay(s.published_at);
          return day >= period.start && day <= period.end;
        })
        .map((s) => [s.story_id, s]),
    ).values(),
  ];
  // Un historique partiel sans aucune story connue ne prouve rien : non disponible, jamais un zéro.
  if (coveredDays === 0 && own.length === 0) return NONE(days);
  const known = (values: (number | null)[]) => values.filter((v): v is number => v != null);
  const views = known(own.map((s) => s.views));
  const interactions = known(own.map((s) => storyInteractions(s)));
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const enough = (values: number[]) => values.length > 0 && values.length >= own.length * STORY_MIN_KNOWN_SHARE;
  return {
    coverage: coveredDays === days ? "full" : "partial",
    coveredDays,
    days,
    firstCoveredDay: first < 0 ? null : isoFromDay(dayNumber(period.start) + first),
    headDays: first < 0 ? days : first,
    contiguous: first < 0 ? true : coveredDays === last - first + 1,
    tailDays: first < 0 ? 0 : days - 1 - last,
    tailOpen: period.end >= yesterday,
    incompleteDays,
    failed: false,
    count: own.length,
    // Aucune story : un vrai zéro. Des stories dont moins de la moitié ont le chiffre : indisponible (STORY_MIN_KNOWN_SHARE).
    views: own.length === 0 ? 0 : enough(views) ? sum(views) : null,
    viewsPerStory: enough(views) ? sum(views) / views.length : null,
    interactions: own.length === 0 ? 0 : enough(interactions) ? sum(interactions) : null,
    withoutViews: own.length - views.length,
    withoutInteractions: own.length - interactions.length,
  };
}

export type StoryMetric = "count" | "views" | "viewsPerStory" | "interactions";
/** Le chiffre est complet : toute la période relevée et aucune story sans chiffre. */
export const storyComplete = (t: StoryTotals, metric: StoryMetric) =>
  t.coverage === "full" && t[metric] != null && (metric === "interactions" ? t.withoutInteractions === 0 : metric === "count" ? true : t.withoutViews === 0);

/** Variation en % entre deux périodes, seulement si les deux sont complètes (jamais un changement de périmètre présenté comme une performance). */
export const storyDelta = (t: StoryTotals, o: StoryTotals, metric: StoryMetric): number | undefined =>
  storyComplete(t, metric) && storyComplete(o, metric) ? changePercent(t[metric], o[metric]) : undefined;

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
/** « 21 oct. » (le 1er : « 1er oct. »). */
export const shortDay = (iso: string) => `${Number(iso.slice(8, 10)) === 1 ? "1er" : Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

/**
 * Pourquoi une période relevée en partie est partielle, d'après la forme de la couverture : « relevé depuis le 21 oct. » seulement quand les jours
 * relevés se suivent jusqu'à la fin (au plus le dernier jour en cours non couvert), sinon « 12 jours relevés sur 30 ».
 */
export function storyCoverageText(t: StoryTotals): string | undefined {
  if (t.coverage !== "partial") return undefined;
  if (!t.firstCoveredDay) return "historique incomplet";
  // Un dernier jour non couvert n'est « en cours » que pour une période récente ; ailleurs c'est un trou.
  if (!t.contiguous || t.tailDays > (t.tailOpen ? 1 : 0)) return `${t.coveredDays} ${t.coveredDays > 1 ? "jours relevés" : "jour relevé"} sur ${t.days}`;
  return t.headDays > 0 ? `relevé depuis le ${shortDay(t.firstCoveredDay)}` : "dernier jour en cours";
}

/** Mention sous une carte : pourquoi le chiffre est partiel ou absent. */
export function storyNote(t: StoryTotals, metric: StoryMetric, lead = false): string | undefined {
  if (t.failed) return lead ? "Stories momentanément indisponibles" : undefined;
  if (t.coverage === "none") return lead ? "Suivi des stories non actif sur cette période" : undefined;
  const missing = metric === "interactions" ? t.withoutInteractions : metric === "count" ? 0 : t.withoutViews;
  const parts = [
    t.coverage === "partial" ? (lead ? `partiel : ${storyCoverageText(t)}` : "partiel") : undefined,
    missing > 0 ? `${missing} ${missing > 1 ? "stories sans chiffre" : "story sans chiffre"}` : undefined,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

/**
 * Fusionne des listes de stories (relevé en direct + historique importé) : une story par identifiant, le plus grand chiffre connu de chaque colonne
 * (les chiffres d'une story ne font que croître), un chiffre absent ne remplace jamais un chiffre connu.
 */
export function mergeStories(...lists: SocialStory[][]): SocialStory[] {
  const high = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.max(a, b));
  const merged = new Map<string, SocialStory>();
  for (const story of lists.flat()) {
    const key = `${story.platform}:${story.story_id}`, old = merged.get(key);
    merged.set(key, old
      ? { ...old, views: high(old.views, story.views), reach: high(old.reach, story.reach), replies: high(old.replies, story.replies), shares: high(old.shares, story.shares), interactions: high(old.interactions, story.interactions) }
      : { ...story });
  }
  return [...merged.values()];
}
