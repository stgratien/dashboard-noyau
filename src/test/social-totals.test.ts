import { describe, expect, it, vi } from 'vitest';
import { realBlendedTotals, realAllNetworkTotals, type SocialDay, type SocialPost } from '../lib/social-totals';
import { dayNumber, isoFromDay, yesterdayISO } from '../lib/dashboard-periods';
import { PLATFORMS } from '../lib/dashboard-data';
import { formatNumber, formatEuro } from '../lib/dashboard-format';
import { periodShortcutGroups, previousEdition, comparisonFor, periodShortcuts } from '../lib/dashboard-periods';

// Configuration neutre : les éditions, le début des données et les réseaux ne viennent pas du client de ce dépôt (les faits propres au client se testent dans le dossier src/client/tests de son dépôt).
vi.mock('@/client/config', async () => (await import('@/test/fixtures/neutral-client')).neutralClientModule());

describe('real Windsor aggregates', () => {
  const period = { start: '2025-09-15', end: '2025-09-15' };
  const days: SocialDay[] = PLATFORMS.flatMap(({ id }, i) => {
    const organic = id === 'facebook' ? 'facebook_organic' : id === 'instagram' ? 'instagram' : `${id}_organic`;
    const paid = id === 'instagram' ? 'facebook' : id;
    return [organic, paid].map((source, j) => ({ platform: id, source, day: period.end, followers_estimated: false, metrics: { followers: 100 * (i + 1), newFollowers: 1, postsAvailable: 1, impressions: 1000 * (i + 1) * (j + 1), likes: 10, comments: 2, shares: 3, videoViews: 100, linkClicks: 5, spend: j ? 20 : 0 } }));
  });
  const posts: SocialPost[] = PLATFORMS.map(({ id }) => ({ platform: id, post_id: id, published_at: `${period.end}T12:00:00Z`, title: 'Test', format: 'Post', permalink: '', thumbnail_path: null, metrics: {impressions:4000,likes:10,comments:2,shares:3} }));
  it('Global exactly sums the same objects as all four platform tabs, averages from totals', () => {
    const totals = PLATFORMS.map(({ id }) => realBlendedTotals(id, days, posts, period, []));
    const global = realAllNetworkTotals(totals);
    for (const key of ['followers', 'posts', 'impressions', 'videoViews', 'interactions', 'spend'] as const) expect(global[key]).toBe(totals.reduce((a, t) => a + (t[key] ?? 0), 0));
    expect(global.impressionsPerPost).toBe((global.impressions ?? 0) / (global.posts ?? 1));
    expect(totals[0]?.interactions).toBe(30);
    expect(totals[0]?.cpm).toBe(10);
    expect(totals[0]?.cpc).toBe(4);
  });
  it('never replaces an absent source or day with zero', () => {
    const t = realBlendedTotals('facebook', days.filter(d => d.source !== 'facebook_organic'), posts, period, []);
    const paidImpressions = days.find(d => d.platform === 'facebook' && d.source === 'facebook')?.metrics['impressions'];
    expect(t.impressions).toBe(paidImpressions);
    expect(t.missing['impressions']).toEqual(['facebook:organic']);
    expect(realAllNetworkTotals([t]).impressions).toBe(paidImpressions);
    // TikTok : sans vidéos publiées connues, le payant ne remplace pas le total (il est déjà compris dans les vues des vidéos).
    const tiktok = realBlendedTotals('tiktok', days.filter(d => d.source !== 'tiktok_organic'), posts, period, []);
    expect(tiktok.impressions).toBeNull();
    expect(tiktok.interactions).toBeNull();
    expect(tiktok.missing['impressions']).toEqual(['tiktok:organic']);
    expect(realAllNetworkTotals([tiktok]).impressions).toBeNull();
    expect(realBlendedTotals('facebook', days, posts, { start: period.start, end: '2025-09-16' }, []).spend).toBeNull();
  });
  it('uses uppercase suffixes, decimal commas and adjacent euros', () => {
    expect(formatNumber(50100)).toBe('50,1K');
    expect(formatNumber(1100000)).toBe('1,1M');
    expect(formatEuro(2564)).toBe('2,6K€');
    expect(formatEuro(1200)).toBe('1,2K€');
    expect(formatEuro(0.12, 2)).toBe('0,12€');
    expect(formatEuro(1, 2)).toBe('1,00€');
    expect(formatEuro(1234, 2)).toBe('1,23K€');
    expect(formatEuro(Number.NaN)).toBe('Donnée non disponible');
    expect(formatNumber(null)).toBe('Donnée non disponible');
  });
  it('divides the budget by the total interactions (organic + paid) for the CPE, on every network and in Global', () => {
    const facebook = realBlendedTotals('facebook', days, posts, period, []);
    expect(facebook.interactions).toBe(30);
    expect(facebook.cpe).toBe(20 / 30);
    const global = realAllNetworkTotals(PLATFORMS.map(({ id }) => realBlendedTotals(id, days, posts, period, [])));
    expect(global.cpe).toBe((global.spend ?? 0) / (global.interactions ?? 1));
    // Without the organic source the interactions are partial, and so is the CPE.
    const noOrganic = realBlendedTotals('facebook', days.filter(d => d.source !== 'facebook_organic'), posts, period, []);
    expect(noOrganic.missing['cpe']).toEqual(['facebook:organic']);
  });
  it('has no CPE without a budget, never 0,00 €', () => {
    const noBudget = days.map(d => ({ ...d, metrics: { ...d.metrics, spend: 0 } }));
    const facebook = realBlendedTotals('facebook', noBudget, posts, period, []);
    expect(facebook.spend).toBe(0);
    expect(facebook.cpe).toBeNull();
    expect(realAllNetworkTotals(PLATFORMS.map(({ id }) => realBlendedTotals(id, noBudget, posts, period, []))).cpe).toBeNull();
  });
  it('uses 2-second paid views for the cost per view', () => {
    const facebook = realBlendedTotals('facebook', days, posts, period, []);
    expect(facebook.cpv).toBe(20 / 100);
    const noPaidViews = days.map(d => d.source === 'tiktok' ? { ...d, metrics: { ...d.metrics, videoViews: 0 } } : d);
    expect(realBlendedTotals('tiktok', noPaidViews, posts, period, []).cpv).toBeNull();
  });
  it('counts distinct ads with impressions and deduplicates Meta across networks', () => {
    const coverage = ['facebook', 'linkedin', 'tiktok'].map(source => ({ source, day: period.end }));
    const ads = [
      { source: 'facebook', platform: 'facebook', ad_id: 'shared', day: period.end, impressions: 100 },
      { source: 'facebook', platform: 'instagram', ad_id: 'shared', day: period.end, impressions: 200 },
      { source: 'tiktok', platform: 'tiktok', ad_id: 'shared', day: period.end, impressions: 10 },
      { source: 'linkedin', platform: 'linkedin', ad_id: 'zero', day: period.end, impressions: 0 },
    ];
    const totals = PLATFORMS.map(({ id }) => realBlendedTotals(id, days, posts, period, [], [...ads, ads[0]].filter(a => a !== undefined), coverage));
    expect(totals.map(t => t.adsDelivered)).toEqual([1, 1, 0, 1]);
    expect(realAllNetworkTotals(totals).adsDelivered).toBe(2);
    expect(realBlendedTotals('facebook', days, posts, period, [], ads, []).adsDelivered).toBeNull();
    expect(realBlendedTotals('facebook', days, posts, { ...period, end: '2025-09-16' }, [], ads, coverage).adsDelivered).toBeNull();
  });
  it('groups all shortcuts without changing exact edition comparisons', () => {
    const groups = periodShortcutGroups('2026-10-16');
    expect(groups.map(g => g.name)).toEqual(['Derniers jours', 'Mois', 'Trimestres', 'Années', 'Demo editions']);
    // Années : l'année en cours tout en haut, puis du plus récent au plus ancien ; éditions de la plus récente à la plus ancienne.
    expect(groups[3]?.items.map(s => s.name)).toEqual(['Année en cours', '2025', '2024', '2023']);
    expect(groups[4]?.items.map(s => s.name)).toEqual(['Edition 2027', 'Edition 2025', 'Edition 2023']);
    // Trimestres du plus récent au plus ancien (un trimestre pas encore commencé n'est pas proposé).
    expect(groups[2]?.items.map(s => s.name)).toEqual(['T4 2026', 'T3 2026', 'T2 2026', 'T1 2026']);
    // Les autres années sont des sous-menus, de la plus récente à la plus ancienne (rien avant le début des données : T1 2023 n'existe pas).
    expect(groups[2]?.subgroups?.map(g => g.name)).toEqual(['2025', '2024', '2023']);
    expect(groups[2]?.subgroups?.[0]?.items.map(s => s.name)).toEqual(['T4 2025', 'T3 2025', 'T2 2025', 'T1 2025']);
    expect(groups[2]?.subgroups?.[2]?.items.map(s => s.name)).toEqual(['T4 2023', 'T3 2023', 'T2 2023']);
    expect(previousEdition({ start: '2025-09-15', end: '2025-09-21' })?.start).toBe('2023-09-11');
    expect(previousEdition({ start: '2025-01-01', end: '2025-12-31' })).toBeUndefined();
  });
  it('uses TikTok published-video lifetime metrics on all periods, not daily account zeros', () => {
    const t = realBlendedTotals('tiktok',days, [...posts,...posts],period,[]);
    expect(t.posts).toBe(1);
    // Les annonces TikTok sont des posts boostés : leurs vues et interactions sont déjà dans celles des vidéos, jamais ajoutées une seconde fois.
    expect(t.impressions).toBe(4000);
    expect(t.videoViews).toBe(4000);
    expect(t.interactions).toBe(15);
    expect(t.missing['impressions']).toBeUndefined();
    // Le payant reste la base du budget et des coûts : 20 € pour 8 000 impressions payantes.
    expect(t.spend).toBe(20);
    expect(t.cpm).toBe(2.5);
    expect(t.engagementRate).toBeCloseTo(15 / 4000 * 100, 6);
  });
  it('TikTok: the promoted delivery is already in the videos\' own figures, over a whole period and in Global', () => {
    const period = { start: '2025-07-01', end: '2025-07-31' };
    const video = (id: string, day: string, impressions: number, likes: number) => ({ platform: 'tiktok', post_id: id, published_at: `${day}T10:00:00Z`, title: id, format: 'Vidéo', permalink: '', thumbnail_path: null, metrics: { impressions, likes, comments: 2, shares: 1, videoViews: 0 } });
    // Deux vidéos boostées (leurs vues dépassent un peu les impressions payantes : vues organiques en plus) et une vidéo non boostée.
    const posts: SocialPost[] = [video('a', '2025-07-03', 90_000, 300), video('b', '2025-07-21', 120_000, 900), video('c', '2025-07-25', 800, 20)];
    const days: SocialDay[] = [];
    for (let d = dayNumber(period.start); d <= dayNumber(period.end); d++) {
      const day = isoFromDay(d);
      days.push({ platform: 'tiktok', source: 'tiktok_organic', day, followers_estimated: false, metrics: { postsAvailable: 1 } });
      // 200 000 impressions payantes sur le mois (≈ les vues des deux vidéos boostées), 150 € dépensés, 1 000 j'aime payants.
      days.push({ platform: 'tiktok', source: 'tiktok', day, followers_estimated: false, metrics: { impressions: 200_000 / 31, spend: 150 / 31, videoViews: 130_000 / 31, likes: 1_000 / 31, comments: 0, shares: 0, linkClicks: 0 } });
    }
    const t = realBlendedTotals('tiktok', days, posts, period, []);
    expect(t.impressions).toBe(210_800);
    expect(t.videoViews).toBe(210_800);
    expect(t.interactions).toBe(300 + 900 + 20 + 3 * 3);
    expect(t.posts).toBe(3);
    expect(t.videos).toBe(3);
    expect(t.impressionsPerPost).toBeCloseTo(210_800 / 3, 6);
    expect(t.spend).toBeCloseTo(150, 6);
    expect(t.cpm).toBeCloseTo((150 / 200_000) * 1000, 6);
    expect(t.cpv).toBeCloseTo(150 / 130_000, 6);
    expect(t.missing['impressions']).toBeUndefined();
    expect(t.missing['interactions']).toEqual([]);
    const global = realAllNetworkTotals([t]);
    expect(global.impressions).toBe(210_800);
    expect(global.interactions).toBe(t.interactions);
    // Une période sans aucune vidéo publiée : zéro (publications connues), même si des annonces ont diffusé des vidéos plus anciennes.
    const empty = realBlendedTotals('tiktok', days, [], period, []);
    expect(empty.impressions).toBe(0);
    expect(empty.videoViews).toBe(0);
    expect(empty.engagementRate).toBeNull();
    expect(empty.spend).toBeCloseTo(150, 6);
    // Un chiffre inconnu sur une vidéo rend le total inconnu : il ne retombe pas sur le chiffre payant.
    const unknown = realBlendedTotals('tiktok', days, [{ ...(posts[0] as SocialPost), metrics: { impressions: 90_000, likes: null, comments: 2, shares: 1 } }], period, []);
    expect(unknown.impressions).toBe(90_000);
    expect(unknown.interactions).toBeNull();
    expect(unknown.missing['likes']).toEqual(['tiktok:organic']);
  });
  it('Global CPE leaves TikTok out when it has a budget but no published video, and flags the total partial', () => {
    const period = { start: '2025-09-15', end: '2025-09-15' };
    const posts: SocialPost[] = PLATFORMS.filter(({ id }) => id !== 'tiktok').map(({ id }) => ({ platform: id, post_id: id, published_at: `${period.end}T12:00:00Z`, title: 'Test', format: 'Post', permalink: '', thumbnail_path: null, metrics: { impressions: 4000, likes: 10, comments: 2, shares: 3 } }));
    const days: SocialDay[] = PLATFORMS.flatMap(({ id }) => {
      const organic = id === 'facebook' ? 'facebook_organic' : id === 'instagram' ? 'instagram' : `${id}_organic`;
      const paid = id === 'instagram' ? 'facebook' : id;
      return [organic, paid].map((source, j) => ({ platform: id, source, day: period.end, followers_estimated: false, metrics: { postsAvailable: 1, impressions: 1000 * (j + 1), likes: 10, comments: 2, shares: 3, videoViews: 100, linkClicks: 5, spend: j ? 20 : 0 } }));
    });
    const totals = PLATFORMS.map(({ id }) => realBlendedTotals(id, days, posts, period, []));
    const tiktok = totals.find(t => t.platform === 'tiktok');
    expect(tiktok?.interactions).toBe(0);
    expect(tiktok?.spend).toBe(20);
    expect(tiktok?.cpe).toBeNull();
    const others = totals.filter(t => t.platform !== 'tiktok');
    const global = realAllNetworkTotals(totals);
    expect(global.cpe).toBeCloseTo(others.reduce((a, t) => a + (t.spend ?? 0), 0) / others.reduce((a, t) => a + (t.interactions ?? 0), 0), 9);
    expect(global.missing['cpe']).toContain('tiktok');
    // Avec une vidéo publiée, TikTok revient dans le calcul.
    const withVideo = [...posts, { platform: 'tiktok', post_id: 'tiktok', published_at: `${period.end}T12:00:00Z`, title: 'Test', format: 'Vidéo', permalink: '', thumbnail_path: null, metrics: { impressions: 4000, likes: 10, comments: 2, shares: 3 } }];
    const all = PLATFORMS.map(({ id }) => realBlendedTotals(id, days, withVideo, period, []));
    expect(realAllNetworkTotals(all).missing['cpe']).not.toContain('tiktok');
    expect(realAllNetworkTotals(all).cpe).toBeCloseTo(all.reduce((a, t) => a + (t.spend ?? 0), 0) / all.reduce((a, t) => a + (t.interactions ?? 0), 0), 9);
  });
  it('carries last known followers forward but never uses a future snapshot', () => {
    const snapshots = [{platform:'linkedin',source:'linkedin_organic',day:'2025-09-14',metrics:{followers:123},followers_estimated:true},{platform:'linkedin',source:'linkedin_organic',day:'2025-09-16',metrics:{followers:999},followers_estimated:false}];
    const t=realBlendedTotals('linkedin',snapshots,[],period,[]);
    expect(t.followers).toBe(123); expect(t.estimated).toBe(true);
  });
  it('sums available networks and reports missing coverage per metric', () => {
    const totals=PLATFORMS.map(({id})=>realBlendedTotals(id,days,posts,period,[]));
    const partial=totals.map(t=>t.platform==='instagram'?{...t,followers:null,impressions:null}:t);
    const global=realAllNetworkTotals(partial);
    expect(global.followers).toBe(800);expect(global.missing['followers']).toEqual(['instagram']);
    expect(global.impressions).toBe(partial.reduce((a,t)=>a+(t.impressions??0),0));
    expect(global.impressionsPerPost).toBe((global.impressions??0)/3);
  });
  it('compares shortcut calendar periods and resets to rolling for free selection', () => {
    const shortcuts=periodShortcuts('2026-10-16');
    const expected:Record<string,{start:string;end:string}>={ 'Mois en cours':{start:'2026-09-01',end:'2026-09-15'},'Mois précédent':{start:'2026-08-01',end:'2026-08-31'},'Année en cours':{start:'2025-01-01',end:'2025-10-15'},'2024':{start:'2023-01-01',end:'2023-12-31'} };
    for(const [name,range] of Object.entries(expected)){const shortcut=shortcuts.find(s=>s.name===name);if(!shortcut)throw new Error('Missing shortcut');expect(comparisonFor(shortcut,'previous').period).toEqual(range);}
    expect(comparisonFor({start:'2026-10-01',end:'2026-10-16'},'previous').period).toEqual({start:'2026-09-15',end:'2026-09-30'});
    expect(comparisonFor({start:'2024-03-01',end:'2024-03-31',comparisonKind:'month-to-date'},'previous').period).toEqual({start:'2024-02-01',end:'2024-02-29'});
    expect(comparisonFor({start:'2024-01-01',end:'2024-02-29',comparisonKind:'year'},'previous').period).toEqual({start:'2023-01-01',end:'2023-02-28'});
  });
  describe('Instagram video views by publication date', () => {
    const igPeriod = { start: '2025-09-15', end: '2025-09-17' };
    const igDays = (extra: Record<string, number | null> = {}): SocialDay[] => ['2025-09-15', '2025-09-16', '2025-09-17'].flatMap(day => ['instagram', 'facebook'].map(source => ({ platform: 'instagram', source, day, followers_estimated: false, metrics: { impressions: 1000, likes: 1, comments: 0, shares: 0, videoViews: 0, postsAvailable: 1, spend: 5, ...extra } })));
    const post = (id: string, format: string, impressions: number | null, publishedAt: string): SocialPost => ({ platform: 'instagram', post_id: id, published_at: publishedAt, title: id, format, permalink: '', thumbnail_path: null, metrics: { impressions, likes: 0, comments: 0, shares: 0 } });
    const publications = [
      post('reel-1', 'Vidéo', 100, '2025-09-15T09:00:00Z'),
      post('reel-2', 'Vidéo', 200, '2025-09-17T20:00:00Z'),
      post('photo', 'Photo', 500, '2025-09-16T09:00:00Z'),
      post('reel-outside', 'Vidéo', 9000, '2025-09-18T09:00:00Z'),
    ];
    it('sums the views of the videos published in the period, not the account views', () => {
      const t = realBlendedTotals('instagram', igDays(), publications, igPeriod, []);
      expect(t.videoViews).toBe(300);
      expect(t.videos).toBe(2);
      expect(t.impressions).toBe(3000);
    });
    it('is not affected by a stored daily videoViews or by account views of the history', () => {
      expect(realBlendedTotals('instagram', igDays({ videoViews: 777 }), publications, igPeriod, []).videoViews).toBe(300);
    });
    it('shows 0 for a complete period without any video and null when publications are not synced', () => {
      expect(realBlendedTotals('instagram', igDays(), publications.filter(p => p.format !== 'Vidéo'), igPeriod, []).videoViews).toBe(0);
      expect(realBlendedTotals('instagram', igDays({ postsAvailable: null }), publications, igPeriod, []).videoViews).toBeNull();
    });
    it('shows unavailable data, never 0, when the Instagram account series is incomplete', () => {
      const missingDay = igDays().filter(d => !(d.source === 'instagram' && d.day === '2025-09-16'));
      const t = realBlendedTotals('instagram', missingDay, publications, igPeriod, []);
      expect(t.impressions).toBeNull();
      expect(t.interactions).toBeNull();
      expect(t.videoViews).toBeNull();
      expect(t.missing['impressions']).toEqual(['instagram:organic']);
    });
    it('adds up the known views and flags the videos without a figure, instead of blanking the total', () => {
      const withUnknown = [...publications, post('reel-new', 'Vidéo', null, '2025-09-16T12:00:00Z')];
      const t = realBlendedTotals('instagram', igDays(), withUnknown, igPeriod, []);
      expect(t.videoViews).toBe(300);
      expect(t.videos).toBe(3);
      expect(t.missing['videoViews']).toEqual(['instagram:videos:1']);
      expect(realAllNetworkTotals([t]).missing['videoViews']).toEqual(['instagram:videos:1']);
      const onlyUnknown = [...publications.filter(p => p.format !== 'Vidéo'), post('reel-new', 'Vidéo', null, '2025-09-16T12:00:00Z')];
      expect(realBlendedTotals('instagram', igDays(), onlyUnknown, igPeriod, []).videoViews).toBeNull();
    });
    it('tells where the number of publications comes from, so two bases are never compared', () => {
      const t = realBlendedTotals('instagram', igDays(), publications, igPeriod, []);
      expect(t.postsBasis).toBe('cloud');
      expect(realAllNetworkTotals([t]).postsBasis).toBe('cloud');
      expect(realBlendedTotals('instagram', igDays({ manualPostsPublished: 4 }), publications, igPeriod, []).postsBasis).toBe('agency');
      expect(realAllNetworkTotals([t, { ...t, platform: 'facebook', postsBasis: 'agency' }]).postsBasis).toBe('agency+cloud');
    });
    it('does not cite a whole network as missing when the detail already explains it', () => {
      const missingDay = igDays().filter(d => !(d.source === 'instagram' && d.day === '2025-09-16'));
      const t = realBlendedTotals('instagram', missingDay, publications, igPeriod, []);
      expect(t.impressions).toBeNull();
      expect(realAllNetworkTotals([t]).missing['impressions']).toEqual(['instagram:organic']);
    });
    it('leaves TikTok, Facebook and LinkedIn video views on their own rules', () => {
      const t = realBlendedTotals('linkedin', days, posts, period, []);
      expect(t.videoViews).toBe(200);
    });
  });
});

