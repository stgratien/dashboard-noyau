import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * loadSocialData against an in-memory fake of the Supabase client: the organic ↔ paid linking of the Top publications
 * (native links first, then the rule on the ad name) is orchestrated there, around the pure functions of ad-post-link.ts.
 */
type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, failOn: null as null | ((table: string, ops: string[]) => boolean), failCode: undefined as string | undefined }));

vi.mock('@supabase/supabase-js', () => {
  class Query {
    private rows: Row[]; private ops: string[] = []; private orderBy: string[] = []; private from = 0; private to = Infinity;
    constructor(private table: string) { this.rows = [...(state.tables[table] ?? [])]; }
    private op(name: string, col?: unknown) { this.ops.push(col ? `${name}:${String(col)}` : name); return this; }
    select() { return this; }
    eq(col: string, v: unknown) { this.op('eq', col); this.rows = this.rows.filter(r => r[col] === v); return this; }
    in(col: string, vs: unknown[]) { this.op('in', col); this.rows = this.rows.filter(r => vs.includes(r[col])); return this; }
    gte(col: string, v: string) { this.op('gte', col); this.rows = this.rows.filter(r => String(r[col]) >= v); return this; }
    lte(col: string, v: string) { this.op('lte', col); this.rows = this.rows.filter(r => String(r[col]) <= v); return this; }
    lt(col: string, v: string) { this.op('lt', col); this.rows = this.rows.filter(r => String(r[col]) < v); return this; }
    not() { return this; }
    order(col: string) { this.orderBy.push(col); return this; }
    limit(n: number) { this.to = this.from + n - 1; return this; }
    range(a: number, b: number) { this.from = a; this.to = b; return this; }
    then(resolve: (v: { data: Row[] | null; error: unknown }) => unknown) {
      if (state.failOn?.(this.table, this.ops)) return resolve({ data: null, error: { message: 'boom', ...(state.failCode ? { code: state.failCode } : {}) } });
      const sorted = [...this.rows].sort((x, y) => { for (const c of this.orderBy) { const d = String(x[c] ?? '').localeCompare(String(y[c] ?? '')); if (d) return d; } return 0; });
      return resolve({ data: sorted.slice(this.from, this.to + 1), error: null });
    }
  }
  const client = {
    from: (table: string) => new Query(table),
    storage: { from: () => ({ createSignedUrls: async (paths: string[]) => ({ data: paths.map(path => ({ path, signedUrl: `https://signed.test/${path}` })), error: null }) }) },
  };
  return { createClient: () => client };
});

// The code under test reads the client configuration (ad-name stop words, enabled networks): use the neutral one, never the real client's.
vi.mock('@/client/config', async () => (await import('@/test/fixtures/neutral-client')).neutralClientModule());

import { loadSocialData, resetSocialDataCache } from '@/lib/social-data.server';

const period = { start: '2026-10-01', end: '2026-10-31' };
const comparison = { start: '2026-09-01', end: '2026-09-30' };
const post = (platform: string, post_id: string, published_at: string, title: string, extra: Row = {}) => ({ platform, post_id, published_at, title, format: 'Photo', permalink: `https://www.${platform}.com/p/${post_id}/`, thumbnail_path: null, metrics: { impressions: 1000, likes: 10, comments: 1, shares: 1 }, ...extra });
const creativeDay = (platform: string, ad_id: string, day: string, post_id: string | null, spend: number, impressions: number) => ({ source: 'facebook', platform, ad_id, day, post_id, spend, impressions, likes: null, comments: null, shares: null });
const nativeDay = (platform: string, ad_id: string, post_id: string, day: string, spend: number, impressions: number) => ({ source: 'facebook', platform, ad_id, post_id, day, spend, impressions });

beforeEach(() => {
  process.env['SUPABASE_URL'] = 'https://fake.supabase.test';
  process.env['SUPABASE_PUBLISHABLE_KEY'] = 'sb_publishable_fake';
  process.env['SOCIAL_DATA_CACHE_MS'] = '0';
  resetSocialDataCache();
  state.failOn = null;
  state.failCode = undefined;
  state.tables = {
    social_daily: [], social_follower_history: [], social_organic_history: [], social_ad_daily: [], social_ad_coverage: [],
    social_posts: [], social_post_ad_daily: [], social_ad_creative_daily: [], social_ad_creatives: [], social_audience: [], social_sync_status: [], social_ad_post_links: [],
  };
});

