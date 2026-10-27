import { describe, expect, it, vi } from 'vitest';
import {
  adStems, applyRuleLinks, groupUnlinkedAds, linkAdsToPosts, parseAdNameDate, targetPlatforms, textScore,
  type LinkableAd, type LinkablePost,
} from '@/lib/ad-post-link';
import type { PaidAd } from '@/lib/top-posts';
import type { SocialPost, Sponsored } from '@/lib/social-totals';

// The stop words of the neutral configuration are "metropole" and "forum" (the real client's words never reach a generic test).
vi.mock('@/client/config', async () => (await import('@/test/fixtures/neutral-client')).neutralClientModule());

const post = (platform: string, post_id: string, published_at: string, title: string): LinkablePost => ({ platform, post_id, published_at, title });
const ad = (name: string, first_day: string, platforms = ['facebook', 'instagram'], ad_id = name): LinkableAd => ({ ad_id, name, platforms, first_day });

describe('parseAdNameDate', () => {
  it('reads a leading DDMMYYYY date', () => {
    expect(parseAdNameDate('04102026_post1semainedelespace_IG')).toBe('2026-10-04');
    expect(parseAdNameDate('  29022028_x')).toBe('2028-02-29');
  });
  it('rejects every other date format and impossible days', () => {
    for (const name of ['20260505 - Reel', 'Ad name2026-07-09 teaser', '31022026_x', '00102026_x', '32102026_x', '04132026_x', '041020261_x', 'pub_04102026', '', null, undefined]) {
      expect(parseAdNameDate(name)).toBeNull();
    }
  });
});

describe('targetPlatforms', () => {
  it('follows the network suffix, else the delivery networks, limited to Meta', () => {
    expect(targetPlatforms('04102026_x_IG', ['facebook', 'instagram'])).toEqual(['instagram']);
    expect(targetPlatforms('04102026_x_FB', ['facebook', 'instagram'])).toEqual(['facebook']);
    expect(targetPlatforms('04102026_x_IG+FB', ['facebook'])).toEqual(['instagram', 'facebook']);
    expect(targetPlatforms('04102026_x', ['facebook', 'tiktok'])).toEqual(['facebook']);
    expect(targetPlatforms('04102026_x', ['tiktok', 'linkedin'])).toEqual([]);
  });
});

describe('textScore', () => {
  it('compares 5-letter roots, ignoring accents, dates, network suffixes and common words', () => {
    expect(adStems('04102026_Retour Forum Metropole_IG')).toEqual([]);
    expect(adStems('04102026_Exposants_Hélicoptères_IG')).toEqual(['expos', 'helic']);
    expect(textScore(['expos', 'helic'], 'Les exposants et les hélicoptères du Forum')).toBe(1);
    expect(textScore(['expos', 'helic'], 'Les exposants du Forum')).toBe(0.5);
    expect(textScore([], 'anything')).toBe(0);
  });
});

