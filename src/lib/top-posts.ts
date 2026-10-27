import type { SocialPost } from './social-totals';
import { facebookPostUrl, safePostUrl } from './post-links';
import type { KpiKey } from './kpi-definitions';
import { VIDEO_FORMATS } from './windsor-mapping';

/** Dépense minimale pour concourir au « Top CPM » : un débordement de quelques centimes ne doit pas gagner. */
export const MIN_CPM_SPEND = 5;
export type PostStats = ReturnType<typeof postStats>;
/** Le format stocké « Carrousel / Album » s'affiche « Album » sur Facebook et « Carrousel » ailleurs : jamais les deux noms côte à côte. */
export const formatLabel = (platform: string, format: string) =>
  format === 'Carrousel / Album' ? (platform === 'facebook' ? 'Album' : 'Carrousel') : format;
/** Format affiché et filtré : un reel ou une vidéo (et tout TikTok) est une « Vidéo », le format inconnu (« Post ») est « Non disponible », comme dans « Publications par format ». */
export const postFormat = (platform: string, format: string) =>
  platform === 'tiktok' || VIDEO_FORMATS.includes(format) ? 'Vidéo' : format === 'Post' ? 'Non disponible' : formatLabel(platform, format);
const FORMAT_ORDER = ['Photo', 'Vidéo', 'Carrousel', 'Album', 'Document', 'Autre', 'Non disponible', 'Publicité'];
/** Formats présents dans les lignes du tableau, dans l'ordre habituel (« Publications par format »), les formats inattendus à la fin. */
export const formatOptions = (rows: PostStats[]) =>
  [...new Set(rows.map(r => r.format))].sort((a, b) => (FORMAT_ORDER.indexOf(a) + 1 || 99) - (FORMAT_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b, 'fr'));
/**
 * Texte d'une publication LinkedIn : retire le balisage du connecteur (hashtags « {hashtag|\#|mot} », mentions « @[Nom](urn:li:...) ») et les échappements
 * (« \( », « \# »...) pour n'afficher que le texte lisible. Les autres réseaux ne portent pas ce balisage : leur texte reste tel quel.
 */
