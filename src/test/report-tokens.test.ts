import { describe, it, expect, vi } from 'vitest';
import { cardLines, buildReportNotes, buildReportTokens, followersChange, youtubeTokens, longPeriod, monthLabel, networkTokens, partialNotes, periodName, previousLabel, quarterLabel, yearLabel, NOT_AVAILABLE, REPORT_NETWORKS, storyCardLines, type ReportTotals } from '../lib/report-tokens';
import type { StoryTotals } from '../lib/social-stories';

// Configuration neutre : les éditions et les réseaux ne viennent pas du client de ce dépôt (les faits propres au client se testent dans le dossier src/client/tests de son dépôt).
vi.mock('@/client/config', async () => (await import('@/test/fixtures/neutral-client')).neutralClientModule());

const empty: ReportTotals = {
  posts: null, followers: null, followerGrowth: null, followerGrowthPercent: null, adsDelivered: null, impressionsPerPost: null, impressions: null,
  videoViews: null, videos: null, interactions: null, engagementRate: null, spend: null, cpm: null, cpe: null, cpv: null, clicks: null,
};
const full: ReportTotals = {
  ...empty, posts: 24, followers: 37200, followerGrowth: 440, followerGrowthPercent: 1.2, adsDelivered: 6, impressions: 2100000, videos: 5,
  interactions: 12345, engagementRate: 0.6, spend: 1500, cpm: 4.5, cpv: 0.012,
};
const q2 = { start: '2026-04-01', end: '2026-06-30' };

