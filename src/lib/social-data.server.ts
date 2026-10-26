import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import type { Metrics } from './windsor-mapping';
import type { SocialDay, SocialPost, SocialAd, AdCoverage } from './social-totals';
import { mergeStories, type SocialStory, type StoryPull } from './social-stories';
import { paidOnlyAds } from './top-posts';
import { applyRuleLinks, groupUnlinkedAds, linkAdsToPosts, parseAdNameDate, LINK_PLATFORMS, type TwinAd } from './ad-post-link';
import { THUMBNAIL_BUCKET } from './windsor-config';
import { client } from './client';
import { mergeFollowerHistory } from './social-followers';
import { mergeOrganicHistory, type ManualOrganicDay } from './social-organic-history';
export type PeriodInput = { start: string; end: string };
const POST_COLUMNS = 'platform,post_id,published_at,title,format,permalink,thumbnail_path,metrics';
const dayBefore = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
type Page<T> = PromiseLike<{ data: T[] | null; error: unknown }>;
/** Reads every page (1 000 rows) of a query; any failed page fails the read. */
async function readAll<T>(page: (from: number, to: number) => Page<T>, failure: string): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await page(offset, offset + 999);
    if (r.error || !r.data) throw new Error(failure, { cause: r.error });
    out.push(...r.data);
    if (r.data.length < 1000) return out;
  }
}
type Sponsored = { spend: number; impressions: number };
/** Lifetime delivery of the ads natively linked to the given posts (ad × post × day), per `platform:post_id`. */
async function loadSponsored(db: SupabaseClient<Database>, postIds: string[]): Promise<Map<string, Sponsored>> {
  const out = new Map<string, Sponsored>();
  const ids = [...new Set(postIds)];
  for (let i = 0; i < ids.length; i += 150) {
    for (let offset = 0; ; offset += 1000) {
      const r = await db.from('social_post_ad_daily').select('platform,post_id,spend,impressions').in('post_id', ids.slice(i, i + 150)).order('platform').order('post_id').order('ad_id').order('day').range(offset, offset + 999);
      if (r.error) throw new Error('Lecture des publications sponsorisées impossible');
      for (const row of r.data) { const k = `${row.platform}:${row.post_id}`, o = out.get(k) ?? { spend: 0, impressions: 0 }; out.set(k, { spend: o.spend + Number(row.spend), impressions: o.impressions + Number(row.impressions) }); }
      if (r.data.length < 1000) break;
    }
  }
  return out;
}
/** Table absente (migration pas encore passée) : PostgREST répond PGRST205 (ou 42P01 côté Postgres). */
const isMissingTable = (error: unknown) => ['PGRST205', '42P01'].includes((error as { cause?: { code?: string } }).cause?.code ?? '');
const toNumber = (v: unknown) => (v == null ? null : Number(v));
const toStory = (d: Record<string, unknown>): SocialStory => ({
  platform: String(d['platform']), story_id: String(d['story_id']), published_at: String(d['published_at']),
  views: toNumber(d['views']), reach: toNumber(d['reach']), replies: toNumber(d['replies']), shares: toNumber(d['shares']), interactions: toNumber(d['interactions']),
});
const STORY_COLUMNS = 'platform,story_id,published_at,views,reach,replies,shares,interactions';
/**
 * Stories Instagram : relevé en direct (migration 0013) et historique importé des exports Meta avec ses fenêtres de couverture (migration 0014), fusionnés par identifiant
 * (le plus grand chiffre connu). Chaque partie est optionnelle : une table absente est un suivi non actif, sans bruit ; toute autre erreur est dite « momentanément
 * indisponible » (storiesFailed), journalisée, et le résultat n'est pas gardé en cache. Marge d'un jour de chaque côté : le jour d'une story est celui de Paris, la lecture se fait en UTC.
 */
