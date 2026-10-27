import { describe, expect, it, vi } from 'vitest';
import { postStats, topPosts, sortRows, audienceBreakdowns, audiencePanels, countryName, formatLabel, flopPosts, formatOptions, postFormat, pageWindow, FLOP_COUNT, TABLE_PAGE_SIZE } from '@/lib/top-posts';
import { pdfFileName } from '@/lib/pdf-export';
import { definition } from '@/lib/kpi-definitions';

// The export file name comes from the configuration: the generic test reads the neutral one (brand "Demo Event").
vi.mock('@/client/config', async () => (await import('@/test/fixtures/neutral-client')).neutralClientModule());

const post = (id: string, m: Record<string, number>, sponsored?: { spend: number; impressions: number }) => ({ platform: 'instagram', post_id: id, published_at: '2025-06-18T10:00:00Z', title: id, format: 'Photo', permalink: '', thumbnail_path: null, metrics: m, ...(sponsored ? { sponsored } : {}) });

describe('top posts', () => {
  it('picks visibility, engagement and lowest sponsored CPM; organic posts have no budget', () => {
    const rows = [post('a', { impressions: 1000, likes: 10, comments: 0, shares: 0 }), post('b', { impressions: 500, likes: 90, comments: 5, shares: 5 }, { spend: 10, impressions: 4000 }), post('c', { impressions: 200, likes: 1, comments: 0, shares: 0 }, { spend: 10, impressions: 1000 })].map(postStats);
    const best = topPosts(rows);
    expect(best.visibility?.id).toBe('a');
    expect(best.engagement?.id).toBe('b');
    expect(best.cpm?.id).toBe('b');
    expect(best.cpm?.cpm).toBe(2.5);
    expect(rows[0]?.spend).toBeNull();
    expect(rows[1]?.rate).toBe(20);
  });
  it('has no CPM winner without sponsored posts', () => {
    expect(topPosts([postStats(post('a', { impressions: 1 }))]).cpm).toBeNull();
  });
});

describe('impressions the network no longer provides', () => {
  it('treats interactions above impressions as unknown impressions, never as a rate above 100 %', () => {
    const old = postStats(post('old', { impressions: 7, likes: 200, comments: 4, shares: 15 }));
    expect(old.interactions).toBe(219);
    expect(old.impressions).toBeNull();
    expect(old.rate).toBeNull();
    const fine = postStats(post('fine', { impressions: 300, likes: 200, comments: 4, shares: 15 }));
    expect(fine.impressions).toBe(300);
    expect(fine.rate).toBeCloseTo(73);
    // Equal figures are possible; unknown interactions leave the impressions as they are.
    expect(postStats(post('eq', { impressions: 219, likes: 200, comments: 4, shares: 15 })).impressions).toBe(219);
    expect(postStats(post('nolikes', { impressions: 5, comments: 4 })).impressions).toBe(5);
    // The known part of the interactions is a lower bound: 204 known interactions already exceed 7 impressions, whatever the missing share count.
    const partial = postStats(post('partial', { impressions: 7, likes: 200, comments: 4 }));
    expect(partial.interactions).toBeNull();
    expect(partial.impressions).toBeNull();
  });
  it('orders posts without a sort value by interactions, never by the order of the database', () => {
    const rows = [
      post('b', { impressions: 5, likes: 100, comments: 1, shares: 1 }),
      post('a', { impressions: 7, likes: 200, comments: 4, shares: 15 }),
      post('fine', { impressions: 3000, likes: 30, comments: 2, shares: 1 }),
    ].map(postStats);
    expect(sortRows(rows, 'impressions', 'desc').map(r => r.id)).toEqual(['fine', 'a', 'b']);
    expect(sortRows(rows, 'impressions', 'asc').map(r => r.id)).toEqual(['fine', 'a', 'b']);
    expect(sortRows(rows, 'rate', 'desc').map(r => r.id)).toEqual(['fine', 'a', 'b']);
  });
  it('keeps such a post out of the visibility ranking and sorts it last on impressions', () => {
    const rows = [post('old', { impressions: 7, likes: 200, comments: 4, shares: 15 }), post('fine', { impressions: 3000, likes: 30, comments: 2, shares: 1 })].map(postStats);
    expect(topPosts(rows).visibility?.id).toBe('fine');
    expect(sortRows(rows, 'impressions', 'desc').map(r => r.id)).toEqual(['fine', 'old']);
    expect(sortRows(rows, 'impressions', 'asc').map(r => r.id)).toEqual(['fine', 'old']);
    expect(definition('topPosts', 'linkedin')).toContain('ses impressions sont inconnues');
  });
});