export const cleanPostText = (platform: string, text: string) =>
  platform !== 'linkedin' ? text : text
    .replace(/\{hashtag\|\\?#\|([^}]*)\}/g, '#$1')
    .replace(/@\[([^\]]*)\]\(urn:li:[^)]*\)/g, '@$1')
    .replace(/\\([\\(){}[\]<>#*_|~@])/g, '$1');
/** Per-post figures; budget/CPM come only from ads linked to the post, never from account totals. */
export function postStats(x: SocialPost) {
  const n = (k: string) => x.metrics[k] ?? null;
  const impressions = n('impressions'), likes = n('likes'), comments = n('comments'), shares = n('shares');
  const interactions = likes == null || comments == null || shares == null ? null : likes + comments + shares;
  const spend = x.sponsored && x.sponsored.spend > 0 ? x.sponsored.spend : null;
  const cpm = spend != null && x.sponsored && x.sponsored.impressions > 0 ? spend / x.sponsored.impressions * 1000 : null;
  // CPE : budget de ses annonces ÷ interactions totales de la publication (j'aime + commentaires + partages, organique et payant confondus, comme les colonnes du tableau).
  const cpe = spend != null && interactions ? spend / interactions : null;
  return {
    id: x.post_id, title: cleanPostText(x.platform, x.title) || 'Publication', format: postFormat(x.platform, x.format), vertical: x.platform === 'tiktok' || x.format === 'Reel' || /\/reels?\//.test(x.permalink ?? ''),
    thumbnail_url: x.thumbnail_url ?? '', permalink: safePostUrl(x.platform, x.permalink),
    ts: Date.parse(x.published_at),
    date: new Date(x.published_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris' }),
    impressions, likes, comments, shares, interactions, rate: interactions == null || !impressions ? null : interactions / impressions * 100, spend, cpm, cpe,
    // Une publication qui a de la dépense publicitaire est « Paid » (elle reste une publication du compte : organic = true).
    type: (spend != null ? 'Paid' : 'Organique') as PostType,
    organic: true,
    adLink: x.adLink ?? null,
  };
}

export type PostType = 'Organique' | 'Paid';
export type AdDay = { platform: string; ad_id: string; day: string; post_id: string | null; spend: number; impressions: number; likes: number | null; comments: number | null; shares: number | null };
export type PaidAd = { platform: string; ad_id: string; title: string; thumbnail_url: string; first_day: string; spend: number; impressions: number; likes: number | null; comments: number | null; shares: number | null; permalink: string };
/** Ads delivering in the period whose promoted post is not a stored publication of the account (dark posts). */
export function paidOnlyAds(days: AdDay[], creatives: { platform: string; ad_id: string; ad_name: string | null; thumbnail_url?: string }[], knownPosts: Set<string>): PaidAd[] {
  const add = (a: number | null, b: number | null) => a == null && b == null ? null : (a ?? 0) + (b ?? 0);
  const m = new Map<string, PaidAd>();
  for (const d of days) {
    // Une ligne rattachée à une publication enregistrée compte déjà pour elle (budget natif) : elle ne fait pas de ligne « Paid ».
    // Le raisonnement se fait jour par jour : une annonce dont seuls les jours récents portent l'identifiant de la publication
    // (historique pas encore réimporté) garde ses jours plus anciens, que la règle sur le nom peut encore rattacher.
    if (d.post_id && knownPosts.has(`${d.platform}:${d.post_id}`)) continue;
    const k = `${d.platform}:${d.ad_id}`, c = creatives.find(x => x.platform === d.platform && x.ad_id === d.ad_id);
    const o = m.get(k) ?? { platform: d.platform, ad_id: d.ad_id, title: c?.ad_name || 'Publicité', thumbnail_url: c?.thumbnail_url ?? '', first_day: d.day, spend: 0, impressions: 0, likes: null, comments: null, shares: null, permalink: '' };
    o.spend += d.spend; o.impressions += d.impressions; o.likes = add(o.likes, d.likes); o.comments = add(o.comments, d.comments); o.shares = add(o.shares, d.shares);
    if (d.day < o.first_day) o.first_day = d.day;
    // Facebook : le lien de la publication se reconstruit depuis son identifiant « page_publication » (visible surtout des administrateurs si elle n'est pas publiée).
    if (!o.permalink && d.platform === 'facebook') o.permalink = facebookPostUrl(d.post_id);
    m.set(k, o);
  }
  return [...m.values()].filter(a => a.impressions > 0);
}
export function paidAdStats(a: PaidAd): PostStats {
  const interactions = a.likes == null || a.comments == null || a.shares == null ? null : a.likes + a.comments + a.shares;
  // TikTok : la colonne est « Vues » et une annonce n'a que des impressions : pas de vues connues, elle se classe après les vidéos.
  const views = a.platform === 'tiktok' ? null : a.impressions;
  return { id: `ad:${a.ad_id}`, title: a.title, format: 'Publicité', vertical: a.platform === 'tiktok', thumbnail_url: a.thumbnail_url, permalink: a.permalink,
    ts: Date.parse(`${a.first_day}T12:00:00Z`),
    date: new Date(`${a.first_day}T12:00:00Z`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris' }),
    impressions: views, likes: a.likes, comments: a.comments, shares: a.shares, interactions,
    rate: interactions == null || !views ? null : interactions / views * 100,
    spend: a.spend > 0 ? a.spend : null, cpm: a.spend > 0 && a.impressions > 0 ? a.spend / a.impressions * 1000 : null,
    cpe: a.spend > 0 && interactions ? a.spend / interactions : null, type: 'Paid', organic: false, adLink: null };
}

/** Visibilité et engagement : publications de la période (à défaut, publications plus anciennes promues pendant la période). CPM : aussi les publications d'avant la période promues pendant celle-ci (`promoted`). */
export type SortKey = 'type' | 'format' | 'ts' | 'impressions' | 'likes' | 'comments' | 'shares' | 'rate' | 'spend' | 'cpe';
/** Tri du tableau « Performance des publications » : valeurs absentes toujours en dernier, égalités départagées par les impressions (ou vues). */
export function sortRows(rows: PostStats[], key: SortKey, dir: 'asc' | 'desc'): PostStats[] {
  const sign = dir === 'asc' ? 1 : -1;
  const value = (r: PostStats): number | string | null => key === 'type' ? r.type : key === 'format' ? r.format : r[key];
  return [...rows].sort((a, b) => {
    const x = value(a), y = value(b);
    if (x == null && y == null) return (b.impressions ?? -1) - (a.impressions ?? -1);
    if (x == null) return 1;
    if (y == null) return -1;
    const c = typeof x === 'string' || typeof y === 'string' ? String(x).localeCompare(String(y), 'fr') : x - y;
    return c !== 0 ? c * sign : (b.impressions ?? -1) - (a.impressions ?? -1);
  });
}

/** Lignes par page du tableau « Performance des publications ». */
export const TABLE_PAGE_SIZE = 10;
/** Numéros de page à afficher (1 = première) : la première, la dernière, la page courante et ses voisines ; « … » à la place d'un trou de deux pages ou plus. */
export function pageWindow(current: number, count: number): (number | '…')[] {
  const pages = [...new Set([1, current - 1, current, current + 1, count])].filter((n) => n >= 1 && n <= count).sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  pages.forEach((n, i) => {
    const before = pages[i - 1];
    if (before !== undefined && n - before === 2) out.push(before + 1);
    else if (before !== undefined && n - before > 2) out.push('…');
    out.push(n);
  });
  return out;
}

export function topPosts(rows: PostStats[], promoted: PostStats[] = []) {
  const best = (list: PostStats[], score: (r: PostStats) => number | null, lowest = false) => list.reduce<PostStats | null>((acc, r) => {
    const v = score(r); if (v == null) return acc;
    const a = acc ? score(acc) : null;
    return a == null || (lowest ? v < a : v > a) ? r : acc;
  }, null);
  // Sans publication utilisable sur la période, la meilleure des publications plus anciennes promues pendant celle-ci (sa date est affichée).
  const pick = (score: (r: PostStats) => number | null) => best(rows, score) ?? best(promoted, score);
  return {
    visibility: pick(r => r.impressions),
    engagement: pick(r => r.interactions),
    cpm: best([...rows, ...promoted], r => r.spend != null && r.spend >= MIN_CPM_SPEND ? r.cpm : null, true),
  };
}

/** Une publication a besoin de quelques jours pour atteindre son public : avant, elle n'est jamais classée parmi les flops. */
export const FLOP_MIN_AGE_DAYS = 3;
/** Nombre maximum de flops par critère (jamais plus de la moitié des publications comparables). */
export const FLOP_COUNT = 3;
/**
 * Publications du compte les moins performantes de la période, par critère : visibilité (impressions, ou vues sur TikTok) et taux d'engagement.
 * Ne sont classées que les publications du compte (ni annonces seules, ni anciennes publications promues) publiées depuis au moins
 * FLOP_MIN_AGE_DAYS jours et dont le chiffre du critère est connu et non nul (un 0 est un chiffre non remonté, jamais un flop).
 * `eligible` = publications comparables ; à moins de deux, aucun classement.
 */
export function flopPosts(rows: PostStats[], now = Date.now()) {
  const mature = rows.filter(r => r.organic && Number.isFinite(r.ts) && now - r.ts >= FLOP_MIN_AGE_DAYS * 86_400_000);
  const rank = (score: (r: PostStats) => number | null, tie: (r: PostStats) => number | null) => {
    const list = mature.filter(r => score(r) != null);
    const count = list.length < 2 ? 0 : Math.min(FLOP_COUNT, Math.floor(list.length / 2));
    const high = (v: number | null) => v ?? Number.MAX_VALUE;
    const lowest = [...list].sort((a, b) => score(a)! - score(b)! || high(tie(a)) - high(tie(b)) || a.ts - b.ts || a.id.localeCompare(b.id)).slice(0, count);
    return { eligible: list.length, rows: lowest };
  };
  return {
    visibility: rank(r => r.impressions != null && r.impressions > 0 ? r.impressions : null, r => r.rate),
    engagement: rank(r => r.rate, r => r.impressions),
  };
}

export type AudienceRow = { platform: string; dimension: string; label: string; value: number; unit: string };
const regionNames = (() => { try { return new Intl.DisplayNames(['fr'], { type: 'region' }); } catch { return null; } })();
/** Windsor donne les pays en code ISO (« FR ») pour Facebook, Instagram et TikTok : affichés en français (« France »). Tout autre libellé est conservé. */
export const countryName = (label: string) => {
  if (!/^[A-Za-z]{2}$/.test(label)) return label;
  try { return regionNames?.of(label.toUpperCase()) ?? label; } catch { return label; }
};
const GENDER: Record<string, string> = { F: 'Femmes', M: 'Hommes', U: 'Non précisé', Female: 'Femmes', Male: 'Hommes', Other: 'Autre' };
/** Normalized audience breakdowns in percent of the platform's reported audience. */
export function audienceBreakdowns(rows: AudienceRow[], platform: string) {
  const own = rows.filter(r => r.platform === platform);
  const share = (items: { label: string; value: number }[], percent: boolean) => {
    const total = items.reduce((s, i) => s + i.value, 0);
    return items.map(i => ({ label: i.label, value: i.value, percent: percent ? i.value : total ? i.value / total * 100 : 0 })).sort((a, b) => b.value - a.value);
  };
  const dim = (d: string) => own.filter(r => r.dimension === d);
  const isPercent = (d: string) => dim(d)[0]?.unit === 'percent';
  const fold = (items: AudienceRow[], key: (label: string) => string) => {
    const m = new Map<string, number>();
    for (const i of items) m.set(key(i.label), (m.get(key(i.label)) ?? 0) + i.value);
    return [...m].map(([label, value]) => ({ label, value }));
  };
  const genderAge = dim('genderAge');
  const gender = genderAge.length ? share(fold(genderAge, l => GENDER[l.split('.')[0] ?? ''] ?? 'Non précisé'), false) : share(dim('gender').map(r => ({ label: GENDER[r.label] ?? r.label, value: r.value })), isPercent('gender'));
  const age = genderAge.length ? share(fold(genderAge, l => l.split('.')[1] ?? l), false).sort((a, b) => a.label.localeCompare(b.label)) : share(dim('age'), isPercent('age')).sort((a, b) => a.label.localeCompare(b.label));
  const top = (d: string) => share(dim(d), isPercent(d)).slice(0, 10);
  const country = share(dim('country').map(r => ({ label: countryName(r.label), value: r.value })), isPercent('country')).slice(0, 10);
  return { gender, age, country, city: top('city'), industry: top('industry'), function: top('function'), seniority: top('seniority') };
}

export type AudiencePanel = { key: string; title: string; info: KpiKey; items: { label: string; value: number; percent: number }[]; withUnit: boolean };
/** Panneaux de l'analyse des abonnés propres à un réseau ; Facebook ne fournit pas le sexe ni l'âge : ces panneaux n'apparaissent pas à vide. */
export function audiencePanels(p: string, a: ReturnType<typeof audienceBreakdowns>): AudiencePanel[] {
  const panels: AudiencePanel[] = [];
  const add = (key: string, title: string, info: KpiKey, items: AudiencePanel['items'], withUnit = true) => panels.push({ key, title, info, items, withUnit });
  if (p !== 'linkedin' && !(p === 'facebook' && !a.gender.length)) add('gender', 'Hommes / femmes', 'audienceGender', a.gender);
  if (p !== 'linkedin' && !(p === 'facebook' && !a.age.length)) add('age', 'Tranches d’âge', 'audienceAge', a.age);
  add('country', 'Pays (top 10)', 'audienceCountry', a.country);
  if (p === 'instagram' || p === 'facebook') add('city', 'Villes (top 10)', 'audienceCity', a.city);
  if (p === 'linkedin') {
    add('industry', 'Secteurs (top 10)', 'audienceIndustry', a.industry, false);
    add('function', 'Fonctions (top 10)', 'audienceFunction', a.function, false);
    add('seniority', 'Ancienneté', 'audienceSeniority', a.seniority, false);
  }
  return panels;
}
