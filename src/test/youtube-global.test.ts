import { describe, expect, it } from 'vitest';
import { addYoutubeToSocial } from '../lib/youtube';

const totals = { followers: 100, followerGrowth: 1, followerGrowthPercent: 1, posts: 5, videos: 1, videoViews: 10, interactions: 4, missing: {} as Record<string, string[]> };

describe('YouTube in Tous réseaux', () => {
  it('leaves the totals untouched when YouTube is not connected', () => {
    expect(addYoutubeToSocial(totals, null)).toBe(totals);
  });
  it('flags YouTube as missing, without changing the figures, while it is connected but unreadable', () => {
    const t = addYoutubeToSocial(totals, null, true);
    expect(t.followers).toBe(100);
    expect(t.posts).toBe(5);
    for (const key of ['followers', 'posts', 'videoViews', 'interactions']) expect(t.missing[key]).toEqual(['YouTube']);
    expect(totals.missing).toEqual({});
  });
});
