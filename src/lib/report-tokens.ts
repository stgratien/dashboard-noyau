import type { RealTotals } from './social-totals';
import { coverageDescription } from './coverage-text';
import { changePercent, formatBudget, formatChangePercent, formatEuro, formatNumber, formatPercent, formatPoints, typographicMinus } from './dashboard-format';
import { EDITIONS, type Period } from './dashboard-periods';
import { client } from './client';
import { storyComplete, storyCoverageText, type StoryMetric, type StoryTotals } from './social-stories';

/**
 * Chiffres du rapport Google Slides : mêmes calculs et mêmes formats que le tableau de bord, une valeur de texte par marqueur
 * (« {{linkedin.impressions}} » → « 2,1M »). Une valeur absente s'écrit « n.d. ».
 * Les comparaisons « vs T2 2024 » restent dans le modèle : l'historique organique de Facebook et d'Instagram ne remonte pas à 2024.
 */
const ALL_REPORT_NETWORKS = ['linkedin', 'facebook', 'instagram', 'tiktok'] as const;
export type ReportNetwork = (typeof ALL_REPORT_NETWORKS)[number];
/** Réseaux du rapport pour ce client : ceux de ses onglets, dans l'ordre du rapport. */
export const REPORT_NETWORKS: readonly ReportNetwork[] = ALL_REPORT_NETWORKS.filter((n) => client.networks.includes(n));
export const NOT_AVAILABLE = 'n.d.';

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const longDay = (iso: string) => {
  const d = Number(iso.slice(8, 10));
  return `${d === 1 ? '1er' : d} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
};
/** « 1er avril – 30 juin 2026 » ; les deux années sont écrites quand la période en chevauche deux. */
export function longPeriod(p: Period) {
  const [y1, y2] = [p.start.slice(0, 4), p.end.slice(0, 4)];
  return y1 === y2 ? `${longDay(p.start)} – ${longDay(p.end)} ${y2}` : `${longDay(p.start)} ${y1} – ${longDay(p.end)} ${y2}`;
}
const lastDayOfMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
/** « T2 2026 » quand la période est exactement un trimestre civil, sinon null. */
export function quarterLabel(p: Period) {
  const month = Number(p.start.slice(5, 7)), year = Number(p.start.slice(0, 4));
  if ((month - 1) % 3 !== 0 || p.start.slice(8, 10) !== '01') return null;
  const endMonth = month + 2;
  const end = `${year}-${String(endMonth).padStart(2, '0')}-${String(lastDayOfMonth(year, endMonth)).padStart(2, '0')}`;
  return p.end === end ? `T${(month - 1) / 3 + 1} ${year}` : null;
}
/** « septembre 2026 » quand la période est exactement un mois civil, sinon null. */
export function monthLabel(p: Period) {
  const year = Number(p.start.slice(0, 4)), month = Number(p.start.slice(5, 7));
  const last = `${p.start.slice(0, 8)}${String(lastDayOfMonth(year, month)).padStart(2, '0')}`;
  return p.start.slice(8, 10) === '01' && p.end === last ? `${MONTHS[month - 1]} ${year}` : null;
}
/** « 2025 » quand la période est exactement une année civile, sinon null. */
export function yearLabel(p: Period) {
  const year = p.start.slice(0, 4);
  return p.start === `${year}-01-01` && p.end === `${year}-12-31` ? year : null;
}
/**
 * Nom de la période tel qu'on l'écrit dans le rapport et dans le nom du fichier : « T1 2026 », « septembre 2026 », « 2025 »,
 * « Édition 2025 » (nom d’une édition du client), sinon les dates en toutes lettres (« 20 septembre – 19 octobre 2026 »).
 */
export function periodName(p: Period) {
  return quarterLabel(p) ?? monthLabel(p) ?? yearLabel(p) ?? EDITIONS.find((e) => e.start === p.start && e.end === p.end)?.name ?? longPeriod(p);
}
/** Trimestre précédent d'un trimestre complet (« T1 2026 » pour « T2 2026 »), sinon « la période précédente ». */
export function previousLabel(p: Period) {
  const label = quarterLabel(p);
  if (!label) return 'la période précédente';
  const q = Number(label[1]), year = Number(label.slice(3));
  return q === 1 ? `T4 ${year - 1}` : `T${q - 1} ${year}`;
}
const text = (n: number | null | undefined, format: (v: number) => string) => (n == null || !Number.isFinite(n) ? NOT_AVAILABLE : format(n));
const num = (n: number | null | undefined) => text(n, (v) => formatNumber(v));
const signed = (n: number) => `${n >= 0 ? '+' : ''}${typographicMinus(n.toLocaleString('fr-FR'))}`;

/** Variation des abonnés sur la période, comme sous la carte « Abonnés » : « +1,2% en T1 2026 (+440) ». */
export function followersChange(t: Pick<RealTotals, 'followerGrowth' | 'followerGrowthPercent'>, since: string) {
  if (t.followerGrowth == null || t.followerGrowthPercent == null) return NOT_AVAILABLE;
  return `${formatChangePercent(t.followerGrowthPercent)} en ${since} (${signed(t.followerGrowth)})`;
}

export type ReportTotals = Pick<
  RealTotals,
  | 'posts' | 'followers' | 'followerGrowth' | 'followerGrowthPercent' | 'adsDelivered' | 'impressionsPerPost' | 'impressions'
  | 'videoViews' | 'videos' | 'interactions' | 'engagementRate' | 'spend' | 'cpm' | 'cpe' | 'cpv' | 'clicks'
> & { missing?: Record<string, string[]>; stories?: StoryTotals | undefined };

/** Budget YouTube du rapport : campagnes Google Ads dont le nom contient « YouTube » (voir youtubeCampaignSpend). */
export type ReportYoutube = { spend: number | null };

/**
 * Marqueurs YouTube de la diapositive 51 : « {{youtube.spend}} » et, avec une période comparée, « _prev », l'écart « _change » (« +28% », « — » sans
 * comparaison possible) et son sens « _tone » (un budget en hausse est vert, comme sur les autres cartes).
 */
export function youtubeTokens(current: ReportYoutube, previous?: ReportYoutube): Record<string, string> {
  const budget = (v: number | null) => text(v, (n) => formatBudget(n));
  const tokens: Record<string, string> = { 'youtube.spend': budget(current.spend) };
  if (previous) {
    const d = current.spend == null || previous.spend == null ? undefined : changePercent(current.spend, previous.spend);
    tokens['youtube.spend_prev'] = budget(previous.spend);
    tokens['youtube.spend_change'] = d === undefined ? '—' : formatChangePercent(d);
    tokens['youtube.spend_tone'] = d === undefined ? 'neutral' : d >= 0 ? 'good' : 'bad';
  }
  return tokens;
}

/** Valeurs d'un réseau sans préfixe : une clé par chiffre du rapport. */
function figures(t: ReportTotals) {
  return {
    publications: num(t.posts),
    followers: num(t.followers),
    ads: num(t.adsDelivered),
    impressionsPerPost: num(t.impressionsPerPost),
    impressions: num(t.impressions),
    videoViews: num(t.videoViews),
    videos: t.videos == null ? NOT_AVAILABLE : String(t.videos),
    interactions: num(t.interactions),
    engagementRate: text(t.engagementRate, (v) => formatPercent(v)),
    spend: text(t.spend, (v) => formatBudget(v)),
    cpm: text(t.cpm, (v) => formatEuro(v, 2)),
    cpe: text(t.cpe, (v) => formatEuro(v, 2)),
    // Un coût par vue se compte en millièmes d'euro : trois décimales, comme dans le rapport d'origine.
    cpv: text(t.cpv, (v) => formatEuro(v, 3)),
    clicks: num(t.clicks),
  };
}

export type Tone = 'good' | 'bad' | 'neutral';
/** Cartes du tableau de bord avec comparaison : clé du chiffre dans le rapport, clé de couverture, sens (coûts : une baisse est bonne), écart en points. */
const CARDS: { metric: keyof ReturnType<typeof figures>; key: keyof ReportTotals & string; inverse?: boolean; points?: boolean }[] = [
  { metric: 'publications', key: 'posts' }, { metric: 'videos', key: 'videos' }, { metric: 'ads', key: 'adsDelivered' },
  { metric: 'impressions', key: 'impressions' }, { metric: 'impressionsPerPost', key: 'impressionsPerPost' },
  { metric: 'videoViews', key: 'videoViews' }, { metric: 'interactions', key: 'interactions' }, { metric: 'clicks', key: 'clicks' },
  { metric: 'engagementRate', key: 'engagementRate', points: true }, { metric: 'spend', key: 'spend' },
  { metric: 'cpe', key: 'cpe', inverse: true }, { metric: 'cpv', key: 'cpv', inverse: true }, { metric: 'cpm', key: 'cpm', inverse: true },
];

/**
 * Sous-ligne d'une carte, comme dans le tableau de bord (Kpi) : « vs 1,7M (+28%) » ; le chiffre comparé est « — » s'il n'existe pas,
 * l'écart n'est donné que si la couverture des deux périodes est la même (jamais un changement de périmètre présenté comme une performance).
 * `tone` dit comment colorer l'écart : vert si bon, rouge sinon (les coûts sont inversés).
 */
export function cardLines(current: ReportTotals, previous: ReportTotals) {
  const now = figures(current), before = figures(previous);
  const lines: Record<string, { vs: string; tone: Tone }> = {};
  for (const { metric, key, inverse, points } of CARDS) {
    const prevShown = before[metric] === NOT_AVAILABLE ? '—' : before[metric];
    const a = current[key] as number | null | undefined, b = previous[key] as number | null | undefined;
    const sameScope = JSON.stringify(current.missing?.[key] ?? []) === JSON.stringify(previous.missing?.[key] ?? []);
    const noVideoChange = metric === 'videoViews' && current.videos === 0 && current.videoViews === 0;
    const pts = points && a != null && b != null && sameScope ? a - b : undefined;
    const d = !sameScope || noVideoChange ? undefined : changePercent(a, b);
    const shift = prevShown === '—' ? undefined : points ? pts : d;
    const change = shift === undefined ? undefined : points ? formatPoints(pts as number) : formatChangePercent(d as number);
    const good = shift === undefined ? true : inverse ? shift <= 0 : shift >= 0;
    // Une valeur comparée qui ne couvre pas les mêmes sources que la période (réseau sans historique, par exemple) est marquée « partiel » : sans cela « vs 1,9M » se lirait comme un total complet.
    const partialPrev = !sameScope && (previous.missing?.[key]?.length ?? 0) > 0 && prevShown !== '—';
    lines[metric] = { vs: `vs ${prevShown}${partialPrev ? ' (partiel)' : ''}${change === undefined ? '' : ` (${change})`}`, tone: change === undefined ? 'neutral' : good ? 'good' : 'bad' };
  }
  return lines;
}

/** Cartes Stories (Instagram) : marqueur, chiffre des stories. Elles suivent les règles de couverture des stories : variation seulement si les deux périodes sont complètes. */
const STORY_CARDS: { metric: string; key: StoryMetric }[] = [
  { metric: 'stories', key: 'count' }, { metric: 'storyViews', key: 'views' },
  { metric: 'storyViewsPerStory', key: 'viewsPerStory' }, { metric: 'storyInteractions', key: 'interactions' },
];
const storyFigures = (s: StoryTotals) => Object.fromEntries(STORY_CARDS.map(({ metric, key }) => [metric, num(s[key])]));
/** Sous-lignes « vs … (+x%) » des cartes Stories, comme cardLines. */
export function storyCardLines(current: StoryTotals, previous: StoryTotals) {
  const lines: Record<string, { vs: string; tone: Tone }> = {};
  for (const { metric, key } of STORY_CARDS) {
    const prevShown = previous[key] == null ? '—' : num(previous[key]);
    const a = current[key], b = previous[key];
    const d = storyComplete(current, key) && storyComplete(previous, key) ? changePercent(a, b) : undefined;
    lines[metric] = { vs: `vs ${prevShown}${d === undefined ? '' : ` (${formatChangePercent(d)})`}`, tone: d === undefined ? 'neutral' : d >= 0 ? 'good' : 'bad' };
  }
  return lines;
}

/**
 * Toutes les valeurs d'un réseau (ou du Global) sous les noms de marqueurs du modèle.
 * Avec une période de comparaison, chaque chiffre existe aussi en « _prev » (« {{linkedin.impressions_prev}} »).
 */
export function networkTokens(prefix: string, t: ReportTotals, since: string, previous?: ReportTotals): Record<string, string> {
  const tokens: Record<string, string> = { [`${prefix}.followers_change`]: followersChange(t, since) };
  for (const [key, value] of Object.entries(figures(t))) tokens[`${prefix}.${key}`] = value;
  if (t.stories) for (const [key, value] of Object.entries(storyFigures(t.stories))) tokens[`${prefix}.${key}`] = value;
  if (previous) {
    for (const [key, value] of Object.entries(figures(previous))) tokens[`${prefix}.${key}_prev`] = value;
    for (const [metric, { vs, tone }] of Object.entries(cardLines(t, previous))) {
      tokens[`${prefix}.${metric}_vs`] = vs;
      tokens[`${prefix}.${metric}_tone`] = tone;
    }
    if (t.stories && previous.stories) {
      for (const [key, value] of Object.entries(storyFigures(previous.stories))) tokens[`${prefix}.${key}_prev`] = value;
      for (const [metric, { vs, tone }] of Object.entries(storyCardLines(t.stories, previous.stories))) {
        tokens[`${prefix}.${metric}_vs`] = vs;
        tokens[`${prefix}.${metric}_tone`] = tone;
      }
    }
  }
  return tokens;
}

const NETWORK_NAMES: Record<string, string> = { global: 'Global', linkedin: 'LinkedIn', facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok' };
/** Libellé du chiffre et clé de couverture (RealTotals.missing) de chaque marqueur. */
const FIGURES: Record<string, [label: string, key: string]> = {
  publications: ['publications', 'posts'], followers: ['abonnés', 'followers'], followers_change: ['évolution des abonnés', 'followers'],
  ads: ['annonces diffusées', 'adsDelivered'], impressionsPerPost: ['impressions par publication', 'impressionsPerPost'],
  impressions: ['impressions', 'impressions'], videoViews: ['vues de vidéo', 'videoViews'], videos: ['vidéos publiées', 'videos'],
  interactions: ['interactions', 'interactions'], engagementRate: ["taux d'engagement", 'engagementRate'], spend: ['budget', 'spend'],
  cpm: ['CPM', 'cpm'], cpe: ['CPE', 'cpe'], cpv: ['CPV', 'cpv'], clicks: ['clics', 'clicks'],
};
/** Même lecture que l'info « partiel » du tableau de bord (coverageDetails) : « 3 vidéos Instagram sans nombre de vues », « organique LinkedIn non disponible… ». */
function coverageText(id: string, key: string) {
  return coverageDescription(id, key, (platform) => NETWORK_NAMES[platform] ?? platform);
}
/** Chiffres que le tableau de bord marque « partiel » : le rapport les écrit tels quels, cette liste permet de les relire. */
export function partialNotes(prefix: string, t: Pick<ReportTotals, 'missing' | 'stories'>): string[] {
  const notes = Object.entries(FIGURES).flatMap(([suffix, [label, key]]) => {
    const missing = t.missing?.[key] ?? [];
    return missing.length ? [`${NETWORK_NAMES[prefix] ?? prefix}, ${label} : partiel (${missing.map((id) => coverageText(id, key)).join(' ; ')})`] : [];
  });
  const s = t.stories;
  const name = NETWORK_NAMES[prefix] ?? prefix;
  if (s?.failed) notes.push(`${name}, stories : momentanément indisponibles (lecture impossible)`);
  else if (s?.coverage === 'none') notes.push(`${name}, stories : non disponibles (le suivi des stories n'était pas actif sur cette période)`);
  else if (s?.coverage === 'partial') notes.push(`${name}, stories : partiel (${storyCoverageText(s)})`);
  if (s && !s.failed && s.coverage !== 'none') {
    if (s.withoutViews > 0) notes.push(`${name}, stories : ${s.withoutViews} sans vues connues`);
    if (s.withoutInteractions > 0) notes.push(`${name}, stories : ${s.withoutInteractions} sans interactions connues`);
  }
  return notes;
}

/** Notes de couverture de tout le rapport (Global puis chaque réseau). */
export function buildReportNotes(totals: { global: ReportTotals } & Record<ReportNetwork, ReportTotals>) {
  return ['global', ...REPORT_NETWORKS].flatMap((n) => partialNotes(n, n === 'global' ? totals.global : totals[n as ReportNetwork]));
}

export type ReportComparison = { label: string; totals: { global: ReportTotals } & Record<ReportNetwork, ReportTotals> };

/** Tous les marqueurs du rapport pour une période : titres, Global et chaque réseau (et la période comparée si elle est donnée). */
export function buildReportTokens(period: Period, totals: { global: ReportTotals } & Record<ReportNetwork, ReportTotals>, comparison?: ReportComparison, youtube?: { current: ReportYoutube; previous?: ReportYoutube }) {
  const since = previousLabel(period);
  const one = (prefix: string, current: ReportTotals, previous?: ReportTotals) => networkTokens(prefix, current, since, previous);
  return {
    trimestre: periodName(period),
    periode_longue: longPeriod(period),
    ...(comparison ? { comparaison: comparison.label } : {}),
    ...one('global', totals.global, comparison?.totals.global),
    ...REPORT_NETWORKS.reduce<Record<string, string>>((all, n) => ({ ...all, ...one(n, totals[n], comparison?.totals[n]) }), {}),
    ...(youtube ? youtubeTokens(youtube.current, comparison ? youtube.previous : undefined) : {}),
  } as Record<string, string>;
}