describe('report tokens', () => {
  it('names a civil quarter and the one before it', () => {
    expect(quarterLabel(q2)).toBe('T2 2026');
    expect(previousLabel(q2)).toBe('T1 2026');
    expect(previousLabel({ start: '2026-01-01', end: '2026-03-31' })).toBe('T4 2025');
    expect(quarterLabel({ start: '2026-04-01', end: '2026-06-29' })).toBeNull();
    expect(quarterLabel({ start: '2026-04-02', end: '2026-06-30' })).toBeNull();
    expect(previousLabel({ start: '2026-04-02', end: '2026-06-30' })).toBe('la période précédente');
  });
  it('writes the period in full, with both years when it straddles two', () => {
    expect(longPeriod(q2)).toBe('1er avril – 30 juin 2026');
    expect(longPeriod({ start: '2025-12-15', end: '2026-01-10' })).toBe('15 décembre 2025 – 10 janvier 2026');
  });
  it('writes n.d. for every missing figure and never an empty string', () => {
    const t = networkTokens('linkedin', empty, 'T1 2026');
    expect(Object.values(t).every((v) => v === NOT_AVAILABLE)).toBe(true);
    expect(followersChange(empty, 'T1 2026')).toBe(NOT_AVAILABLE);
  });
  it('formats the values like the dashboard', () => {
    const t = networkTokens('facebook', full, 'T1 2026');
    expect(t['facebook.publications']).toBe('24');
    expect(t['facebook.followers']).toBe('37,2K');
    expect(t['facebook.videos']).toBe('5');
    expect(t['facebook.impressions']).toBe('2,1M');
    expect(t['facebook.spend']).toBe('1,5K€');
    expect(t['facebook.followers_change']).toContain('en T1 2026');
    expect(t['facebook.clicks']).toBe(NOT_AVAILABLE);
  });
  it('exposes the same marker names for Global and for each network', () => {
    const all = { global: full, linkedin: full, facebook: full, instagram: full, tiktok: full };
    const t = buildReportTokens(q2, all);
    expect(t['trimestre']).toBe('T2 2026');
    expect(t['periode_longue']).toBe('1er avril – 30 juin 2026');
    const suffixes = (prefix: string) => Object.keys(t).filter((k) => k.startsWith(`${prefix}.`)).map((k) => k.slice(prefix.length + 1)).sort();
    for (const n of REPORT_NETWORKS) expect(suffixes(n)).toEqual(suffixes('global'));
  });
  it('falls back to the written period when it is not a civil quarter', () => {
    const t = buildReportTokens({ start: '2026-04-02', end: '2026-06-30' }, { global: full, linkedin: full, facebook: full, instagram: full, tiktok: full });
    expect(t['trimestre']).toBe('2 avril – 30 juin 2026');
  });
  it('lists the figures the dashboard flags as partial, in the dashboard wording', () => {
    const li = { ...full, missing: { impressions: ['linkedin:organic'], impressionsPerPost: ['linkedin:organic'], videoViews: ['instagram:videos:3'] } };
    expect(partialNotes('linkedin', li)).toEqual([
      'LinkedIn, impressions par publication : partiel (organique LinkedIn non disponible sur cette période)',
      'LinkedIn, impressions : partiel (organique LinkedIn non disponible sur cette période)',
      'LinkedIn, vues de vidéo : partiel (3 vidéos Instagram sans nombre de vues)',
    ]);
    expect(partialNotes('global', { missing: { followers: ['YouTube'], posts: ['tiktok'] } })).toEqual([
      'Global, publications : partiel (réseau manquant : TikTok)',
      'Global, abonnés : partiel (réseau manquant : YouTube)',
      'Global, évolution des abonnés : partiel (réseau manquant : YouTube)',
    ]);
    expect(partialNotes('facebook', full)).toEqual([]);
    const all = { global: full, linkedin: li, facebook: full, instagram: full, tiktok: full };
    expect(buildReportNotes(all).every((note) => note.startsWith('LinkedIn,'))).toBe(true);
  });
  it('writes the YouTube budget of slide 51 with the compared budget, its change and its tone', () => {
    expect(youtubeTokens({ spend: 1500 }, { spend: 1000 })).toEqual({
      'youtube.spend': '1,5K€', 'youtube.spend_prev': '1K€', 'youtube.spend_change': '+50%', 'youtube.spend_tone': 'good',
    });
    expect(youtubeTokens({ spend: 800 }, { spend: 1000 })).toMatchObject({ 'youtube.spend_change': '−20%', 'youtube.spend_tone': 'bad' });
    // Sans donnée Google Ads : n.d., jamais un budget nul présumé ni une variation inventée.
    expect(youtubeTokens({ spend: 1500 }, { spend: null })).toMatchObject({ 'youtube.spend_prev': 'n.d.', 'youtube.spend_change': '—', 'youtube.spend_tone': 'neutral' });
    expect(youtubeTokens({ spend: null })).toEqual({ 'youtube.spend': 'n.d.' });
    // Le budget YouTube ne suit la comparaison que si le rapport en a une.
    const all = { global: full, linkedin: full, facebook: full, instagram: full, tiktok: full };
    expect(Object.keys(buildReportTokens(q2, all, undefined, { current: { spend: 1500 }, previous: { spend: 1000 } })).filter((k) => k.startsWith('youtube.'))).toEqual(['youtube.spend']);
  });
  it('adds the compared period as _prev markers and its label', () => {
    const previous: ReportTotals = { ...full, posts: 126, impressions: 3100000, videos: 19 };
    const all = { global: full, linkedin: full, facebook: full, instagram: full, tiktok: full };
    const t = buildReportTokens(q2, all, { label: 'T2 2024', totals: { ...all, linkedin: previous } });
    expect(t['comparaison']).toBe('T2 2024');
    expect(t['linkedin.publications_prev']).toBe('126');
    expect(t['linkedin.impressions_prev']).toBe('3,1M');
    expect(t['linkedin.videos_prev']).toBe('19');
    expect(t['facebook.publications_prev']).toBe('24');
    // Sans comparaison, aucun marqueur _prev n'existe : le modèle les laisse alors visibles plutôt que d'inventer une valeur.
    expect(Object.keys(buildReportTokens(q2, all)).some((k) => k.endsWith('_prev') || k === 'comparaison')).toBe(false);
  });
  it('names a period the way people say it: quarter, month, year, edition, else the written dates', () => {
    expect(periodName(q2)).toBe('T2 2026');
    expect(periodName({ start: '2026-09-01', end: '2026-09-30' })).toBe('septembre 2026');
    expect(periodName({ start: '2028-02-01', end: '2028-02-29' })).toBe('février 2028');
    expect(periodName({ start: '2025-01-01', end: '2025-12-31' })).toBe('2025');
    expect(periodName({ start: '2025-09-15', end: '2025-09-21' })).toBe('Edition 2025');
    expect(periodName({ start: '2026-09-20', end: '2026-10-19' })).toBe('20 septembre – 19 octobre 2026');
    expect(monthLabel({ start: '2026-09-01', end: '2026-09-29' })).toBeNull();
    expect(yearLabel({ start: '2025-01-01', end: '2025-12-30' })).toBeNull();
  });
  it('words the coverage notes like the dashboard: videos without likes, history ended, paid views', () => {
    const notes = partialNotes('facebook', { missing: { interactions: ['facebook:videos:2', 'facebook:export:2025-07-02'], videoViews: ['facebook:videos:1'] }, stories: undefined });
    expect(notes).toContain('Facebook, interactions : partiel (2 vidéos Facebook sans nombre de j’aime ; Facebook : réactions lues du connecteur sur des jours que l’historique importé ne couvre pas (il s’arrête le 02/07/2025), autre définition)');
    expect(notes).toContain('Facebook, vues de vidéo : partiel (1 vidéo Facebook sans nombre de vues)');
  });
  it('uses the period name for the {{trimestre}} marker', () => {
    const all = { global: full, linkedin: full, facebook: full, instagram: full, tiktok: full };
    expect(buildReportTokens({ start: '2026-09-01', end: '2026-09-30' }, all)['trimestre']).toBe('septembre 2026');
  });
  it('writes the card lines like the dashboard: vs value, change, and costs inverted', () => {
    const now: ReportTotals = { ...full, posts: 21, impressions: 2100000, engagementRate: 0.6, cpm: 1.1, videos: 1, videoViews: 0, missing: {} };
    const before: ReportTotals = { ...full, posts: 20, impressions: 1700000, engagementRate: 0.4, cpm: 0.89, videos: 3, videoViews: 816000, missing: {} };
    const lines = cardLines(now, before);
    expect(lines['publications']).toEqual({ vs: 'vs 20 (+5,0%)', tone: 'good' });
    expect(lines['engagementRate']).toEqual({ vs: 'vs 0,4% (+0,2pt)', tone: 'good' });
    expect(lines['cpm']?.tone).toBe('bad');
    expect(lines['videos']).toEqual({ vs: 'vs 3 (−67%)', tone: 'bad' });
    // Une comparaison absente donne « — » et aucune couleur ; un périmètre différent n'affiche aucun écart.
    expect(cardLines(now, { ...before, impressions: null })['impressions']).toEqual({ vs: 'vs —', tone: 'neutral' });
    expect(cardLines(now, { ...before, missing: { impressions: ['linkedin:organic'] } })['impressions']).toEqual({ vs: 'vs 1,7M (partiel)', tone: 'neutral' });
    // Même périmètre partiel des deux côtés : la comparaison est loyale, aucun marqueur sur la valeur comparée.
    expect(cardLines({ ...now, missing: { impressions: ['linkedin:organic'] } }, { ...before, missing: { impressions: ['linkedin:organic'] } })['impressions']?.vs).toBe('vs 1,7M (+24%)');
    // L'écart en points d'un taux est aussi muet quand les deux périodes ne couvrent pas les mêmes réseaux.
    expect(cardLines(now, { ...before, missing: { engagementRate: ['linkedin:organic'] } })['engagementRate']).toEqual({ vs: 'vs 0,4% (partiel)', tone: 'neutral' });
    const tokens = buildReportTokens(q2, { global: now, linkedin: now, facebook: now, instagram: now, tiktok: now }, { label: 'T2 2024', totals: { global: before, linkedin: before, facebook: before, instagram: before, tiktok: before } });
    expect(tokens['linkedin.publications_vs']).toBe('vs 20 (+5,0%)');
    expect(tokens['linkedin.cpm_tone']).toBe('bad');
  });
  it('writes the Instagram stories figures, with the compared period, only when the network carries them', () => {
    const base: StoryTotals = { coverage: 'full', coveredDays: 91, days: 91, firstCoveredDay: '2026-04-01', headDays: 0, contiguous: true, tailDays: 0, tailOpen: false, incompleteDays: 0, failed: false, count: 233, views: 1400000, viewsPerStory: 5800, interactions: 18700, withoutViews: 0, withoutInteractions: 0 };
    const before: StoryTotals = { ...base, count: 200, views: 1000000, viewsPerStory: 5000, interactions: 20000 };
    const tokens = networkTokens('instagram', { ...full, stories: base }, 'T1 2026', { ...full, stories: before });
    expect(tokens['instagram.stories']).toBe('233');
    expect(tokens['instagram.storyViews']).toBe('1,4M');
    expect(tokens['instagram.storyViewsPerStory']).toBe('5,8K');
    expect(tokens['instagram.storyInteractions']).toBe('18,7K');
    expect(tokens['instagram.stories_prev']).toBe('200');
    expect(tokens['instagram.stories_vs']).toBe('vs 200 (+17%)');
    expect(tokens['instagram.storyInteractions_vs']).toBe('vs 20K (−6,5%)');
    expect(tokens['instagram.storyInteractions_tone']).toBe('bad');
    expect(Object.keys(networkTokens('facebook', full, 'T1 2026', full)).some((k) => k.includes('stor'))).toBe(false);
  });
  it('shows no change for stories unless both periods were fully tracked, and n.d. without any tracking', () => {
    const tracked: StoryTotals = { coverage: 'full', coveredDays: 91, days: 91, firstCoveredDay: '2026-04-01', headDays: 0, contiguous: true, tailDays: 0, tailOpen: false, incompleteDays: 0, failed: false, count: 10, views: 1000, viewsPerStory: 100, interactions: 50, withoutViews: 0, withoutInteractions: 0 };
    const partial: StoryTotals = { ...tracked, coverage: 'partial', coveredDays: 60, firstCoveredDay: '2026-05-02', headDays: 31 };
    const none: StoryTotals = { coverage: 'none', coveredDays: 0, days: 91, firstCoveredDay: null, headDays: 91, contiguous: true, tailDays: 0, tailOpen: false, incompleteDays: 0, failed: false, count: null, views: null, viewsPerStory: null, interactions: null, withoutViews: 0, withoutInteractions: 0 };
    expect(storyCardLines(tracked, partial)['stories']).toEqual({ vs: 'vs 10', tone: 'neutral' });
    expect(storyCardLines(tracked, none)['storyViews']).toEqual({ vs: 'vs —', tone: 'neutral' });
    const tokens = networkTokens('instagram', { ...full, stories: none }, 'T1 2026');
    expect(tokens['instagram.stories']).toBe(NOT_AVAILABLE);
    expect(partialNotes('instagram', { stories: none }).join(' ')).toContain('stories : non disponibles');
    expect(partialNotes('instagram', { stories: partial }).join(' ')).toContain('stories : partiel (relevé depuis le 2 mai)');
    expect(partialNotes('instagram', { stories: { ...partial, contiguous: false } }).join(' ')).toContain('stories : partiel (60 jours relevés sur 91)');
    expect(partialNotes('instagram', { stories: { ...none, failed: true } }).join(' ')).toContain('momentanément indisponibles');
    expect(partialNotes('instagram', { stories: tracked })).toEqual([]);
  });
});