describe('CPE of the publications table', () => {
  const metrics = { impressions: 1000, likes: 500, comments: 50, shares: 50 };
  it('divides the budget of the ads by the total interactions of the publication', () => {
    const row = postStats(post('a', metrics, { spend: 120, impressions: 20000 }));
    expect(row.interactions).toBe(600);
    expect(row.cpe).toBe(0.2);
    expect(row.cpm).toBe(6);
  });
  it('stays empty without a budget, with an unknown interaction or without any interaction', () => {
    expect(postStats(post('b', metrics)).cpe).toBeNull();
    expect(postStats(post('c', { impressions: 1000, likes: 5 }, { spend: 10, impressions: 100 })).cpe).toBeNull();
    expect(postStats(post('d', { impressions: 1000, likes: 0, comments: 0, shares: 0 }, { spend: 10, impressions: 100 })).cpe).toBeNull();
  });
  it('gives an ad-only row its own spend over its interactions', () => {
    const ad = { platform: 'instagram', ad_id: 'i', title: 'Pub', thumbnail_url: '', first_day: '2026-10-01', spend: 24, impressions: 5000, permalink: '' };
    expect(paidAdStats({ ...ad, likes: 10, comments: 1, shares: 1 }).cpe).toBe(2);
    expect(paidAdStats({ ...ad, likes: 10, comments: null, shares: 1 }).cpe).toBeNull();
    expect(paidAdStats({ ...ad, likes: 0, comments: 0, shares: 0 }).cpe).toBeNull();
  });
  it('sorts the table on the CPE, rows without one always last', () => {
    const rows = [
      post('a', metrics),
      post('b', metrics, { spend: 100, impressions: 1000 }),
      post('c', { impressions: 1000, likes: 15, comments: 3, shares: 2 }, { spend: 100, impressions: 1000 }),
    ].map(postStats);
    expect(sortRows(rows, 'cpe', 'asc').map(r => r.id)).toEqual(['b', 'c', 'a']);
    expect(sortRows(rows, 'cpe', 'desc').map(r => r.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('audience', () => {
  it('folds Instagram gender/age and keeps TikTok percentages', () => {
    const rows = [{ platform: 'instagram', dimension: 'genderAge', label: 'F.18-24', value: 30, unit: 'count' }, { platform: 'instagram', dimension: 'genderAge', label: 'M.18-24', value: 70, unit: 'count' }, { platform: 'tiktok', dimension: 'gender', label: 'Male', value: 63, unit: 'percent' }];
    expect(audienceBreakdowns(rows, 'instagram').gender).toEqual([{ label: 'Hommes', value: 70, percent: 70 }, { label: 'Femmes', value: 30, percent: 30 }]);
    expect(audienceBreakdowns(rows, 'tiktok').gender[0]).toEqual({ label: 'Hommes', value: 63, percent: 63 });
    expect(audienceBreakdowns(rows, 'facebook').country).toEqual([]);
  });
});

describe('audience panels', () => {
  const fb = (dimension: string, label: string, value: number) => ({ platform: 'facebook', dimension, label, value, unit: 'count' });
  it('shows only country and city for Facebook, which does not provide gender or age', () => {
    const a = audienceBreakdowns([fb('country', 'FR', 90), fb('country', 'BE', 10), fb('city', 'Paris', 50)], 'facebook');
    expect(audiencePanels('facebook', a).map(x => x.key)).toEqual(['country', 'city']);
    expect(a.country[0]).toEqual({ label: 'France', value: 90, percent: 90 });
    expect(a.country[1]?.label).toBe('Belgique');
  });
  it('keeps gender and age for Facebook once they exist, and the usual panels elsewhere', () => {
    const a = audienceBreakdowns([fb('genderAge', 'F.25-34', 60), fb('genderAge', 'M.25-34', 40)], 'facebook');
    expect(audiencePanels('facebook', a).map(x => x.key)).toEqual(['gender', 'age', 'country', 'city']);
    const empty = audienceBreakdowns([], 'instagram');
    expect(audiencePanels('instagram', empty).map(x => x.key)).toEqual(['gender', 'age', 'country', 'city']);
    expect(audiencePanels('tiktok', audienceBreakdowns([], 'tiktok')).map(x => x.key)).toEqual(['gender', 'age', 'country']);
    expect(audiencePanels('linkedin', audienceBreakdowns([], 'linkedin')).map(x => x.key)).toEqual(['country', 'industry', 'function', 'seniority']);
  });
  it('shows country codes as French names and keeps any other label as it is', () => {
    expect(countryName('FR')).toBe('France');
    expect(countryName('de')).toBe('Allemagne');
    expect(countryName('urn:li:geo:101174742')).toBe('urn:li:geo:101174742');
    expect(countryName('Paris')).toBe('Paris');
  });
  it('describes the Facebook breakdown as people who like the Page', () => {
    expect(definition('audienceCountry', 'facebook')).toContain('aiment la Page');
    expect(definition('audienceCountry', 'instagram')).not.toContain('aiment');
  });
});

describe('export and definitions', () => {
  it('builds the requested file name', () => {
    expect(pdfFileName('Global', 'Edition 2025')).toBe('Dashboard-Demo-Event_Global_Edition-2025.pdf');
  });
  it('documents special cases', () => {
    expect(definition('impressions', 'tiktok')).toContain('vidéos publiées');
    expect(definition('clicks', 'linkedin')).toContain('exclus');
    expect(definition('topCpm', 'linkedin')).toContain('créative');
  });
});

import { paidOnlyAds, paidAdStats } from '@/lib/top-posts';
describe('publication types', () => {
  it('sponsored posts are Paid (and still organic posts of the account), others Organique', () => {
    expect(postStats(post('a', { impressions: 1 })).type).toBe('Organique');
    const paid = postStats(post('b', { impressions: 1 }, { spend: 5, impressions: 100 }));
    expect(paid.type).toBe('Paid');
    expect(paid.organic).toBe(true);
    expect(paidAdStats({ platform: 'instagram', ad_id: 'x', title: 't', thumbnail_url: '', first_day: '2026-10-01', spend: 5, impressions: 100, likes: null, comments: null, shares: null, permalink: '' }).organic).toBe(false);
  });
  it('keeps the rule-link marker and cleans the permalink', () => {
    const linked = postStats({ ...post('l', { impressions: 1 }, { spend: 9, impressions: 900 }), adLink: 'rule' as const, platform: 'instagram', permalink: 'https://www.instagram.com/p/abc/' });
    expect(linked.adLink).toBe('rule');
    expect(linked.permalink).toBe('https://www.instagram.com/p/abc/');
    expect(postStats({ ...post('m', { impressions: 1 }), permalink: 'javascript:alert(1)' }).permalink).toBe('');
    expect(postStats(post('n', { impressions: 1 })).adLink).toBeNull();
  });
  it('builds the Facebook link of an ad-only publication from its page_post id', () => {
    const d = { platform: 'facebook', ad_id: 'f1', day: '2026-10-01', post_id: '12345678901234_23456789012345', spend: 10, impressions: 2000, likes: 5, comments: 1, shares: 0 };
    const [ad] = paidOnlyAds([d], [{ platform: 'facebook', ad_id: 'f1', ad_name: 'Pub' }], new Set());
    expect(paidAdStats(ad!).permalink).toBe('https://www.facebook.com/12345678901234/posts/23456789012345');
    const [other] = paidOnlyAds([{ ...d, platform: 'instagram', post_id: 'ig_media' }], [{ platform: 'instagram', ad_id: 'f1', ad_name: 'Pub' }], new Set());
    expect(paidAdStats(other!).permalink).toBe('');
  });
  it('ranks visibility and engagement on the period posts only, but lets older promoted posts win the CPM', () => {
    const inPeriod = [post('new', { impressions: 20000, likes: 100, comments: 0, shares: 0 }, { spend: 40, impressions: 4000 })].map(postStats);
    const older = [post('old', { impressions: 120000, likes: 900, comments: 50, shares: 50 }, { spend: 200, impressions: 100000 })].map(postStats);
    const best = topPosts(inPeriod, older);
    expect(best.visibility?.id).toBe('new');
    expect(best.engagement?.id).toBe('new');
    expect(best.cpm?.id).toBe('old');
    expect(topPosts(inPeriod).cpm?.id).toBe('new');
  });
  it('falls back to the older promoted posts when no post of the period can be ranked', () => {
    const older = [post('old', { impressions: 120000, likes: 900, comments: 50, shares: 50 }, { spend: 200, impressions: 100000 })].map(postStats);
    const best = topPosts([], older);
    expect(best.visibility?.id).toBe('old');
    expect(best.engagement?.id).toBe('old');
    expect(topPosts([], []).visibility).toBeNull();
    // A post of the period that can be ranked always wins over the older ones.
    const inPeriod = [post('new', { impressions: 10, likes: 1, comments: 0, shares: 0 })].map(postStats);
    expect(topPosts(inPeriod, older).visibility?.id).toBe('new');
  });
  it('names the carousel format per network, never both names side by side', () => {
    expect(formatLabel('instagram', 'Carrousel / Album')).toBe('Carrousel');
    expect(formatLabel('linkedin', 'Carrousel / Album')).toBe('Carrousel');
    expect(formatLabel('facebook', 'Carrousel / Album')).toBe('Album');
    expect(formatLabel('facebook', 'Photo')).toBe('Photo');
    expect(postStats({ ...post('c', { impressions: 1 }), format: 'Carrousel / Album', platform: 'facebook' }).format).toBe('Album');
    expect(postStats({ ...post('c', { impressions: 1 }), format: 'Carrousel / Album' }).format).toBe('Carrousel');
  });
  it('gives a TikTok ad row no views, so it ranks after the videos', () => {
    const row = paidAdStats({ platform: 'tiktok', ad_id: 't', title: 'Pub', thumbnail_url: '', first_day: '2026-10-01', spend: 20, impressions: 5000, likes: 10, comments: 1, shares: 1, permalink: '' });
    expect(row.impressions).toBeNull();
    expect(row.rate).toBeNull();
    expect(row.cpm).toBe(4);
    expect(paidAdStats({ platform: 'instagram', ad_id: 'i', title: 'Pub', thumbnail_url: '', first_day: '2026-10-01', spend: 20, impressions: 5000, likes: 10, comments: 1, shares: 1, permalink: '' }).impressions).toBe(5000);
  });
  it('sorts the top table on any column, absent values always last', () => {
    const rows = [
      post('a', { impressions: 100, likes: 5, comments: 1, shares: 0 }),
      post('b', { impressions: 300, likes: 1, comments: 0, shares: 0 }, { spend: 30, impressions: 3000 }),
      post('c', { impressions: 200, likes: 9, comments: 4, shares: 2 }),
    ].map(postStats);
    expect(sortRows(rows, 'impressions', 'desc').map(r => r.id)).toEqual(['b', 'c', 'a']);
    expect(sortRows(rows, 'impressions', 'asc').map(r => r.id)).toEqual(['a', 'c', 'b']);
    expect(sortRows(rows, 'likes', 'desc').map(r => r.id)).toEqual(['c', 'a', 'b']);
    // Only "b" has a budget: it is first when descending and still first when ascending (absent values last).
    expect(sortRows(rows, 'spend', 'desc')[0]?.id).toBe('b');
    expect(sortRows(rows, 'spend', 'asc')[0]?.id).toBe('b');
    expect(sortRows(rows, 'type', 'asc').map(r => r.type)).toEqual(['Organique', 'Organique', 'Paid']);
    expect(sortRows(rows, 'ts', 'asc')).toHaveLength(3);
    // Sorting never changes the input.
    expect(rows.map(r => r.id)).toEqual(['a', 'b', 'c']);
  });
  it('shows reels vertically, from the format or from a /reel/ link', () => {
    expect(postStats({ ...post('r', { impressions: 1 }), format: 'Reel' }).vertical).toBe(true);
    expect(postStats({ ...post('v', { impressions: 1 }), format: 'Vidéo', permalink: 'https://www.instagram.com/reel/abc/' }).vertical).toBe(true);
    expect(postStats({ ...post('p', { impressions: 1 }), permalink: 'https://www.instagram.com/p/abc/' }).vertical).toBe(false);
  });
  it('ignores spend below the minimum for the top CPM', () => {
    const rows = [post('tiny', { impressions: 10 }, { spend: 0.2, impressions: 1000 }), post('real', { impressions: 10 }, { spend: 50, impressions: 10000 })].map(postStats);
    expect(topPosts(rows).cpm?.id).toBe('real');
    expect(topPosts([postStats(post('tiny', { impressions: 10 }, { spend: 0.2, impressions: 1000 }))]).cpm).toBeNull();
  });
  it('keeps only ads without a matching account publication as Paid rows', () => {
    const d = (ad_id: string, post_id: string | null) => ({ platform: 'instagram', ad_id, day: '2026-10-01', post_id, spend: 10, impressions: 2000, likes: 5, comments: 1, shares: 0 });
    const ads = paidOnlyAds([d('dark', 'x'), d('dark', null), d('linked', 'p1')], [{ platform: 'instagram', ad_id: 'dark', ad_name: 'Pub' }], new Set(['instagram:p1']));
    expect(ads.map(a => a.ad_id)).toEqual(['dark']);
    const row = paidAdStats(ads[0]!);
    expect(row.type).toBe('Paid'); expect(row.spend).toBe(20); expect(row.cpm).toBe(5); expect(row.interactions).toBe(12);
  });
  it('keeps the days of an ad that are not yet attributed to a stored post (partly re-imported history)', () => {
    const d = (day: string, post_id: string | null) => ({ platform: 'instagram', ad_id: 'mixed', day, post_id, spend: 10, impressions: 2000, likes: null, comments: null, shares: null });
    const ads = paidOnlyAds([d('2026-10-06', 'old-copy-id'), d('2026-10-07', 'old-copy-id'), d('2026-10-12', 'p1'), d('2026-10-13', 'p1')], [{ platform: 'instagram', ad_id: 'mixed', ad_name: 'Pub' }], new Set(['instagram:p1']));
    expect(ads).toHaveLength(1);
    expect(ads[0]).toMatchObject({ ad_id: 'mixed', spend: 20, first_day: '2026-10-06' });
    expect(paidOnlyAds([d('2026-10-12', 'p1')], [], new Set(['instagram:p1']))).toEqual([]);
  });
});

describe('flops', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  const at = (id: string, daysAgo: number, m: Record<string, number>, extra: Record<string, unknown> = {}) => postStats({ ...post(id, m), published_at: new Date(now - daysAgo * 86_400_000).toISOString(), ...extra });
  const full = (impressions: number, likes = 1) => ({ impressions, likes, comments: 0, shares: 0 });
  it('ranks the least seen and the least engaging publications, from the weakest', () => {
    const rows = [at('a', 10, full(1000, 100)), at('b', 10, full(50, 1)), at('c', 10, full(200, 2)), at('d', 10, full(900, 90)), at('e', 10, full(100, 50)), at('f', 10, full(800, 8))];
    const flops = flopPosts(rows, now);
    expect(flops.visibility.rows.map(r => r.id)).toEqual(['b', 'e', 'c']);
    // c et f à 1 % : à égalité, la moins vue passe devant.
    expect(flops.engagement.rows.map(r => r.id)).toEqual(['c', 'f', 'b']);
    expect(flops.visibility.rows).toHaveLength(FLOP_COUNT);
  });
  it('does not rank publications younger than three days', () => {
    const rows = [at('new', 1, full(1)), at('edge', 2.9, full(1)), at('ok', 3, full(500)), at('old', 20, full(900)), at('older', 30, full(700))];
    const flops = flopPosts(rows, now);
    expect(flops.visibility.rows.map(r => r.id)).not.toContain('new');
    expect(flops.visibility.rows.map(r => r.id)).not.toContain('edge');
    expect(flops.visibility.eligible).toBe(3);
  });
  it('does not rank publications with missing or zero figures', () => {
    const rows = [at('none', 10, {}), at('zero', 10, full(0)), at('noshares', 10, { impressions: 10, likes: 0, comments: 0 }), at('a', 10, full(300, 3)), at('b', 10, full(400, 4))];
    const flops = flopPosts(rows, now);
    expect(flops.visibility.eligible).toBe(3);
    expect(flops.visibility.rows.map(r => r.id)).toEqual(['noshares']);
    expect(flops.engagement.eligible).toBe(2);
    expect(flops.engagement.rows.map(r => r.id)).toEqual(['a']);
  });
  it('never flags more than half of the comparable publications, and nothing below two', () => {
    expect(flopPosts([at('a', 10, full(10))], now).visibility).toEqual({ eligible: 1, rows: [] });
    expect(flopPosts([at('a', 10, full(10)), at('b', 10, full(20))], now).visibility.rows.map(r => r.id)).toEqual(['a']);
    expect(flopPosts([at('a', 10, full(10)), at('b', 10, full(20)), at('c', 10, full(30)), at('d', 10, full(40))], now).visibility.rows).toHaveLength(2);
  });
  it('only ranks account publications, never ad rows', () => {
    const ad = { ...at('ad:x', 10, full(1)), organic: false };
    const rows = [ad, at('a', 10, full(500)), at('b', 10, full(600))];
    expect(flopPosts(rows, now).visibility.eligible).toBe(2);
  });
  it('keeps a boosted account publication in the ranking, flagged Paid', () => {
    const rows = [postStats({ ...post('boosted', full(20), { spend: 30, impressions: 1000 }), published_at: '2026-10-01T10:00:00Z' }), at('a', 10, full(500)), at('b', 10, full(600))];
    const flops = flopPosts(rows, now);
    expect(flops.visibility.rows[0]?.id).toBe('boosted');
    expect(flops.visibility.rows[0]?.type).toBe('Paid');
  });
});

describe('format filter options', () => {
  it('names videos and unknown formats the way the formats panel does', () => {
    expect(postFormat('instagram', 'Reel')).toBe('Vidéo');
    expect(postFormat('instagram', 'Vidéo')).toBe('Vidéo');
    expect(postFormat('tiktok', 'Autre')).toBe('Vidéo');
    expect(postFormat('instagram', 'Post')).toBe('Non disponible');
    expect(postFormat('facebook', 'Carrousel / Album')).toBe('Album');
    expect(postFormat('linkedin', 'Carrousel / Album')).toBe('Carrousel');
    expect(postStats({ ...post('r', { impressions: 1 }), format: 'Reel' }).format).toBe('Vidéo');
  });
  it('lists only the formats present, in the usual order', () => {
    const rows = [{ ...post('a', { impressions: 1 }), format: 'Autre' }, { ...post('b', { impressions: 1 }), format: 'Vidéo' }, { ...post('c', { impressions: 1 }), format: 'Photo' }, { ...post('d', { impressions: 1 }), format: 'Photo' }].map(postStats);
    expect(formatOptions(rows)).toEqual(['Photo', 'Vidéo', 'Autre']);
    expect(formatOptions([])).toEqual([]);
  });
});

describe('table pages', () => {
  it('shows ten rows per page', () => {
    expect(TABLE_PAGE_SIZE).toBe(10);
  });
  it('lists the first, last and current pages with their neighbours, and a gap only where two pages or more are skipped', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(1, 27)).toEqual([1, 2, '…', 27]);
    expect(pageWindow(4, 27)).toEqual([1, 2, 3, 4, 5, '…', 27]);
    expect(pageWindow(14, 27)).toEqual([1, '…', 13, 14, 15, '…', 27]);
    expect(pageWindow(27, 27)).toEqual([1, '…', 26, 27]);
  });
});
