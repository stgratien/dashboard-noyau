import { describe, expect, it } from 'vitest';
import { googleAdsPayload, toDbRows, googleAdsTotals, googleAdsSeries, googleAdsStale, googleAdsCampaigns, youtubeCampaignSpend } from '@/lib/google-ads';

const row = (date: string, id: string, cost: number, clicks: number, impressions: number, conversions = 0, channel = 'SEARCH') => ({ date, campaign_id: id, campaign_name: id, channel, impressions, clicks, cost, conversions, conversions_value: 0, video_views: null });

describe('Google Ads ingestion', () => {
  it('rejects invalid dates and more than 2 000 rows', () => {
    expect(googleAdsPayload.safeParse({ account_id: '1', rows: [row('2026-02-30', 'a', 1, 1, 1)] }).success).toBe(false);
    expect(googleAdsPayload.safeParse({ account_id: '1', rows: Array.from({ length: 2001 }, () => row('2026-01-01', 'a', 1, 1, 1)) }).success).toBe(false);
    expect(googleAdsPayload.safeParse({ account_id: '1', rows: [row('2026-01-01', 'a', 1, 1, 1)] }).success).toBe(true);
  });
  it('keys rows by date + campaign (last value wins)', () => {
    const p = googleAdsPayload.parse({ account_id: '1', rows: [row('2026-01-01', 'a', 1, 1, 1), row('2026-01-01', 'a', 5, 1, 1)] });
    expect(toDbRows(p).map(r => r.cost)).toEqual([5]);
  });
  it('marks the source unavailable after 48 h', () => {
    const now = Date.parse('2026-10-16T12:00:00Z');
    expect(googleAdsStale('2026-10-14T11:59:00Z', now)).toBe(true);
    expect(googleAdsStale('2026-10-15T12:00:00Z', now)).toBe(false);
    expect(googleAdsStale(null, now)).toBe(true);
  });
});

describe('Google Ads KPIs', () => {
  const rows = toDbRows(googleAdsPayload.parse({ account_id: '1', rows: [row('2026-10-01', 'a', 100, 50, 10000, 5), row('2026-10-02', 'b', 300, 50, 10000, 0, 'PERFORMANCE_MAX')] }));
  it('computes CTR, CPC, CPM and cost per conversion', () => {
    const t = googleAdsTotals(rows, { start: '2026-10-01', end: '2026-10-31' });
    expect(t.spend).toBe(400); expect(t.ctr).toBe(0.5); expect(t.cpc).toBe(4); expect(t.cpm).toBe(20); expect(t.costPerConversion).toBe(80); expect(t.videoViews).toBeNull();
  });
  it('sorts campaigns by budget and switches to weekly above 90 days', () => {
    expect(googleAdsCampaigns(rows, { start: '2026-10-01', end: '2026-10-31' })[0]?.id).toBe('b');
    expect(googleAdsSeries(rows, { start: '2026-01-01', end: '2026-10-31' }).weekly).toBe(true);
    expect(googleAdsSeries(rows, { start: '2026-10-01', end: '2026-10-31' }).weekly).toBe(false);
  });
});

describe('YouTube budget of the report', () => {
  const rows = toDbRows(googleAdsPayload.parse({ account_id: '1', rows: [
    row('2026-10-01', 'Forum - YouTube - Bumper', 100, 5, 1000, 0, 'VIDEO'),
    row('2026-10-02', 'forum youtube pre-roll', 50, 5, 1000, 0, 'DEMAND_GEN'),
    row('2026-10-02', 'Search marque', 300, 5, 1000),
    row('2026-09-10', 'Search marque', 80, 5, 1000),
  ] }));
  it('adds up the campaigns whose name contains YouTube, whatever the case or the campaign type', () => {
    expect(youtubeCampaignSpend(rows, { start: '2026-10-01', end: '2026-10-31' })).toBe(150);
  });
  it('is zero when campaigns ran but none is named YouTube, and null when Google Ads has no row at all', () => {
    expect(youtubeCampaignSpend(rows, { start: '2026-09-01', end: '2026-09-30' })).toBe(0);
    expect(youtubeCampaignSpend(rows, { start: '2026-08-01', end: '2026-08-31' })).toBeNull();
  });
});
