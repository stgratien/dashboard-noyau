import { describe, expect, it, vi } from 'vitest';
import { comparisonGapNote, organicHistoryStart } from '../lib/comparison-note';
import { mergeOrganicHistory, type ManualOrganicDay } from '../lib/social-organic-history';
import { realBlendedTotals, type SocialDay } from '../lib/social-totals';
import { dayNumber, isoFromDay } from '../lib/dashboard-periods';

// Configuration neutre : les réseaux et les sources ne viennent pas du client de ce dépôt.
vi.mock('@/client/config', async () => (await import('@/test/fixtures/neutral-client')).neutralClientModule());

const range = (start: string, count: number) => Array.from({ length: count }, (_, i) => isoFromDay(dayNumber(start) + i));
const igDay = (day: string, metrics: SocialDay['metrics']): SocialDay => ({ platform: 'instagram', source: 'instagram', day, followers_estimated: false, metrics });
const adDay = (day: string): SocialDay => ({ platform: 'instagram', source: 'facebook', day, followers_estimated: false, metrics: { spend: 10, impressions: 500, linkClicks: 3 } });
const manualDay = (day: string): ManualOrganicDay => ({ platform: 'instagram', day, organic_views: 800, paid_views: 100, organic_likes: 20, organic_comments: 2, organic_shares: 1, posts_published: 1 });

// Fournisseur : des zéros du 10/10/2024 au 31/12/2024 (série écartée), puis des chiffres ; l'export de l'agence commence le 01/01/2025 et s'arrête le 31/03/2025.
const providerZeros = range('2024-10-10', 83).map((d) => igDay(d, { impressions: 0, likes: 0 }));
const providerData = range('2025-04-01', 60).map((d) => igDay(d, { impressions: 900, likes: 10, comments: 1, shares: 1, postsAvailable: 1 }));
const days = mergeOrganicHistory([...providerZeros, ...providerData], range('2025-01-01', 90).map(manualDay));
const paid = [...range('2024-07-01', 92), ...range('2025-01-01', 200)].map(adDay);
const all = [...days, ...paid];
const totals = (period: { start: string; end: string }, source: SocialDay[] = all) => realBlendedTotals('instagram', source, [], period, []);

describe('organicHistoryStart', () => {
  it('skips the provider zero run and starts at the first usable day (here the manual history)', () => {
    expect(organicHistoryStart(days, 'instagram')).toBe('2025-01-01');
  });
  it('counts a provider day with real figures, and ignores a lone zero day', () => {
    const provider = [igDay('2025-02-01', { impressions: 0 }), igDay('2025-02-02', { impressions: 40 })];
    expect(organicHistoryStart(provider, 'instagram')).toBe('2025-02-02');
  });
  it('is null without any organic day, for another network or for TikTok', () => {
    expect(organicHistoryStart(paid, 'instagram')).toBeNull();
    expect(organicHistoryStart(days, 'linkedin')).toBeNull();
    expect(organicHistoryStart([{ platform: 'tiktok', source: 'tiktok_organic', day: '2025-02-02', followers_estimated: false, metrics: { impressions: 40 } }], 'tiktok')).toBeNull();
  });
});

describe('comparisonGapNote', () => {
  const current = { start: '2025-04-01', end: '2025-05-15' };
  const before = (date: string) => `Instagram : les chiffres organiques du compte (impressions, interactions…) ne remontent pas avant le ${date}, leur comparaison reste donc vide.`;
  it('names the date the organic figures start when the compared period begins before it', () => {
    const compared = { start: '2024-07-01', end: '2024-09-30' };
    expect(comparisonGapNote('instagram', all, totals(current), totals(compared), compared)).toBe(before('01/01/2025'));
  });
  it('also explains a compared period that only straddles the start', () => {
    const compared = { start: '2024-12-01', end: '2025-01-31' };
    expect(comparisonGapNote('instagram', all, totals(current), totals(compared), compared)).toBe(before('01/01/2025'));
  });
  it('does not depend on the budget of the compared period', () => {
    const compared = { start: '2024-02-01', end: '2024-02-29' };
    expect(totals(compared).spend).toBeNull();
    expect(comparisonGapNote('instagram', all, totals(current), totals(compared), compared)).toBe(before('01/01/2025'));
  });
  it('falls back to a generic sentence when the gap is not before the start of the history', () => {
    const gap = [...range('2025-01-01', 90).map((d) => adDay(d)), ...days.filter((d) => d.day < '2025-02-01' || d.day > '2025-02-28')];
    const compared = { start: '2025-02-01', end: '2025-02-28' };
    expect(comparisonGapNote('instagram', gap, totals(current, gap), totals(compared, gap), compared)).toBe(
      'Instagram : les chiffres organiques du compte (impressions, interactions…) sont incomplets sur la période comparée, leur comparaison reste donc vide.',
    );
  });
  it('stays silent when both periods have their organic figures', () => {
    const compared = { start: '2025-01-05', end: '2025-02-20' };
    expect(comparisonGapNote('instagram', all, totals(current), totals(compared), compared)).toBeNull();
  });
  it('stays silent when the displayed period has no organic figures either (the cards already say so)', () => {
    const early = { start: '2024-07-01', end: '2024-09-30' };
    const earlier = { start: '2024-04-01', end: '2024-06-30' };
    expect(comparisonGapNote('instagram', all, totals(early), totals(earlier), earlier)).toBeNull();
  });
  it('covers the other networks with their own organic source, and says "des publications" for TikTok', () => {
    const net = (platform: string, source: string, paidSource: string): SocialDay[] => [
      ...range('2025-03-01', 60).map((day) => ({ platform, source, day, followers_estimated: false, metrics: { impressions: 800, likes: 5, postsAvailable: 1 } })),
      ...range('2024-01-01', 500).map((day) => ({ platform, source: paidSource, day, followers_estimated: false, metrics: { spend: 5, impressions: 300 } })),
    ];
    const current = { start: '2025-03-10', end: '2025-04-10' };
    const compared = { start: '2024-03-10', end: '2024-04-10' };
    const note = (platform: 'facebook' | 'linkedin' | 'tiktok', source: string, paidSource: string) => {
      const list = net(platform, source, paidSource);
      return comparisonGapNote(platform, list, realBlendedTotals(platform, list, [], current, []), realBlendedTotals(platform, list, [], compared, []), compared);
    };
    expect(note('facebook', 'facebook_organic', 'facebook')).toBe('Facebook : les chiffres organiques du compte (impressions, interactions…) ne remontent pas avant le 01/03/2025, leur comparaison reste donc vide.');
    expect(note('linkedin', 'linkedin_organic', 'linkedin')).toContain('LinkedIn : les chiffres organiques du compte');
    // TikTok : pas de date (l'organique vient des vidéos), la phrase parle des publications.
    expect(note('tiktok', 'tiktok_organic', 'tiktok')).toBe('TikTok : les chiffres organiques des publications (impressions, interactions…) sont incomplets sur la période comparée, leur comparaison reste donc vide.');
  });
  it('gives the start date when the whole compared period lies before the history', () => {
    const compared = { start: '2023-01-01', end: '2023-03-31' };
    expect(comparisonGapNote('instagram', all, totals(current), totals(compared), compared)).toBe(before('01/01/2025'));
  });
});