describe('linkAdsToPosts', () => {
  const posts = [
    post('instagram', 'ig-oct4', '2026-10-04T08:00:00Z', 'Une semaine de l’espace'),
    post('facebook', 'fb-oct4', '2026-10-04T09:00:00Z', 'Une semaine de l’espace'),
    post('instagram', 'ig-oct5-a', '2026-10-05T08:00:00Z', 'Les hélicoptères militaires'),
    post('instagram', 'ig-oct5-b', '2026-10-05T15:00:00Z', 'Les exposants du forum'),
  ];

  it('links by the date of the name when a single post exists that day on the targeted network', () => {
    const links = linkAdsToPosts([ad('04102026_post1semainedelespace_IG', '2026-10-06')], posts);
    expect(links.get('04102026_post1semainedelespace_IG')).toMatchObject({ platform: 'instagram', post_id: 'ig-oct4', by: 'date' });
    const fb = linkAdsToPosts([ad('04102026_post1semainedelespace_FB', '2026-10-06')], posts);
    expect(fb.get('04102026_post1semainedelespace_FB')).toMatchObject({ platform: 'facebook', post_id: 'fb-oct4' });
  });

  it('abstains when two networks are targeted and both have a post that day', () => {
    expect(linkAdsToPosts([ad('04102026_semaine_IG+FB', '2026-10-06')], posts).size).toBe(0);
  });

  it('breaks a same-day tie with the text, and abstains when the text does not decide', () => {
    expect(linkAdsToPosts([ad('05102026_helicopteres militaires_IG', '2026-10-06')], posts).get('05102026_helicopteres militaires_IG')).toMatchObject({ post_id: 'ig-oct5-a' });
    expect(linkAdsToPosts([ad('05102026_exposants forum_IG', '2026-10-06')], posts).get('05102026_exposants forum_IG')).toMatchObject({ post_id: 'ig-oct5-b' });
    expect(linkAdsToPosts([ad('05102026_autre sujet_IG', '2026-10-06')], posts).size).toBe(0);
    expect(linkAdsToPosts([ad('05102026_IG', '2026-10-06')], posts).size).toBe(0);
  });

  it('abstains when no post exists on the date of the name', () => {
    expect(linkAdsToPosts([ad('09102026_semaine_IG', '2026-10-10')], posts).size).toBe(0);
  });

  it('uses the Paris calendar day of the publication', () => {
    const late = [post('instagram', 'late', '2026-10-04T22:30:00Z', 'Tard le soir')];
    expect(linkAdsToPosts([ad('05102026_tard_IG', '2026-10-06', ['instagram'])], late).get('05102026_tard_IG')).toMatchObject({ post_id: 'late' });
    expect(linkAdsToPosts([ad('04102026_tard_IG', '2026-10-06', ['instagram'])], late).size).toBe(0);
  });

  it('twin guard: abstains when the twin ad is natively linked to a post of another day', () => {
    const twins = [{ name: '04102026_post1semainedelespace_FB', published_at: '2026-10-03T09:00:00Z' }];
    expect(linkAdsToPosts([ad('04102026_post1semainedelespace_IG', '2026-10-06')], posts, twins).size).toBe(0);
    const sameDay = [{ name: '04102026_post1semainedelespace_FB', published_at: '2026-10-04T09:00:00Z' }];
    expect(linkAdsToPosts([ad('04102026_post1semainedelespace_IG', '2026-10-06')], posts, sameDay).size).toBe(1);
  });

  it('without a date, links on text alone with a strict threshold within the window before delivery', () => {
    const named = ad('Hélicoptères militaires', '2026-10-06', ['instagram']);
    expect(linkAdsToPosts([named], posts).get(named.ad_id)).toMatchObject({ post_id: 'ig-oct5-a', by: 'text' });
    const half = ad('Hélicoptères exposants fusées', '2026-10-06', ['instagram']);
    expect(linkAdsToPosts([half], posts).size).toBe(0);
    const old = ad('Hélicoptères militaires', '2026-12-30', ['instagram']);
    expect(linkAdsToPosts([old], posts).size).toBe(0);
  });

  it('never links on a single word without a date', () => {
    const single = ad('Exposants', '2026-10-06', ['instagram']);
    expect(adStems(single.name)).toEqual(['expos']);
    expect(linkAdsToPosts([single], posts).size).toBe(0);
  });

  it('ignores networks other than Meta', () => {
    expect(linkAdsToPosts([ad('04102026_x_TT', '2026-10-06', ['tiktok'])], [post('tiktok', 't1', '2026-10-04T08:00:00Z', 'x')]).size).toBe(0);
  });
});