async function loadStories(db: SupabaseClient<Database>, ranges: PeriodInput[]) {
  // Les stories sont propres à Instagram : sans cet onglet, aucune lecture.
  if (!(client.networks as string[]).includes('instagram')) return { stories: [] as SocialStory[], storyPulls: [] as StoryPull[], storiesFailed: false };
  const optional = db as unknown as SupabaseClient;
  const live: SocialStory[] = [], history: SocialStory[] = [], storyPulls: StoryPull[] = [];
  let storiesFailed = false;
  const storiesIn = (table: string) => Promise.all(ranges.map(r => readAll((a, b) => optional.from(table).select(STORY_COLUMNS).gte('published_at', `${dayBefore(r.start, 1)}T00:00:00Z`).lte('published_at', `${dayBefore(r.end, -1)}T23:59:59.999Z`).order('platform').order('story_id').range(a, b), 'Lecture des stories impossible')));
  const part = async (label: string, read: () => Promise<void>) => {
    try { await read(); } catch (error) {
      if (isMissingTable(error)) return;
      storiesFailed = true;
      console.warn(`social-data: lecture des stories impossible (${label})`, error instanceof Error ? error.message : error, (error as { cause?: { code?: string } }).cause?.code ?? '');
    }
  };
  await Promise.all([
    part('relevé', async () => {
      const [rows, pulls] = await Promise.all([
        storiesIn('social_stories'),
        Promise.all(ranges.map(r => readAll((a, b) => optional.from('social_story_coverage').select('platform,day,pulls,max_gap_minutes').gte('day', r.start).lte('day', dayBefore(r.end, -1)).order('platform').order('day').range(a, b), 'Lecture du suivi des stories impossible'))),
      ]);
      live.push(...rows.flat().map(toStory));
      storyPulls.push(...pulls.flat().map((d: Record<string, unknown>) => ({ platform: String(d['platform']), day: String(d['day']).slice(0, 10), pulls: Number(d['pulls'] ?? 0), maxGapMinutes: toNumber(d['max_gap_minutes']) })));
    }),
    part('historique', async () => {
      const [rows, windows] = await Promise.all([
        storiesIn('social_story_history'),
        readAll((a, b) => optional.from('social_story_history_windows').select('platform,start_day,end_day,level').order('platform').order('start_day').range(a, b), 'Lecture de la couverture de l’historique des stories impossible'),
      ]);
      history.push(...rows.flat().map(toStory));
      // Une fenêtre d'historique voyage comme une entrée de couverture : `day` = premier jour, `through` = dernier (voir StoryPull).
      storyPulls.push(...windows.map((d: Record<string, unknown>) => ({ platform: String(d['platform']), day: String(d['start_day']).slice(0, 10), through: String(d['end_day']).slice(0, 10), pulls: 1, level: d['level'] === 'partial' ? 'partial' as const : 'complete' as const })));
    }),
  ]);
  return { stories: mergeStories(live, history), storyPulls, storiesFailed };
}
const cache = new Map<string, { at: number; value: Awaited<ReturnType<typeof computeSocialData>> }>();
/** Vide le cache (tests). */
export const resetSocialDataCache = () => cache.clear();
/**
 * Les données ne changent qu'à la synchronisation (une fois par nuit) : le résultat d'une même demande est gardé 2 minutes
 * (SOCIAL_DATA_CACHE_MS, 0 pour désactiver) afin de ne pas relire tout l'historique à chaque changement de période.
 */