describe('LinkedIn new followers and the provider delay', () => {
  const y = yesterdayISO();
  const at = (offset: number) => isoFromDay(dayNumber(y) - offset);
  const row = (offset: number, newFollowers: number | null): SocialDay => ({ platform: 'linkedin', source: 'linkedin_organic', day: at(offset), followers_estimated: false, metrics: { impressions: 10, newFollowers } });
  const period = { start: at(6), end: y };
  it('adds up the days already published and flags the figure provisional when the last days have no value yet', () => {
    const days = [6, 5, 4, 3].map(o => row(o, 5)).concat([2, 1, 0].map(o => row(o, null)));
    const t = realBlendedTotals('linkedin', days, [], period, []);
    expect(t.newFollowers).toBe(20);
    expect(t.newFollowersProvisional).toBe(true);
  });
  it('is complete, not provisional, when every day has its value', () => {
    const t = realBlendedTotals('linkedin', [6, 5, 4, 3, 2, 1, 0].map(o => row(o, 2)), [], period, []);
    expect(t.newFollowers).toBe(14);
    expect(t.newFollowersProvisional).toBe(false);
  });
  it('stays unavailable when an older day has no value (no history)', () => {
    const days = [row(6, 5), row(5, null), row(4, 5), row(3, 5), row(2, null), row(1, null), row(0, null)];
    const t = realBlendedTotals('linkedin', days, [], period, []);
    expect(t.newFollowers).toBeNull();
    expect(t.newFollowersProvisional).toBe(false);
  });
  it('stays unavailable, but provisional, when only the late days are in the period', () => {
    const t = realBlendedTotals('linkedin', [row(1, null), row(0, null)], [], { start: at(1), end: y }, []);
    expect(t.newFollowers).toBeNull();
    expect(t.newFollowersProvisional).toBe(true);
  });
  it('does not change the other networks', () => {
    const ig = [6, 5].map(o => ({ platform: 'instagram', source: 'instagram', day: at(o), followers_estimated: false, metrics: { impressions: 10, newFollowers: null } }));
    expect(realBlendedTotals('instagram', ig, [], { start: at(6), end: at(5) }, []).newFollowersProvisional).toBe(false);
  });
});
