import { describe, it, expect, vi } from 'vitest';
import { NATIVE_CARD_NETWORKS, nativeCardPlacements } from '../lib/report-cards';
import { buildReportTokens } from '../lib/report-tokens';

// Configuration neutre : les cartes natives couvrent tous les réseaux, quels que soient ceux que le client du dépôt a connectés.
vi.mock('@/client/config', async () => (await import('@/test/fixtures/neutral-client')).neutralClientModule());

describe('native report cards', () => {
  it('lists one sub-line per card of the networks whose slide was rebuilt', () => {
    const placements = nativeCardPlacements().filter((p) => !p.whole);
    expect(placements.map((p) => p.objectId)).toContain('kpi_linkedin_impressions_vs');
    expect(placements.every((p) => p.objectId === `kpi_${p.prefix}_${p.metric}_vs`)).toBe(true);
    expect(placements).toHaveLength(Object.values(NATIVE_CARD_NETWORKS).flat().length);
  });
  it('lists the change-only zone of the YouTube slide (budget of the campaigns named YouTube)', () => {
    expect(nativeCardPlacements().filter((p) => p.whole)).toEqual([{ objectId: 'kpi_youtube_spend_change', prefix: 'youtube', metric: 'spend', whole: true }]);
  });
  it('only targets sub-lines that have a _vs marker in the figures', () => {
    const z = { posts: 1, followers: 1, followerGrowth: 1, followerGrowthPercent: 1, adsDelivered: 1, impressionsPerPost: 1, impressions: 1, videoViews: 1, videos: 1, interactions: 1, engagementRate: 1, spend: 1, cpm: 1, cpe: 1, cpv: 1, clicks: 1 };
    const stories = { coverage: 'full' as const, coveredDays: 91, days: 91, firstCoveredDay: '2026-04-01', headDays: 0, contiguous: true, tailDays: 0, tailOpen: false, incompleteDays: 0, failed: false, count: 12, views: 90000, viewsPerStory: 7500, interactions: 800, withoutViews: 0, withoutInteractions: 0 };
    const all = { global: z, linkedin: z, facebook: z, instagram: { ...z, stories }, tiktok: z };
    const tokens = buildReportTokens({ start: '2026-04-01', end: '2026-06-30' }, all, { label: 'T2 2024', totals: all }, { current: { spend: 1500 }, previous: { spend: 1000 } });
    for (const { prefix, metric, whole } of nativeCardPlacements()) expect(tokens[`${prefix}.${metric}_${whole ? 'change' : 'vs'}`], `${prefix}.${metric}`).toBeDefined();
  });
});