export async function loadSocialData(data: { period: PeriodInput; comparison: PeriodInput; fresh?: boolean | undefined }) {
  const ttl = Number(process.env['SOCIAL_DATA_CACHE_MS'] ?? 120_000);
  const key = JSON.stringify([data.period, data.comparison]);
  const hit = cache.get(key);
  if (!data.fresh && ttl > 0 && hit && Date.now() - hit.at < ttl) return hit.value;
  let value: Awaited<ReturnType<typeof computeSocialData>>;
  try {
    value = await computeSocialData({ period: data.period, comparison: data.comparison });
  } catch (error) {
    // Le navigateur ne voit que « Source indisponible » : le journal serveur garde la cause (jamais l'adresse ni la clé).
    console.error('social-data: lecture impossible', error instanceof Error ? error.message : error, (error as { cause?: { code?: string } }).cause?.code ?? '');
    throw error;
  }
  // Un résultat dont la lecture des stories a échoué n'est pas gardé : la prochaine demande réessaie.
  if (ttl > 0 && !value.storiesFailed) {
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 12) cache.delete(cache.keys().next().value as string);
  }
  return value;
}
async function computeSocialData(data: { period: PeriodInput; comparison: PeriodInput }) {
    const url = process.env['SUPABASE_URL'], key = process.env['SUPABASE_PUBLISHABLE_KEY'];
    if (!url || !key) throw new Error('Données temporairement indisponibles');
    const db = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      if (key.startsWith('sb_') && headers.get('Authorization') === `Bearer ${key}`) headers.delete('Authorization');
      headers.set('apikey', key); return fetch(input, { ...init, headers });
    } } });
    const ranges = [data.period, data.comparison];
    // Independent reads run together; every table is read page by page (1 000 rows) on a unique ordering.
    const adDaysRead = readAll(
      (a, b) => db.from('social_ad_creative_daily').select('platform,ad_id,day,post_id,spend,impressions,likes,comments,shares').gte('day', data.period.start).lte('day', data.period.end).order('platform').order('ad_id').order('day').range(a, b),
      'Lecture des publicités impossible',
    );
    const [rawDays, manual, organicHistory, adRows, coverageRows, postRows, adDaysRaw] = await Promise.all([
      // Full stored daily history supports month-end audience and within-period follower changes.
      readAll((a, b) => db.from('social_daily').select('platform,source,day,metrics,followers_estimated').order('platform').order('source').order('day').range(a, b), 'Lecture de l’historique impossible'),
      readAll((a, b) => db.from('social_follower_history').select('*').order('platform').order('day').range(a, b), 'Lecture de l’historique manuel impossible'),
      readAll((a, b) => db.from('social_organic_history').select('platform,day,organic_views,paid_views,organic_impressions,organic_video_views,organic_likes,organic_comments,organic_shares,posts_published').order('platform').order('day').range(a, b), 'Lecture de l’historique organique impossible'),
      Promise.all(ranges.map(r => readAll((a, b) => db.from('social_ad_daily').select('source,platform,ad_id,day,impressions').gte('day', r.start).lte('day', r.end).order('source').order('platform').order('ad_id').order('day').range(a, b), 'Lecture des annonces impossible'))),
      Promise.all(ranges.map(r => readAll((a, b) => db.from('social_ad_coverage').select('source,day').gte('day', r.start).lte('day', r.end).order('source').order('day').range(a, b), 'Lecture de la couverture des annonces impossible'))),
      Promise.all(ranges.map(r => readAll((a, b) => db.from('social_posts').select(POST_COLUMNS).gte('published_at', `${r.start}T00:00:00Z`).lte('published_at', `${r.end}T23:59:59.999Z`).order('platform').order('post_id').range(a, b), 'Lecture des publications impossible'))),
      adDaysRead,
    ]);
    const days: SocialDay[] = rawDays.map(d => ({ ...d, metrics: d.metrics as Metrics }));
    const ads: SocialAd[] = adRows.flat(), adCoverage: AdCoverage[] = coverageRows.flat();
    const posts: SocialPost[] = postRows.flat().map(d => ({ ...d, permalink: d.permalink ?? '', metrics: d.metrics as Metrics }));
    // Ad × day delivery of the selected period (read with the others: it tells which posts are promoted during the period).
    const adDays = adDaysRaw.map(d => ({ ...d, spend: Number(d.spend), impressions: Number(d.impressions), likes: d.likes == null ? null : Number(d.likes), comments: d.comments == null ? null : Number(d.comments), shares: d.shares == null ? null : Number(d.shares) }));
    const adPostIds = [...new Set(adDays.map(a => a.post_id).filter((x): x is string => Boolean(x)))];
    // Stored publications referenced by the ads, with their publication date (any date).
    const known = new Map<string, string>();
    for (let i = 0; i < adPostIds.length; i += 150) {
      const r = await db.from('social_posts').select('platform,post_id,published_at').in('post_id', adPostIds.slice(i, i + 150));
      if (r.error) throw new Error('Lecture des publications impossible');
      for (const x of r.data) known.set(`${x.platform}:${x.post_id}`, x.published_at);
    }
    const inPeriod = (iso: string) => iso.slice(0, 10) >= data.period.start && iso.slice(0, 10) <= data.period.end;
    const periodKeys = new Set(posts.filter(p => inPeriod(p.published_at)).map(p => `${p.platform}:${p.post_id}`));
    // Publications promoted during the period but published before it: shown in Top publications with their budget.
    const promoted: SocialPost[] = [];
    try {
      const missing = [...known.keys()].filter(k => !periodKeys.has(k));
      const ids = [...new Set(missing.map(k => k.slice(k.indexOf(':') + 1)))];
      for (let i = 0; i < ids.length; i += 150) {
        const r = await db.from('social_posts').select(POST_COLUMNS).in('post_id', ids.slice(i, i + 150));
        if (r.error) throw new Error('Lecture des publications promues impossible');
        for (const d of r.data) if (missing.includes(`${d.platform}:${d.post_id}`)) promoted.push({ ...d, permalink: d.permalink ?? '', metrics: d.metrics as Metrics });
      }
    } catch { promoted.length = 0; }
    // Lifetime sponsored delivery of the displayed posts (budget/CPM per post).
    const sponsored = await loadSponsored(db, [...posts, ...promoted].map(p => p.post_id));
    for (const post of [...posts, ...promoted]) { const s = sponsored.get(`${post.platform}:${post.post_id}`); if (s) post.sponsored = s; }
    const adIds = [...new Set(adDays.map(a => a.ad_id))];
    const creatives: { platform: string; ad_id: string; ad_name: string | null; thumbnail_path: string | null; thumbnail_url?: string }[] = [];
    for (let i = 0; i < adIds.length; i += 150) {
      const r = await db.from('social_ad_creatives').select('platform,ad_id,ad_name,thumbnail_path').in('ad_id', adIds.slice(i, i + 150));
      if (r.error) throw new Error('Lecture des créatives impossible');
      creatives.push(...r.data);
    }
    // Ads with no stored organic publication ("Paid" rows: dark posts / ad-only creatives) for the selected period.
    // Une annonce issue d'un post Instagram peut diffuser sur Facebook : le lien à la publication se lit par son identifiant, pas par le placement.
    const knownIds = new Set([...known.keys()].map(k => k.slice(k.indexOf(':') + 1)));
    const linkedRows = new Set(adDays.filter(d => d.post_id && knownIds.has(d.post_id)).map(d => `${d.platform}:${d.post_id}`));
    let paidAds = paidOnlyAds(adDays, creatives, linkedRows);
    const adLinking = { rule: 0, manual: 0, unlinked: 0 };
    // Automatic organic ↔ paid link for Meta ads (Instagram ads never carry the organic media id): see ad-post-link.ts.
    // An enhancement only: on any failure the ads simply stay "Paid" rows.
    try {
      // Corrections manuelles (table optionnelle) : un lien forcé, ou « jamais rattacher » (post_id vide) qui garde l'annonce en « Paid ».
      const manualRows: { ad_id: string; post_platform: string | null; post_id: string | null }[] = [];
      try {
        const r = await (db as unknown as SupabaseClient).from('social_ad_post_links').select('ad_id,post_platform,post_id');
        if (!r.error && Array.isArray(r.data)) manualRows.push(...r.data);
      } catch { /* table absente : pas de correction */ }
      const refused = new Set(manualRows.filter(m => !m.post_id).map(m => m.ad_id));
      const forced = new Map(manualRows.filter(m => m.post_id && m.post_platform).map(m => [m.ad_id, { platform: m.post_platform as string, post_id: m.post_id as string }]));
      const metaAds = groupUnlinkedAds(paidAds).filter(a => a.platforms.some(p => LINK_PLATFORMS.includes(p)));
      const unlinked = metaAds.filter(a => !refused.has(a.ad_id));
      if (unlinked.length) {
        // Without a date in the name, the text window starts at the first day the ad ever delivered (not at the first day of the displayed period):
        // the link then no longer depends on the period. One light read per undated ad.
        const lifetimeFirst = new Map<string, string>();
        await Promise.all(unlinked.filter(a => parseAdNameDate(a.name) === null).map(async a => {
          const r = await db.from('social_ad_creative_daily').select('day').eq('ad_id', a.ad_id).order('day').limit(1);
          if (r.error) throw new Error('Lecture du premier jour de diffusion impossible');
          const day = r.data[0]?.day;
          if (day && day < a.first_day) lifetimeFirst.set(a.ad_id, day);
        }));
        const anchored = unlinked.map(a => lifetimeFirst.has(a.ad_id) ? { ...a, first_day: lifetimeFirst.get(a.ad_id)! } : a);
        const candidates: SocialPost[] = [];
        // Candidates reach back 61 days before the period (Paris midnight is the previous UTC day), to the day before each date written in an ad name,
        // and to the start of the text window (45 days before the first delivery) of undated ads.
        const lower = [
          dayBefore(data.period.start, 61),
          ...anchored.map(a => { const d = parseAdNameDate(a.name); return d ? dayBefore(d, 1) : dayBefore(a.first_day, 46); }),
        ].sort()[0];
        for (let offset = 0; ; offset += 1000) {
          const r = await db.from('social_posts').select(POST_COLUMNS).in('platform', LINK_PLATFORMS).gte('published_at', `${lower}T00:00:00Z`).lte('published_at', `${data.period.end}T23:59:59.999Z`).order('platform').order('post_id').range(offset, offset + 999);
          if (r.error) throw new Error('Lecture des publications candidates impossible');
          candidates.push(...r.data.map(d => ({ ...d, permalink: d.permalink ?? '', metrics: d.metrics as Metrics })));
          if (r.data.length < 1000) break;
        }
        // Twin guard: ads already linked natively tell where their twin (same name, other suffix) must point.
        const publishedById = new Map([...known].map(([k, v]) => [k.slice(k.indexOf(':') + 1), v]));
        const twins: TwinAd[] = [], twinSeen = new Set<string>();
        for (const d of adDays) {
          const published = d.post_id ? publishedById.get(d.post_id) : undefined;
          const name = creatives.find(c => c.platform === d.platform && c.ad_id === d.ad_id)?.ad_name;
          if (published && name && !twinSeen.has(d.ad_id)) { twinSeen.add(d.ad_id); twins.push({ name, published_at: published }); }
        }
        const links = linkAdsToPosts(anchored.filter(a => !forced.has(a.ad_id)), candidates.map(c => ({ platform: c.platform, post_id: c.post_id, published_at: c.published_at, title: c.title })), twins);
        // Liens forcés à la main : prioritaires sur la règle ; la publication visée est lue si elle n'est pas déjà parmi les candidates.
        const wanted = [...forced].filter(([ad_id]) => unlinked.some(a => a.ad_id === ad_id));
        const missingTargets = wanted.map(([, t]) => t.post_id).filter(id => !candidates.some(c => c.post_id === id));
        if (missingTargets.length) {
          const r = await db.from('social_posts').select(POST_COLUMNS).in('post_id', [...new Set(missingTargets)]);
          if (r.error) throw new Error('Lecture des publications corrigées impossible');
          candidates.push(...r.data.map(d => ({ ...d, permalink: d.permalink ?? '', metrics: d.metrics as Metrics })));
        }
        for (const [ad_id, t] of wanted) if (candidates.some(c => c.platform === t.platform && c.post_id === t.post_id)) links.set(ad_id, { ad_id, platform: t.platform, post_id: t.post_id, by: 'manual' });
        if (links.size) {
          // Posts found only among the candidates (older than the period): read their own native budget first, so the rule never replaces it.
          const loaded = new Set([...posts, ...promoted].map(p => `${p.platform}:${p.post_id}`));
          const targets = [...new Set([...links.values()].map(l => `${l.platform}:${l.post_id}`))].filter(k => !loaded.has(k));
          if (targets.length) {
            const native = await loadSponsored(db, targets.map(k => k.slice(k.indexOf(':') + 1)));
            for (const c of candidates) { const n = native.get(`${c.platform}:${c.post_id}`); if (n && targets.includes(`${c.platform}:${c.post_id}`)) c.sponsored = n; }
          }
          // Lifetime delivery of the linked ads, all placements together, except the rows already attributed to a stored post
          // (their budget is the native one of that post: counting it again would double it).
          const rows: { ad_id: string; platform: string; post_id: string | null; spend: number; impressions: number }[] = [];
          const linkedIds = [...links.keys()];
          for (let i = 0; i < linkedIds.length; i += 150) {
            for (let offset = 0; ; offset += 1000) {
              const r = await db.from('social_ad_creative_daily').select('ad_id,platform,post_id,spend,impressions').in('ad_id', linkedIds.slice(i, i + 150)).order('ad_id').order('platform').order('day').range(offset, offset + 999);
              if (r.error) throw new Error('Lecture de la diffusion des annonces impossible');
              rows.push(...r.data.map(d => ({ ...d, spend: Number(d.spend), impressions: Number(d.impressions) })));
              if (r.data.length < 1000) break;
            }
          }
          const rowPostIds = [...new Set(rows.map(r => r.post_id).filter((x): x is string => Boolean(x)))];
          const stored = new Set<string>();
          for (let i = 0; i < rowPostIds.length; i += 150) {
            const r = await db.from('social_posts').select('post_id').in('post_id', rowPostIds.slice(i, i + 150));
            if (r.error) throw new Error('Lecture des publications impossible');
            for (const x of r.data) stored.add(x.post_id);
          }
          const totals = new Map<string, Sponsored>();
          for (const row of rows) {
            if (row.post_id && stored.has(row.post_id)) continue;
            const o = totals.get(row.ad_id) ?? { spend: 0, impressions: 0 };
            totals.set(row.ad_id, { spend: o.spend + row.spend, impressions: o.impressions + row.impressions });
          }
          const { touched, applied } = applyRuleLinks(links, totals, [...posts, ...promoted], candidates);
          for (const id of applied) { if (links.get(id)?.by === 'manual') adLinking.manual++; else adLinking.rule++; }
          for (const post of touched) if (!inPeriod(post.published_at) && !promoted.some(x => x.platform === post.platform && x.post_id === post.post_id)) promoted.push(post);
          paidAds = paidAds.filter(a => !applied.has(a.ad_id));
        }
      }
    } catch { /* les annonces restent des lignes « Paid » */ }
    adLinking.unlinked = new Set(paidAds.filter(a => LINK_PLATFORMS.includes(a.platform)).map(a => a.ad_id)).size;
    // Stored images only; never return expiring provider images or credentials.
    const shown = [...posts, ...promoted];
    const paths = shown.map(p => p.thumbnail_path).filter((p): p is string => Boolean(p));
    const signed = paths.length ? await db.storage.from(THUMBNAIL_BUCKET).createSignedUrls(paths, 3600) : null;
    const urls = new Map(signed?.data?.map(s => [s.path, s.signedUrl]) ?? []);
    for (const post of shown) post.thumbnail_url = urls.get(post.thumbnail_path ?? '') ?? '';
    const cPaths = creatives.map(c => c.thumbnail_path).filter((p): p is string => Boolean(p));
    const cSigned = cPaths.length ? await db.storage.from(THUMBNAIL_BUCKET).createSignedUrls(cPaths, 3600) : null;
    const cUrls = new Map(cSigned?.data?.map(s => [s.path, s.signedUrl]) ?? []);
    for (const c of creatives) c.thumbnail_url = cUrls.get(c.thumbnail_path ?? '') ?? '';
    // Paid rows were built before the creatives' images were signed: attach them now.
    for (const a of paidAds) { const c = creatives.find(x => x.platform === a.platform && x.ad_id === a.ad_id); a.thumbnail_url = c?.thumbnail_url ?? ''; }
    const { stories, storyPulls, storiesFailed } = await loadStories(db, ranges);
    const audience = await db.from('social_audience').select('platform,dimension,label,value,unit');
    if (audience.error) throw new Error('Lecture de l’audience impossible');
    const status = await db.from('social_sync_status').select('source,state,last_success_at');
    if (status.error) throw new Error('État des sources indisponible');
    return { days:mergeFollowerHistory(mergeOrganicHistory(days,organicHistory),manual), posts, promotedPosts: promoted, paidAds, adLinking, ads, adCoverage, stories, storyPulls, storiesFailed, audience: audience.data, statuses: status.data };
}