describe('loadSocialData: organic ↔ paid linking', () => {
  it('links an ad without a stored post to the post of the date in its name and moves it out of the Paid rows', async () => {
    state.tables['social_posts'] = [post('instagram', 'ig-oct4', '2026-10-04T08:00:00Z', 'Une semaine de l’espace'), post('instagram', 'ig-oct9', '2026-10-09T08:00:00Z', 'Autre')];
    state.tables['social_ad_creatives'] = [{ platform: 'instagram', ad_id: 'X', ad_name: '04102026_post1semainedelespace_IG', thumbnail_path: null }];
    state.tables['social_ad_creative_daily'] = [creativeDay('instagram', 'X', '2026-10-06', 'dark_media', 30, 3000), creativeDay('instagram', 'X', '2026-09-30', 'dark_media', 12, 1200)];
    const r = await loadSocialData({ period, comparison });
    const linked = r.posts.find(p => p.post_id === 'ig-oct4')!;
    expect(linked.sponsored).toEqual({ spend: 42, impressions: 4200 });
    expect(linked.adLink).toBe('rule');
    expect(r.posts.find(p => p.post_id === 'ig-oct9')?.sponsored).toBeUndefined();
    expect(r.paidAds).toEqual([]);
    expect(r.promotedPosts).toEqual([]);
  });

  it('does not count twice the delivery already attributed natively to a stored post (Instagram placement native, Facebook placement dark)', async () => {
    state.tables['social_posts'] = [post('instagram', 'P', '2026-10-04T08:00:00Z', 'Une semaine de l’espace')];
    state.tables['social_ad_creatives'] = [{ platform: 'instagram', ad_id: 'X', ad_name: '04102026_semaine_IG', thumbnail_path: null }, { platform: 'facebook', ad_id: 'X', ad_name: '04102026_semaine_IG', thumbnail_path: null }];
    state.tables['social_ad_creative_daily'] = [creativeDay('instagram', 'X', '2026-10-06', 'P', 100, 10000), creativeDay('facebook', 'X', '2026-10-06', 'dark_story', 40, 4000)];
    state.tables['social_post_ad_daily'] = [nativeDay('instagram', 'X', 'P', '2026-10-06', 100, 10000)];
    const r = await loadSocialData({ period, comparison });
    expect(r.posts.find(p => p.post_id === 'P')?.sponsored).toEqual({ spend: 140, impressions: 14000 });
    expect(r.paidAds).toEqual([]);
  });

  it('keeps the native budget of an older post found by the rule, and lists it as a promoted post', async () => {
    state.tables['social_posts'] = [post('facebook', 'Q', '2026-08-20T08:00:00Z', 'Les hélicoptères', { thumbnail_path: 'facebook/Q.image' })];
    state.tables['social_ad_creatives'] = [{ platform: 'facebook', ad_id: 'X2', ad_name: '20082026_helicopteres_FB', thumbnail_path: null }];
    state.tables['social_ad_creative_daily'] = [creativeDay('facebook', 'X2', '2026-10-05', 'dark_story', 30, 3000)];
    state.tables['social_post_ad_daily'] = [nativeDay('facebook', 'A1', 'Q', '2026-08-25', 80, 8000)];
    const r = await loadSocialData({ period, comparison });
    expect(r.promotedPosts.map(p => p.post_id)).toEqual(['Q']);
    expect(r.promotedPosts[0]?.sponsored).toEqual({ spend: 110, impressions: 11000 });
    expect(r.promotedPosts[0]?.thumbnail_url).toBe('https://signed.test/facebook/Q.image');
    expect(r.paidAds).toEqual([]);
  });

  it('lists a post published before the period that natively carries an ad delivering in the period', async () => {
    state.tables['social_posts'] = [post('instagram', 'old', '2026-09-10T08:00:00Z', 'Ancienne')];
    state.tables['social_ad_creatives'] = [{ platform: 'instagram', ad_id: 'N', ad_name: 'Boost', thumbnail_path: null }];
    state.tables['social_ad_creative_daily'] = [creativeDay('instagram', 'N', '2026-10-03', 'old', 25, 5000)];
    state.tables['social_post_ad_daily'] = [nativeDay('instagram', 'N', 'old', '2026-10-03', 25, 5000)];
    const r = await loadSocialData({ period, comparison });
    expect(r.promotedPosts.map(p => p.post_id)).toEqual(['old']);
    expect(r.promotedPosts[0]?.sponsored).toEqual({ spend: 25, impressions: 5000 });
    expect(r.paidAds).toEqual([]);
  });

  it('links by identifier an Instagram-sourced ad whose Facebook placement row carries the Instagram media id', async () => {
    state.tables['social_posts'] = [post('instagram', '17000000000001', '2026-09-30T08:00:00Z', 'Sans moi, les équipements')];
    state.tables['social_ad_creatives'] = [{ platform: 'facebook', ad_id: 'N', ad_name: '30092026_Jesuis1_IG+FB', thumbnail_path: null }, { platform: 'instagram', ad_id: 'N', ad_name: '30092026_Jesuis1_IG+FB', thumbnail_path: null }];
    state.tables['social_ad_creative_daily'] = [creativeDay('facebook', 'N', '2026-10-06', '17000000000001', 25, 43000), creativeDay('instagram', 'N', '2026-10-06', '17000000000001', 1, 225)];
    state.tables['social_post_ad_daily'] = [nativeDay('instagram', 'N', '17000000000001', '2026-10-06', 26, 43225)];
    const r = await loadSocialData({ period, comparison });
    expect(r.paidAds).toEqual([]);
    expect(r.promotedPosts.map(p => p.post_id)).toEqual(['17000000000001']);
    expect(r.promotedPosts[0]?.sponsored).toEqual({ spend: 26, impressions: 43225 });
    expect(r.promotedPosts[0]?.adLink).toBeUndefined();
  });

  it('keeps unmatched ads as Paid rows with their creative image and an organic-looking facebook link only for Facebook', async () => {
    state.tables['social_ad_creatives'] = [{ platform: 'facebook', ad_id: 'F', ad_name: 'Annonce libre', thumbnail_path: 'facebook/F.jpg' }, { platform: 'tiktok', ad_id: 'T', ad_name: 'TikTok pub', thumbnail_path: null }];
    state.tables['social_ad_creative_daily'] = [creativeDay('facebook', 'F', '2026-10-05', '12345678901234_56789012345678', 20, 2000), creativeDay('tiktok', 'T', '2026-10-05', null, 15, 1500)];
    const r = await loadSocialData({ period, comparison });
    const fb = r.paidAds.find(a => a.ad_id === 'F')!;
    expect(fb.permalink).toBe('https://www.facebook.com/12345678901234/posts/56789012345678');
    expect(fb.thumbnail_url).toBe('https://signed.test/facebook/F.jpg');
    expect(r.paidAds.find(a => a.ad_id === 'T')?.permalink).toBe('');
  });

  it('reaches posts older than the 60-day window when the ad name carries the date', async () => {
    state.tables['social_posts'] = [post('instagram', 'ig-jun1', '2026-06-01T08:00:00Z', 'Teaser de juin')];
    state.tables['social_ad_creatives'] = [{ platform: 'instagram', ad_id: 'X', ad_name: '01062026_teaser_IG', thumbnail_path: null }];
    state.tables['social_ad_creative_daily'] = [creativeDay('instagram', 'X', '2026-10-06', 'dark', 30, 3000)];
    const r = await loadSocialData({ period, comparison });
    expect(r.promotedPosts.map(p => p.post_id)).toEqual(['ig-jun1']);
    expect(r.promotedPosts[0]?.sponsored).toEqual({ spend: 30, impressions: 3000 });
    expect(r.paidAds).toEqual([]);
  });

  it('anchors an undated ad on its first delivery day ever, so the link does not depend on the displayed period', async () => {
    state.tables['social_posts'] = [post('instagram', 'ig-jul', '2026-07-25T08:00:00Z', 'Les hélicoptères militaires')];
    state.tables['social_ad_creatives'] = [{ platform: 'instagram', ad_id: 'U', ad_name: 'Hélicoptères militaires', thumbnail_path: null }];
    state.tables['social_ad_creative_daily'] = [creativeDay('instagram', 'U', '2026-08-01', 'dark', 20, 2000), creativeDay('instagram', 'U', '2026-10-10', 'dark', 30, 3000)];
    const r = await loadSocialData({ period, comparison });
    expect(r.promotedPosts.map(p => p.post_id)).toEqual(['ig-jul']);
    expect(r.promotedPosts[0]?.sponsored).toEqual({ spend: 50, impressions: 5000 });
    expect(r.paidAds).toEqual([]);
    // A period that starts before the ad and covers its first day gives the same link.
    const wide = await loadSocialData({ period: { start: '2026-07-20', end: '2026-10-31' }, comparison });
    expect(wide.posts.find(p => p.post_id === 'ig-jul')?.sponsored).toEqual({ spend: 50, impressions: 5000 });
  });

  it('applies a manual correction before the rule, and keeps a refused ad as a Paid row', async () => {
    state.tables['social_posts'] = [post('instagram', 'ig-oct4', '2026-10-04T08:00:00Z', 'Une semaine de l’espace'), post('instagram', 'ig-oct9', '2026-10-09T08:00:00Z', 'Autre sujet')];
    state.tables['social_ad_creatives'] = [{ platform: 'instagram', ad_id: 'X', ad_name: '04102026_semaine_IG', thumbnail_path: null }, { platform: 'instagram', ad_id: 'Y', ad_name: '04102026_autre_IG', thumbnail_path: null }];
    state.tables['social_ad_creative_daily'] = [creativeDay('instagram', 'X', '2026-10-06', 'dark1', 30, 3000), creativeDay('instagram', 'Y', '2026-10-06', 'dark2', 12, 1200)];
    // X would match ig-oct4 by the rule: the correction sends it to ig-oct9. Y is refused: it stays Paid.
    state.tables['social_ad_post_links'] = [{ ad_id: 'X', post_platform: 'instagram', post_id: 'ig-oct9' }, { ad_id: 'Y', post_platform: null, post_id: null }];
    const r = await loadSocialData({ period, comparison });
    expect(r.posts.find(p => p.post_id === 'ig-oct9')?.sponsored).toEqual({ spend: 30, impressions: 3000 });
    expect(r.posts.find(p => p.post_id === 'ig-oct9')?.adLink).toBe('manual');
    expect(r.posts.find(p => p.post_id === 'ig-oct4')?.sponsored).toBeUndefined();
    expect(r.paidAds.map(a => a.ad_id)).toEqual(['Y']);
    expect(r.adLinking).toEqual({ rule: 0, manual: 1, unlinked: 1 });
  });

  it('counts the rule links and the ads left alone, and works without the corrections table', async () => {
    state.tables['social_posts'] = [post('instagram', 'ig-oct4', '2026-10-04T08:00:00Z', 'Une semaine de l’espace')];
    state.tables['social_ad_creatives'] = [{ platform: 'instagram', ad_id: 'X', ad_name: '04102026_semaine_IG', thumbnail_path: null }, { platform: 'instagram', ad_id: 'Z', ad_name: 'Sans rapport', thumbnail_path: null }];
    state.tables['social_ad_creative_daily'] = [creativeDay('instagram', 'X', '2026-10-06', 'dark1', 30, 3000), creativeDay('instagram', 'Z', '2026-10-06', 'dark3', 5, 500)];
    delete state.tables['social_ad_post_links'];
    const r = await loadSocialData({ period, comparison });
    expect(r.adLinking).toEqual({ rule: 1, manual: 0, unlinked: 1 });
  });

  it('serves the same request from the cache, and recomputes once it is cleared', async () => {
    process.env['SOCIAL_DATA_CACHE_MS'] = '60000';
    state.tables['social_posts'] = [post('instagram', 'p1', '2026-10-04T08:00:00Z', 'Un post')];
    const first = await loadSocialData({ period, comparison });
    state.tables['social_posts'] = [];
    expect(await loadSocialData({ period, comparison })).toBe(first);
    resetSocialDataCache();
    expect((await loadSocialData({ period, comparison })).posts).toEqual([]);
  });

  it('abstains when the date of the name matches several posts of the targeted network that the text cannot separate', async () => {
    state.tables['social_posts'] = [post('instagram', 'a', '2026-10-04T08:00:00Z', 'Sujet un'), post('instagram', 'b', '2026-10-04T15:00:00Z', 'Sujet deux')];
    state.tables['social_ad_creatives'] = [{ platform: 'instagram', ad_id: 'X', ad_name: '04102026_IG', thumbnail_path: null }];
    state.tables['social_ad_creative_daily'] = [creativeDay('instagram', 'X', '2026-10-06', 'dark', 30, 3000)];
    const r = await loadSocialData({ period, comparison });
    expect(r.paidAds.map(a => a.ad_id)).toEqual(['X']);
    expect(r.posts.every(p => p.sponsored === undefined)).toBe(true);
  });

  it('degrades to plain Paid rows, without failing, when a read of the linking step fails', async () => {
    state.tables['social_posts'] = [post('instagram', 'ig-oct4', '2026-10-04T08:00:00Z', 'Une semaine de l’espace')];
    state.tables['social_ad_creatives'] = [{ platform: 'instagram', ad_id: 'X', ad_name: '04102026_semaine_IG', thumbnail_path: null }];
    state.tables['social_ad_creative_daily'] = [creativeDay('instagram', 'X', '2026-10-06', 'dark_media', 30, 3000)];
    state.failOn = (table, ops) => table === 'social_ad_creative_daily' && ops.includes('in:ad_id');
    const r = await loadSocialData({ period, comparison });
    expect(r.paidAds.map(a => a.ad_id)).toEqual(['X']);
    expect(r.posts[0]?.sponsored).toBeUndefined();
    expect(r.posts[0]?.adLink).toBeUndefined();
  });

  it('still fails when a core read fails', async () => {
    state.failOn = table => table === 'social_posts';
    await expect(loadSocialData({ period, comparison })).rejects.toThrow();
  });
  describe('stories Instagram : relevé en direct + historique importé', () => {
    const story = (story_id: string, published_at: string, extra: Row = {}) => ({ platform: 'instagram', story_id, published_at, views: null, reach: null, replies: null, shares: null, interactions: null, ...extra });
    it('merges the live stories and the imported history by id and carries the history windows as coverage entries', async () => {
      state.tables['social_stories'] = [story('s1', '2026-10-05T08:00:00Z', { views: 1000, replies: 2 })];
      state.tables['social_story_history'] = [story('s1', '2026-10-05T08:00:00Z', { views: 900, reach: 700 }), story('s2', '2026-10-07T08:00:00Z', { views: 400 })];
      state.tables['social_story_history_windows'] = [{ platform: 'instagram', start_day: '2024-10-21', end_day: '2026-10-19', level: 'complete' }];
      state.tables['social_story_coverage'] = [{ platform: 'instagram', day: '2026-10-20', pulls: 3, max_gap_minutes: 190 }];
      const r = await loadSocialData({ period, comparison });
      expect(r.storiesFailed).toBe(false);
      expect(r.stories.map(x => x.story_id).sort()).toEqual(['s1', 's2']);
      expect(r.stories.find(x => x.story_id === 's1')).toMatchObject({ views: 1000, reach: 700, replies: 2 });
      expect(r.storyPulls).toContainEqual({ platform: 'instagram', day: '2024-10-21', through: '2026-10-19', pulls: 1, level: 'complete' });
      expect(r.storyPulls).toContainEqual({ platform: 'instagram', day: '2026-10-20', pulls: 3, maxGapMinutes: 190 });
    });
    it('keeps the live stories when the history tables are absent, without calling it a failure', async () => {
      state.tables['social_stories'] = [story('s1', '2026-10-05T08:00:00Z', { views: 1000 })];
      state.failOn = table => table === 'social_story_history' || table === 'social_story_history_windows';
      state.failCode = 'PGRST205';
      const r = await loadSocialData({ period, comparison });
      expect(r.storiesFailed).toBe(false);
      expect(r.stories.map(x => x.story_id)).toEqual(['s1']);
    });
    it('flags any other failed stories read instead of calling it "tracking not active"', async () => {
      state.tables['social_story_history_windows'] = [{ platform: 'instagram', start_day: '2024-10-21', end_day: '2026-10-19', level: 'complete' }];
      state.failOn = table => table === 'social_stories';
      const r = await loadSocialData({ period, comparison });
      expect(r.storiesFailed).toBe(true);
    });
  });
});
