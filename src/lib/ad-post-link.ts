import type { SocialPost } from './social-totals';
import { client } from './client';
import type { PaidAd } from './top-posts';

/**
 * Rapprochement automatique d'une annonce Meta avec la publication organique dont elle est issue.
 * Windsor donne, pour Instagram, l'identifiant de la copie publicitaire du média et jamais celui de la publication :
 * aucun lien natif n'existe. Les annonces suivent pourtant une convention de nommage « JJMMAAAA_titre_IG|FB ».
 * Règle (mesurée : 94,9 % de précision sur 136 propositions, 100 % sur Instagram avec le garde-fou jumelle) :
 *  1. la date au début du nom d'annonce, une seule publication ce jour-là (jour de Paris) sur le réseau visé ;
 *  2. sinon, plusieurs publications ce jour-là : départage par le texte, ou abstention ;
 *  3. sans date : texte seul (au moins deux racines de mots), avec un seuil plus strict. La fenêtre part du premier jour de diffusion
 *     de l'annonce (lu par le serveur sur tout l'historique) : le rapprochement ne dépend pas de la période affichée. Sans suffixe IG/FB
 *     dans le nom, les réseaux visés sont ceux où l'annonce diffuse dans la période affichée.
 * En cas de doute on s'abstient : l'annonce reste « Paid ».
 */
export type LinkablePost = { platform: string; post_id: string; published_at: string; title: string };
export type LinkableAd = { ad_id: string; name: string; platforms: string[]; first_day: string };
/** Annonce déjà liée nativement à une publication : sert de garde-fou pour sa jumelle (même nom, autre suffixe). */
export type TwinAd = { name: string; published_at: string };
export type AdPostLink = { ad_id: string; platform: string; post_id: string; by: 'date' | 'text' | 'manual' };

/** Réseaux où le rapprochement est actif : les annonces Meta suivent la convention de nommage. */
export const LINK_PLATFORMS = ['instagram', 'facebook'];
/** Score de texte minimal pour départager deux publications du même jour. */
export const MIN_SCORE_SAME_DAY = 0.5;
/** Score de texte minimal, sans date dans le nom : plus strict, car rien d'autre ne confirme le lien. */
export const MIN_SCORE_TEXT_ONLY = 0.75;
/** Sans date, au moins deux racines de mots : un seul mot (« exposants ») ne suffit pas à désigner une publication. */
export const MIN_STEMS_TEXT_ONLY = 2;
const LOOKBACK_DAYS = 45;

const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
/** Jour calendaire de Paris (AAAA-MM-JJ) d'un horodatage. */
export const parisDayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** Mots d'annonce trop courants, plus ceux du client (normalisés comme les noms : sans accent ni majuscule, expressions découpées en mots). */
const STOP_WORDS = new Set(['video', 'post', 'news', 'annonce', 'retour', ...client.ads.extraStopWords.flatMap((w) => normalize(w).split(' '))].filter(Boolean));

/** Date JJMMAAAA au tout début du nom (jour calendaire valide), sinon null. Les autres formats ne sont pas lus : ce ne sont pas des dates de publication. */
export function parseAdNameDate(name: string | null | undefined): string | null {
  const m = /^\s*(\d{2})(\d{2})(\d{4})(?!\d)/.exec(name ?? '');
  if (!m) return null;
  const [, dd = '', mm = '', yyyy = ''] = m;
  const d = Number(dd), mo = Number(mm), y = Number(yyyy);
  if (y < 2020 || y > 2100 || mo < 1 || mo > 12 || d < 1) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** Réseau(x) visé(s) par le suffixe du nom (_IG, IG_, - IG, _FB, IG+FB), sinon les réseaux de diffusion, limités à ceux du rapprochement. */
export function targetPlatforms(name: string, adPlatforms: string[]): string[] {
  const tokens = ` ${normalize(name)} `;
  const ig = tokens.includes(' ig '), fb = tokens.includes(' fb ');
  const named = ig && fb ? ['instagram', 'facebook'] : ig ? ['instagram'] : fb ? ['facebook'] : adPlatforms;
  return named.filter((p) => LINK_PLATFORMS.includes(p));
}

/** Racines (5 lettres) des mots significatifs du nom, sans date, suffixe de réseau ni mots trop courants. */
export function adStems(name: string): string[] {
  const body = normalize(name).replace(/^\d{8}\s*/, '');
  const roots = body
    .split(' ')
    .filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !STOP_WORDS.has(w))
    .map((w) => w.slice(0, 5));
  return [...new Set(roots)];
}

/** Part des racines du nom d'annonce retrouvées dans le titre de la publication (0 à 1). */
export function textScore(stems: string[], title: string): number {
  if (!stems.length) return 0;
  const roots = new Set(
    normalize(title)
      .split(' ')
      .filter((w) => w.length >= 4)
      .map((w) => w.slice(0, 5)),
  );
  return stems.filter((s) => roots.has(s)).length / stems.length;
}

