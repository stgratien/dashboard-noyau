import { describe, it, expect } from 'vitest';
import { youtubeTotals, youtubeSubscribersAt, addYoutubeToSocial, youtubePayload } from './youtube';
const day = (d: string, o = {}) => ({ day: d, views: 100, minutes_watched: 60, avg_view_duration_s: 30, subscribers_gained: 5, subscribers_lost: 1, likes: 3, comments: 1, shares: 1, ...o });
const data = { days: [day('2026-10-01'), day('2026-10-02')], snapshots: [{ day: '2026-10-02', subscriber_count: 1000 }], videos: [], lastSuccess: null };
const g = [{ day: '2026-10-01', campaign_id: 'v', campaign_name: '', channel: 'VIDEO', impressions: 2000, clicks: 0, cost: 50, conversions: 0, conversions_value: 0, video_views: 500 }, { day: '2026-10-01', campaign_id: 's', campaign_name: '', channel: 'SEARCH', impressions: 9999, clicks: 9, cost: 999, conversions: 0, conversions_value: 0, video_views: null }];
describe('youtube', () => {
  it('reconstructs subscribers backwards with gained − lost', () => expect(youtubeSubscribersAt(data, '2026-10-01')).toEqual({ value: 996, estimated: true }));
  it('blends organic + paid video views and uses only video campaigns for budget', () => {
    const t = youtubeTotals(data, g, { start: '2026-10-01', end: '2026-10-02' });
    expect(t.views).toBe(700); expect(t.spend).toBe(50); expect(t.cpv).toBe(0.1); expect(t.cpm).toBe(25); expect(t.interactions).toBe(10); expect(t.newFollowers).toBe(8);
  });
  it('adds YouTube to social totals but never to budget/impressions', () => {
    const y = youtubeTotals(data, g, { start: '2026-10-01', end: '2026-10-02' });
    const s = addYoutubeToSocial({ followers: 10, followerGrowth: 0, followerGrowthPercent: 0, posts: 1, videos: 0, videoViews: 5, interactions: 5, spend: 7, impressions: 9, missing: {} }, y);
    expect(s.videoViews).toBe(205); expect(s.interactions).toBe(15); expect(s.followers).toBe(1010); expect(s.spend).toBe(7); expect(s.impressions).toBe(9);
  });
  it('leaves the totals untouched, with no missing network, while YouTube is not connected', () => {
    const base = { followers: 10, followerGrowth: 0, followerGrowthPercent: 0, posts: 1, videos: 0, videoViews: 5, interactions: 5, missing: {} as Record<string, string[]> };
    expect(addYoutubeToSocial(base, null)).toBe(base);
    expect(addYoutubeToSocial(base, null).missing).toEqual({});
  });
  it('rejects more than 150 videos', () => expect(youtubePayload.safeParse({ channel_id: 'c', snapshot_date: '2026-10-01', subscriber_count: 1, days: [], videos: Array(151).fill({ video_id: 'a', published_at: '2026-10-01T00:00:00Z' }) }).success).toBe(false));
});