describe('groupUnlinkedAds', () => {
  const paid = (platform: string, ad_id: string, title: string, first_day: string): PaidAd => ({ platform, ad_id, title, thumbnail_url: '', first_day, spend: 1, impressions: 1, likes: null, comments: null, shares: null, permalink: '' });
  it('groups the placements of one ad and drops unnamed ads', () => {
    const grouped = groupUnlinkedAds([paid('facebook', 'a', 'N1', '2026-10-02'), paid('instagram', 'a', 'N1', '2026-10-01'), paid('instagram', 'b', 'Publicité', '2026-10-01')]);
    expect(grouped).toEqual([{ ad_id: 'a', name: 'N1', platforms: ['facebook', 'instagram'], first_day: '2026-10-01' }]);
  });
});

describe('applyRuleLinks', () => {
  const social = (post_id: string, published_at = '2026-10-04T08:00:00Z', sponsored?: Sponsored): SocialPost =>
    ({ platform: 'instagram', post_id, published_at, title: post_id, format: 'Photo', permalink: '', thumbnail_path: null, metrics: {}, ...(sponsored ? { sponsored } : {}) });

  it('adds the lifetime delivery of the ad to the post, once, and reports what it applied', () => {
    const target = social('p1', '2026-10-04T08:00:00Z', { spend: 4, impressions: 400 });
    const links = new Map([['ad1', { ad_id: 'ad1', platform: 'instagram', post_id: 'p1', by: 'date' as const }], ['ghost', { ad_id: 'ghost', platform: 'instagram', post_id: 'missing', by: 'date' as const }], ['nototal', { ad_id: 'nototal', platform: 'instagram', post_id: 'p1', by: 'date' as const }]]);
    const { touched, applied } = applyRuleLinks(links, new Map([['ad1', { spend: 10, impressions: 1000 }], ['ghost', { spend: 1, impressions: 1 }]]), [target], []);
    expect(target.sponsored).toEqual({ spend: 14, impressions: 1400 });
    expect(target.adLink).toBe('rule');
    expect(touched).toEqual([target]);
    expect([...applied]).toEqual(['ad1']);
  });

  it('finds the post among the candidates when it is not in the period', () => {
    const old = social('old', '2026-09-20T08:00:00Z');
    const { touched } = applyRuleLinks(new Map([['ad1', { ad_id: 'ad1', platform: 'instagram', post_id: 'old', by: 'text' as const }]]), new Map([['ad1', { spend: 6, impressions: 600 }]]), [], [old]);
    expect(touched).toEqual([old]);
    expect(old.sponsored).toEqual({ spend: 6, impressions: 600 });
  });

  it('sums several ads linked to the same post', () => {
    const target = social('p1');
    const links = new Map([['a', { ad_id: 'a', platform: 'instagram', post_id: 'p1', by: 'date' as const }], ['b', { ad_id: 'b', platform: 'instagram', post_id: 'p1', by: 'date' as const }]]);
    const { touched } = applyRuleLinks(links, new Map([['a', { spend: 5, impressions: 100 }], ['b', { spend: 7, impressions: 300 }]]), [target], []);
    expect(touched).toHaveLength(1);
    expect(target.sponsored).toEqual({ spend: 12, impressions: 400 });
  });

  it('carries the budget / engagements pair of the ads along with the delivery', () => {
    const target = social('p1', '2026-10-04T08:00:00Z', { spend: 4, impressions: 400, engagement: { spend: 4, count: 2 } });
    const links = new Map([['a', { ad_id: 'a', platform: 'instagram', post_id: 'p1', by: 'date' as const }], ['b', { ad_id: 'b', platform: 'instagram', post_id: 'p1', by: 'date' as const }]]);
    applyRuleLinks(links, new Map([['a', { spend: 6, impressions: 100, engagement: { spend: 6, count: 3 } }], ['b', { spend: 7, impressions: 300 }]]), [target], []);
    // The ad without known engagements adds its budget but not to the pair: the pair no longer covers the budget, so no CPE will be shown.
    expect(target.sponsored).toEqual({ spend: 17, impressions: 800, engagement: { spend: 10, count: 5 } });
  });
});
