import { describe, it, expect, vi } from 'vitest';
import { nativeCardPlacements } from '../lib/report-cards';
import { buildReportNotes, buildReportTokens, REPORT_NETWORKS, type ReportTotals } from '../lib/report-tokens';
import { reportTabAvailable } from '../lib/report-tab';

// Client à une seule plateforme : un seul réseau, pas d'onglet Global, ni Google Ads ni YouTube (REPORT_NETWORKS se calcule à l'import, d'où un fichier à part).
vi.mock('@/client/config', async () =>
  (await import('@/test/fixtures/neutral-client')).neutralClientModule({ sources: ['linkedin', 'linkedin_organic'], features: { global: false, googleAds: false, youtube: false } }),
);

const empty: ReportTotals = {
  posts: null, followers: null, followerGrowth: null, followerGrowthPercent: null, adsDelivered: null, impressionsPerPost: null, impressions: null,
  videoViews: null, videos: null, interactions: null, engagementRate: null, spend: null, cpm: null, cpe: null, cpv: null, clicks: null,
};
const full: ReportTotals = { ...empty, posts: 24, followers: 37200, followerGrowth: 440, followerGrowthPercent: 1.2, impressions: 2100000, interactions: 12345, engagementRate: 0.6, spend: 1500, cpm: 4.5 };
const q2 = { start: '2026-04-01', end: '2026-06-30' };
// Un client à un réseau ne fournit que ce réseau : les autres clés du type ne servent qu'aux clients à plusieurs réseaux.
const oneNetwork = (t: ReportTotals) => ({ linkedin: t }) as unknown as Parameters<typeof buildReportTokens>[1];

describe('report of a single-network client without a Global tab', () => {
  it('only knows the network of the client', () => {
    expect(REPORT_NETWORKS).toEqual(['linkedin']);
  });
  it('writes the markers of the network and none for Global (they would duplicate the network)', () => {
    const t = buildReportTokens(q2, oneNetwork(full), { label: 'T1 2026', totals: oneNetwork({ ...full, impressions: 1500000 }) });
    expect(t['trimestre']).toBe('T2 2026');
    expect(t['comparaison']).toBe('T1 2026');
    expect(t['linkedin.impressions']).toBe('2,1M');
    expect(t['linkedin.impressions_prev']).toBe('1,5M');
    expect(t['linkedin.impressions_vs']).toBe('vs 1,5M (+40%)');
    expect(Object.keys(t).some((k) => k.startsWith('global.'))).toBe(false);
  });
  it('lists the partial figures of the network only, never a Global line', () => {
    const li = { ...full, missing: { impressions: ['linkedin:organic'] } };
    const notes = buildReportNotes(oneNetwork(li));
    expect(notes).toEqual(['LinkedIn, impressions : partiel (organique LinkedIn non disponible sur cette période)']);
    expect(buildReportNotes(oneNetwork(full))).toEqual([]);
  });
  it('colours only the native cards of the networks of the client (no Global, no YouTube budget zone)', () => {
    const placements = nativeCardPlacements();
    expect(placements).toHaveLength(11);
    expect(placements.every((p) => p.prefix === 'linkedin' && !p.whole)).toBe(true);
    expect(placements.map((p) => p.objectId)).toContain('kpi_linkedin_impressions_vs');
  });
  it('launches the report from the network tab when there is no Global tab, from Global otherwise', () => {
    expect(reportTabAvailable('linkedin', false, ['linkedin'])).toBe(true);
    expect(reportTabAvailable('overview', false, ['linkedin'])).toBe(false);
    expect(reportTabAvailable('youtube', false, ['linkedin'])).toBe(false);
    expect(reportTabAvailable('overview', true, ['linkedin', 'facebook'])).toBe(true);
    expect(reportTabAvailable('linkedin', true, ['linkedin', 'facebook'])).toBe(false);
  });
});
