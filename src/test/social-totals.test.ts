import { describe, expect, it, vi } from 'vitest';
import { realBlendedTotals, realAllNetworkTotals, type SocialDay, type SocialPost } from '../lib/social-totals';
import { comparablePoints, coverageDetails, prevShown } from '../components/dashboard/common';
import { mergeOrganicHistory, type ManualOrganicDay } from '../lib/social-organic-history';
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
    // Facebook : les totaux des publications comprennent déjà les réactions des annonces, elles ne sont pas ajoutées (15 = 10 + 2 + 3 de la publication).
    expect(totals[0]?.interactions).toBe(15);
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
    expect(facebook.interactions).toBe(15);
    expect(facebook.cpe).toBe(20 / 15);
    const global = realAllNetworkTotals(PLATFORMS.map(({ id }) => realBlendedTotals(id, days, posts, period, [])));
    expect(global.cpe).toBe((global.spend ?? 0) / (global.interactions ?? 1));
    // Without the organic source the Facebook interactions are unavailable (the paid actions alone never stand for the total), and so is the CPE.
    const noOrganic = realBlendedTotals('facebook', days.filter(d => d.source !== 'facebook_organic'), posts, period, []);
    expect(noOrganic.interactions).toBeNull();
    expect(noOrganic.cpe).toBeNull();
    expect(noOrganic.missing['cpe']).toEqual(['facebook:organic']);
    // La diffusion payante d'Instagram (compte) et de LinkedIn reste traitée comme avant : LinkedIn additionne ses annonces.
    const linkedin = realBlendedTotals('linkedin', days, posts, period, []);
    expect(linkedin.interactions).toBe(30);
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
  it('Facebook: reactions, comments and shares of the posts already include the ads\' ones; impressions and video views still add the paid delivery', () => {
    const period = { start: '2025-07-01', end: '2025-07-03' };
    const post = (id: string, day: string, likes: number | null) => ({ platform: 'facebook', post_id: id, published_at: `${day}T10:00:00Z`, title: id, format: 'Photo', permalink: '', thumbnail_path: null, metrics: { impressions: 900, likes, comments: 4, shares: 6 } });
    const posts: SocialPost[] = [post('a', '2025-07-01', 100), post('b', '2025-07-02', 50)];
    const days: SocialDay[] = [];
    for (const day of ['2025-07-01', '2025-07-02', '2025-07-03']) {
      // Organique : réactions des publications du jour (à vie), impressions et vues de vidéo organiques du compte ; payant : actions Meta Ads, impressions, vues de vidéo, clics.
      days.push({ platform: 'facebook', source: 'facebook_organic', day, followers_estimated: false, metrics: { postsAvailable: 1, impressions: 1000, videoViews: 200, likes: day === '2025-07-03' ? 0 : 75, comments: 2, shares: 3, linkClicks: 10 } });
      days.push({ platform: 'facebook', source: 'facebook', day, followers_estimated: false, metrics: { spend: 30, impressions: 5000, videoViews: 800, likes: 40, comments: 5, shares: 7, linkClicks: 20 } });
    }
    const t = realBlendedTotals('facebook', days, posts, period, []);
    // Interactions : l'organique seul (publications, annonces comprises), jamais les actions Meta Ads en plus.
    expect(t.interactions).toBe(3 * (2 + 3) + 150);
    expect(t.interactionBreakdown.map(b => b.v)).toEqual([150, 6, 9]);
    // Impressions et vues de vidéo : l'organique du compte exclut le payant, qui s'y ajoute.
    expect(t.impressions).toBe(3 * (1000 + 5000));
    expect(t.videoViews).toBe(3 * (200 + 800));
    expect(t.cpe).toBeCloseTo(90 / t.interactions!, 9);
    expect(t.cpm).toBeCloseTo((90 / 15_000) * 1000, 9);
    // Clics : organique + payant, avec leur couverture sous la clé « clicks » lue par Global et les cartes.
    expect(t.clicks).toBe(3 * (10 + 20));
    expect(t.missing['clicks']).toEqual([]);
    const noOrganic = realBlendedTotals('facebook', days.filter(d => d.source !== 'facebook_organic'), posts, period, []);
    expect(noOrganic.missing['clicks']).toEqual(['facebook:organic']);
    expect(realAllNetworkTotals([noOrganic]).missing['clicks']).toEqual(['facebook:organic']);
  });
  describe('Facebook with the export first: the ads\' actions are added on the days read from the export only', () => {
    const period = { start: '2025-07-01', end: '2025-07-04' };
    const providerDay = (day: string, extra: Record<string, number> = {}): SocialDay => ({ platform: 'facebook', source: 'facebook_organic', day, followers_estimated: false, metrics: { postsAvailable: 1, impressions: 1000, videoViews: 100, likes: 80, comments: 8, shares: 4, ...extra } });
    const paidDay = (day: string): SocialDay => ({ platform: 'facebook', source: 'facebook', day, followers_estimated: false, metrics: { spend: 10, impressions: 4000, videoViews: 300, likes: 40, comments: 5, shares: 7, linkClicks: 3 } });
    const exportDay = (day: string): ManualOrganicDay => ({ platform: 'facebook', day, organic_views: null, organic_impressions: 900, organic_video_views: 90, organic_likes: 20, organic_comments: 2, organic_shares: 4, posts_published: 1 });
    const all = ['2025-07-01', '2025-07-02', '2025-07-03', '2025-07-04'];
    // Les deux premiers jours sont couverts par l'export, les deux derniers ne sont lus que du connecteur.
    const merged = (first: readonly string[]) => mergeOrganicHistory([...all.map(d => providerDay(d)), ...all.map(paidDay)], [exportDay('2025-07-01'), exportDay('2025-07-02')], first);
    const video = (id: string, day: string): SocialPost => ({ platform: 'facebook', post_id: id, published_at: `${day}T09:00:00Z`, title: id, format: 'Vidéo', permalink: '', thumbnail_path: null, metrics: { impressions: 500, likes: 0, comments: 1, shares: 1 } });
    it('flags the days whose likes and comments come from the export', () => {
      const days = merged(['facebook']).filter(d => d.source === 'facebook_organic');
      expect(days.map(d => [d.metrics['manualLikes'] ?? 0, d.metrics['manualComments'] ?? 0])).toEqual([[1, 1], [1, 1], [0, 0], [0, 0]]);
      // Sans l'export en premier, le connecteur garde ses valeurs positives : aucun jour n'est lu de l'export.
      expect(merged([]).filter(d => d.source === 'facebook_organic').every(d => d.metrics['manualLikes'] == null)).toBe(true);
    });
    it('adds the paid likes and comments on export days, never on connector days, and never the paid shares', () => {
      const t = realBlendedTotals('facebook', merged(['facebook']), [], period, []);
      // Jours export : 20 + 40 j'aime, 2 + 5 commentaires, 4 partages ; jours connecteur : 80 j'aime, 8 commentaires, 4 partages, sans payant.
      expect(t.interactionBreakdown.map(b => b.v)).toEqual([2 * (20 + 40) + 2 * 80, 2 * (2 + 5) + 2 * 8, 4 * 4]);
      expect(t.interactions).toBe(2 * 60 + 160 + 2 * 7 + 16 + 16);
      // Impressions et vues de vidéo : l'organique du compte exclut le payant, qui s'y ajoute sur tous les jours.
      expect(t.impressions).toBe(2 * 900 + 2 * 1000 + 4 * 4000);
      expect(t.cpe).toBeCloseTo(40 / t.interactions!, 9);
    });
    it('is partial, never a guess, when a day read from the export has no paid row', () => {
      const noPaidDay = merged(['facebook']).filter(d => !(d.source === 'facebook' && d.day === '2025-07-02'));
      const t = realBlendedTotals('facebook', noPaidDay, [], period, []);
      expect(t.missing['likes']).toEqual(['facebook:paid', 'facebook:export:2025-07-02']);
      expect(t.missing['interactions']).toEqual(['facebook:paid', 'facebook:export:2025-07-02']);
    });
    it('flags the videos published on connector days, which the connector gives no reaction total, and says what is missing', () => {
      const posts = [video('on-export', '2025-07-02'), video('on-connector', '2025-07-03'), video('later', '2025-07-04')];
      const t = realBlendedTotals('facebook', merged(['facebook']), posts, period, []);
      expect(t.missing['likes']).toEqual(['facebook:videos:2', 'facebook:export:2025-07-02']);
      expect(t.missing['interactions']).toEqual(['facebook:videos:2', 'facebook:export:2025-07-02']);
      expect(coverageDetails(t, 'interactions').tooltip).toContain('2 vidéos Facebook sans nombre de j’aime');
      // Une vidéo publiée un jour couvert par l'export n'est pas signalée.
      expect(realBlendedTotals('facebook', merged(['facebook']), [video('on-export', '2025-07-02')], period, []).missing['likes']).not.toContain('facebook:videos:1');
      // Une vidéo dont le connecteur donne les j'aime n'est pas comptée comme inconnue.
      const withLikes = { ...video('liked', '2025-07-03'), metrics: { impressions: 500, likes: 12, comments: 1, shares: 1 } };
      expect(realBlendedTotals('facebook', merged(['facebook']), [withLikes], period, []).missing['likes']).toEqual(['facebook:export:2025-07-02']);
      // Sans organique connu, aucun drapeau de plus : le total est déjà indisponible.
      const noOrganic = realBlendedTotals('facebook', merged(['facebook']).filter(d => d.source !== 'facebook_organic'), posts, period, []);
      expect(noOrganic.missing['likes']).toEqual(['facebook:organic']);
    });
    it('marks a period that runs past the last day of the imported history as another definition, and only then', () => {
      const inside = realBlendedTotals('facebook', merged(['facebook']), [], { start: '2025-07-01', end: '2025-07-02' }, []);
      expect(inside.missing['likes']).toBeUndefined();
      expect(inside.missing['interactions']).toEqual([]);
      const past = realBlendedTotals('facebook', merged(['facebook']), [], period, []);
      expect(past.missing['likes']).toEqual(['facebook:export:2025-07-02']);
      expect(past.missing['comments']).toEqual(['facebook:export:2025-07-02']);
      expect(past.missing['interactions']).toEqual(['facebook:export:2025-07-02']);
      expect(coverageDetails(past, 'interactions').tooltip).toContain('réactions lues du connecteur sur des jours que l’historique importé ne couvre pas (il s’arrête le 02/07/2025)');
      // Avant le premier jour de l'historique, ou dans un trou : mêmes jours lus du connecteur, même drapeau.
      const before = realBlendedTotals('facebook', [...['2025-06-29', '2025-06-30'].flatMap(d => [providerDay(d), paidDay(d)]), ...merged(['facebook'])], [], { start: '2025-06-29', end: '2025-07-02' }, []);
      expect(before.missing['likes']).toEqual(['facebook:export:2025-07-02']);
      // Deux périodes lues du seul connecteur (aucun jour importé chargé) se comparent entre elles : pas de drapeau.
      const connectorOnly = realBlendedTotals('facebook', [...all.map(d => providerDay(d)), ...all.map(paidDay)], [], period, []);
      expect(connectorOnly.missing['likes']).toBeUndefined();
    });
  });
  it('compares a rate in points only between periods that cover the same sources', () => {
    const period = { start: '2025-09-15', end: '2025-09-15' };
    const posts: SocialPost[] = [];
    const days: SocialDay[] = [{ platform: 'facebook', source: 'facebook_organic', day: period.end, followers_estimated: false, metrics: { postsAvailable: 1, impressions: 1000, likes: 50, comments: 0, shares: 0 } }];
    const full = realBlendedTotals('facebook', days.concat({ platform: 'facebook', source: 'facebook', day: period.end, followers_estimated: false, metrics: { spend: 10, impressions: 1000, likes: 0, comments: 0, shares: 0 } }), posts, period, []);
    const partial = realBlendedTotals('facebook', days.filter(d => d.source !== 'facebook_organic'), posts, period, []);
    expect(comparablePoints(full, full, 'engagementRate')).toBe(0);
    expect(comparablePoints(full, { ...full, engagementRate: 1 }, 'engagementRate')).toBe((full.engagementRate ?? 0) - 1);
    expect(comparablePoints(full, { ...full, missing: { engagementRate: ['facebook:organic'] } }, 'engagementRate')).toBeUndefined();
    expect(comparablePoints(full, { ...full, engagementRate: null }, 'engagementRate')).toBeUndefined();
    expect(partial.engagementRate).toBeNull();
  });
  it('marks the compared value « partiel » only when its coverage differs from the displayed period and a figure is shown', () => {
    const period = { start: '2025-09-15', end: '2025-09-15' };
    const day = (source: string, metrics: Record<string, number>): SocialDay => ({ platform: 'facebook', source, day: period.end, followers_estimated: false, metrics });
    const full = realBlendedTotals('facebook', [day('facebook_organic', { postsAvailable: 1, impressions: 1000, likes: 5, comments: 0, shares: 0 }), day('facebook', { spend: 10, impressions: 1000, likes: 0, comments: 0, shares: 0 })], [], period, []);
    const partial = { ...full, missing: { ...full.missing, impressions: ['linkedin:organic'] } };
    expect(prevShown(full, partial, 'impressions', '1,9M')).toBe('1,9M (partiel)');
    // Même périmètre partiel des deux côtés : comparaison loyale, aucun marqueur ; période comparée complète : aucun marqueur.
    expect(prevShown(partial, partial, 'impressions', '1,9M')).toBe('1,9M');
    expect(prevShown(partial, full, 'impressions', '1,9M')).toBe('1,9M');
    // Un chiffre non affiché n'est jamais marqué partiel.
    expect(prevShown(full, partial, 'impressions', 'Donnée non disponible')).toBe('Donnée non disponible');
    expect(prevShown(full, { ...partial, sourceUnavailable: true }, 'impressions', 'Donnée non disponible')).toBe('Source indisponible');
    // Une clé sans liste de couverture (publications, budget...) n'est jamais marquée.
    expect(prevShown(full, partial, 'spend', '1,5K€')).toBe('1,5K€');
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
    it('adds the Meta Ads video views of the period to the views of the videos published in it, like the other networks', () => {
      const t = realBlendedTotals('instagram', igDays({ videoViews: 777 }), publications, igPeriod, []);
      expect(t.videoViews).toBe(300 + 3 * 777);
      // Les vues organiques d'une publication excluent le payant : pas de recouvrement ; le CPV reste budget ÷ vues payantes.
      expect(t.cpv).toBeCloseTo(15 / (3 * 777), 9);
      expect(t.missing['videoViews']).toBeUndefined();
    });
    it('flags the video views partial when the paid views of some days are unknown, and never shows the paid views alone', () => {
      const unknownPaid = igDays().map(d => (d.source === 'facebook' && d.day === '2025-09-16' ? { ...d, metrics: { ...d.metrics, videoViews: null } } : d));
      const t = realBlendedTotals('instagram', unknownPaid, publications, igPeriod, []);
      expect(t.videoViews).toBe(300);
      expect(t.missing['videoViews']).toEqual(['instagram:paid']);
      expect(realBlendedTotals('instagram', igDays({ videoViews: 777, postsAvailable: null }), publications, igPeriod, []).videoViews).toBeNull();
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
