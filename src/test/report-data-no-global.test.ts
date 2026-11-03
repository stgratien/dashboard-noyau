import { describe, it, expect, vi, beforeEach } from 'vitest';

// Chemin réel de /api/public/report-data (loadReportTokens) avec les lectures de la base simulées : un client sans onglet Global n'a ni jeton global.* ni note « Global ».
const calls = { youtube: 0, ads: 0 };
vi.mock('@/lib/youtube.server', () => ({ loadYoutube: async () => { calls.youtube++; return { lastSuccess: null }; } }));
vi.mock('@/lib/google-ads.server', () => ({ loadGoogleAds: async () => { calls.ads++; return { rows: [], lastSuccess: new Date().toISOString() }; } }));
vi.mock('@/lib/social-data.server', async () => {
  const { PLATFORMS } = await import('@/lib/dashboard-data');
  const { PLATFORM_SOURCES } = await import('@/core/client-config');
  const days: Record<string, unknown>[] = [];
  const dates = ['2026-03-29', '2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02', '2026-04-03'];
  PLATFORMS.forEach(({ id }, i) => {
    const [organic, paid] = (PLATFORM_SOURCES as Record<string, [string, string]>)[id] as [string, string];
    dates.forEach((day, k) => {
      days.push({ platform: id, source: organic, day, followers_estimated: false, metrics: { followers: 100 * (i + 1) + k, newFollowers: 1, postsAvailable: 1, impressions: 1000 * (i + 1) + k, likes: 10, comments: 2, shares: 3, videoViews: 100, linkClicks: 5 } });
      // Du payant seulement sur la période principale : la période comparée est alors partielle.
      if (k >= 3 && id !== 'tiktok') days.push({ platform: id, source: paid, day, followers_estimated: false, metrics: { impressions: 500, spend: 20, likes: 1, comments: 0, shares: 0, clicks: 4 } });
    });
  });
  const posts = PLATFORMS.map(({ id }) => ({ platform: id, post_id: id, published_at: '2026-04-02T12:00:00Z', title: 'Test', format: 'Post', permalink: '', thumbnail_path: null, metrics: { impressions: 4000, likes: 10, comments: 2, shares: 3 } }));
  return { loadSocialData: async () => ({ days, posts, statuses: [], ads: [], adCoverage: [], stories: [], storyPulls: [], storiesFailed: false }) };
});

beforeEach(() => { calls.youtube = 0; calls.ads = 0; });

const period = { start: '2026-04-01', end: '2026-04-03' };
const comparison = { period: { start: '2026-03-29', end: '2026-03-31' }, label: 'T-prev' };
/** Rapport d'une configuration cliente donnée (REPORT_NETWORKS se calcule à l'import : modules rechargés à chaque configuration). */
async function reportFor(overrides: Record<string, unknown>) {
  vi.resetModules();
  vi.doMock('@/client/config', async () => (await import('@/test/fixtures/neutral-client')).neutralClientModule(overrides));
  const { loadReportTokens } = await import('@/lib/report-data.server');
  return loadReportTokens(period, comparison);
}
const prefixes = (tokens: Record<string, string>) => [...new Set(Object.keys(tokens).filter((k) => k.includes('.')).map((k) => k.split('.')[0]))].sort();

describe('report data without a Global tab', () => {
  it('writes only the markers of the single network, with the comparison, and no Global or YouTube', async () => {
    const { tokens, notes } = await reportFor({ sources: ['linkedin', 'linkedin_organic'], features: { global: false, googleAds: false, youtube: false } });
    expect(prefixes(tokens)).toEqual(['linkedin']);
    expect(tokens['trimestre']).toBeDefined();
    expect(tokens['comparaison']).toBe('T-prev');
    expect(tokens['linkedin.impressions_prev']).toBeDefined();
    expect(tokens['linkedin.impressions_vs']).toMatch(/^vs /);
    expect(tokens['linkedin.impressions_tone']).toBeDefined();
    expect(notes.some((n) => n.startsWith('Global,') || n.startsWith('YouTube'))).toBe(false);
    expect(calls).toEqual({ youtube: 0, ads: 0 });
  });
  it('writes no Global marker for several networks either, and does not read YouTube for a Global that does not exist', async () => {
    const { tokens, notes } = await reportFor({ features: { global: false } });
    expect(prefixes(tokens)).toEqual(expect.arrayContaining(['facebook', 'instagram', 'linkedin', 'tiktok']));
    expect(prefixes(tokens)).not.toContain('global');
    expect(notes.some((n) => n.startsWith('Global,'))).toBe(false);
    expect(calls.youtube).toBe(0);
  });
  it('keeps the Global markers, the Global notes and the YouTube read for a client that has a Global tab', async () => {
    const { tokens } = await reportFor({});
    expect(prefixes(tokens)).toContain('global');
    expect(tokens['global.impressions']).toBeDefined();
    expect(tokens['global.impressions_vs']).toMatch(/^vs /);
    expect(calls.youtube).toBe(1);
  });
});