/** Clé commune aux deux annonces jumelles (même date et même titre, suffixes différents). */
const twinKey = (name: string) => {
  const date = parseAdNameDate(name);
  if (!date) return null;
  const base = normalize(name)
    .replace(/^\d{8}\s*/, '')
    .split(' ')
    .filter((w) => w !== 'ig' && w !== 'fb')
    .join(' ');
  return `${date}|${base}`;
};

function bestUnique<T>(scored: { item: T; score: number }[], min: number): T | null {
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const best = sorted[0], second = sorted[1];
  if (!best || best.score < min || (second && second.score >= best.score)) return null;
  return best.item;
}

/** Annonces sans publication stockée, regroupées par annonce (une annonce diffuse sur plusieurs réseaux). */
export function groupUnlinkedAds(paidAds: PaidAd[]): LinkableAd[] {
  const m = new Map<string, LinkableAd>();
  for (const a of paidAds) {
    const o = m.get(a.ad_id) ?? { ad_id: a.ad_id, name: '', platforms: [], first_day: a.first_day };
    if (a.title && a.title !== 'Publicité' && !o.name) o.name = a.title;
    if (!o.platforms.includes(a.platform)) o.platforms.push(a.platform);
    if (a.first_day < o.first_day) o.first_day = a.first_day;
    m.set(a.ad_id, o);
  }
  return [...m.values()].filter((a) => a.name);
}

export function linkAdsToPosts(ads: LinkableAd[], posts: LinkablePost[], twins: TwinAd[] = []): Map<string, AdPostLink> {
  const links = new Map<string, AdPostLink>();
  const dated = posts.map((p) => ({ post: p, day: parisDayOf(p.published_at) }));
  for (const ad of ads) {
    const targets = targetPlatforms(ad.name, ad.platforms);
    if (!targets.length) continue;
    const stems = adStems(ad.name);
    const date = parseAdNameDate(ad.name);
    let pick: LinkablePost | null = null;
    let by: 'date' | 'text' = 'date';
    if (date) {
      const same = dated.filter((x) => targets.includes(x.post.platform) && x.day === date).map((x) => x.post);
      const platformsSeen = new Set(same.map((p) => p.platform));
      if (same.length === 1) pick = same[0] ?? null;
      else if (same.length > 1 && platformsSeen.size === 1)
        pick = bestUnique(same.map((item) => ({ item, score: textScore(stems, item.title) })), MIN_SCORE_SAME_DAY);
      // Garde-fou jumelle : la jumelle (même nom, autre suffixe) est liée à une publication d'un autre jour : on s'abstient.
      if (pick) {
        const key = twinKey(ad.name), pickDay = parisDayOf(pick.published_at);
        if (key && twins.some((t) => t.name !== ad.name && twinKey(t.name) === key && parisDayOf(t.published_at) !== pickDay)) pick = null;
      }
    } else if (stems.length >= MIN_STEMS_TEXT_ONLY) {
      const first = dayNumber(ad.first_day);
      const recent = dated.filter((x) => targets.includes(x.post.platform) && dayNumber(x.day) >= first - LOOKBACK_DAYS && dayNumber(x.day) <= first + 1);
      pick = bestUnique(recent.map((x) => ({ item: x.post, score: textScore(stems, x.post.title) })), MIN_SCORE_TEXT_ONLY);
      by = 'text';
    }
    if (pick) links.set(ad.ad_id, { ad_id: ad.ad_id, platform: pick.platform, post_id: pick.post_id, by });
  }
  return links;
}

/**
 * Ajoute à chaque publication visée la diffusion de ses annonces rapprochées (toutes diffusions confondues : une annonce
 * « _IG » diffuse surtout sur Facebook, et son budget appartient à la publication d'origine).
 * Renvoie les publications modifiées et les annonces effectivement rattachées.
 */
export function applyRuleLinks(
  links: Map<string, AdPostLink>,
  adTotals: Map<string, { spend: number; impressions: number }>,
  posts: SocialPost[],
  candidates: SocialPost[],
): { touched: SocialPost[]; applied: Set<string> } {
  const byKey = new Map<string, SocialPost>();
  for (const p of candidates) byKey.set(`${p.platform}:${p.post_id}`, p);
  for (const p of posts) byKey.set(`${p.platform}:${p.post_id}`, p);
  const touched = new Map<string, SocialPost>();
  const applied = new Set<string>();
  for (const link of links.values()) {
    const key = `${link.platform}:${link.post_id}`;
    const post = byKey.get(key), total = adTotals.get(link.ad_id);
    if (!post || !total) continue;
    const s = post.sponsored ?? { spend: 0, impressions: 0 };
    post.sponsored = { spend: s.spend + total.spend, impressions: s.impressions + total.impressions };
    post.adLink = link.by === 'manual' ? 'manual' : 'rule';
    touched.set(key, post);
    applied.add(link.ad_id);
  }
  return { touched: [...touched.values()], applied };
}
