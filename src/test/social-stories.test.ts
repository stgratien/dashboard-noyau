import { describe, it, expect } from 'vitest';
import { mergeStories, storiesTotals, storyCoverageText, storyDay, storyDelta, storyInteractions, storyNote, STORY_MAX_GAP_MINUTES, type SocialStory, type StoryPull } from '../lib/social-stories';

const story = (id: string, published_at: string, extra: Partial<SocialStory> = {}): SocialStory => ({
  platform: 'instagram', story_id: id, published_at, views: 1000, reach: 800, replies: 5, shares: 3, interactions: 40, ...extra,
});
const pulls = (...days: string[]): StoryPull[] => days.map((day) => ({ platform: 'instagram', day, pulls: 2 }));
const week = { start: '2026-10-12', end: '2026-10-18' };
const allDays = pulls('2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19');

describe('stories Instagram', () => {
  it('uses the Paris day of a story, not the UTC day', () => {
    expect(storyDay('2026-10-12T22:30:00Z')).toBe('2026-10-13');
    expect(storyDay('2026-07-01T21:59:00Z')).toBe('2026-07-01');
    expect(storyDay('pas une date')).toBe('');
  });
  it('is unavailable (never zero) when no day of the period was tracked, even if a story is stored', () => {
    const t = storiesTotals([story('a', '2026-10-13T08:00:00Z')], pulls('2026-10-20'), week);
    expect(t).toMatchObject({ coverage: 'none', count: null, views: null, viewsPerStory: null, interactions: null });
  });
  it('covers a day only when the day and the next day were both pulled, so today is never covered', () => {
    const t = storiesTotals([], pulls('2026-10-17', '2026-10-18'), week);
    expect(t.coveredDays).toBe(1);
    expect(t.firstCoveredDay).toBe('2026-10-17');
    expect(t.coverage).toBe('partial');
  });
  it('adds up a fully tracked period, with the average per story', () => {
    const t = storiesTotals([story('a', '2026-10-13T08:00:00Z'), story('b', '2026-10-14T08:00:00Z', { views: 3000, interactions: 60 }), story('out', '2026-10-25T08:00:00Z')], allDays, week);
    expect(t).toMatchObject({ coverage: 'full', count: 2, views: 4000, viewsPerStory: 2000, interactions: 100, withoutViews: 0, withoutInteractions: 0 });
  });
  it('counts a story once even when it was read for both periods', () => {
    const s = story('a', '2026-10-13T08:00:00Z');
    expect(storiesTotals([s, { ...s }], allDays, week).count).toBe(1);
  });
  it('reports a real zero for a tracked period without story, and unavailable figures for stories without numbers', () => {
    expect(storiesTotals([], allDays, week)).toMatchObject({ coverage: 'full', count: 0, views: 0, viewsPerStory: null, interactions: 0 });
    const blank = storiesTotals([story('a', '2026-10-13T08:00:00Z', { views: null, interactions: null, replies: null, shares: null })], allDays, week);
    expect(blank).toMatchObject({ count: 1, views: null, viewsPerStory: null, interactions: null, withoutViews: 1, withoutInteractions: 1 });
  });
  it('ignores a story without figure in the total, marks the total partial and keeps the rest', () => {
    const t = storiesTotals([story('a', '2026-10-13T08:00:00Z'), story('b', '2026-10-14T08:00:00Z', { views: null })], allDays, week);
    expect(t).toMatchObject({ count: 2, views: 1000, viewsPerStory: 1000, withoutViews: 1 });
    expect(storyNote(t, 'views')).toBe('1 story sans chiffre');
  });
  it('gives no total built from fewer than half of the stories: unavailable rather than 1 story out of 4', () => {
    const t = storiesTotals([story('a', '2026-10-13T08:00:00Z'), story('b', '2026-10-13T09:00:00Z', { views: null, interactions: null, replies: null, shares: null }),
      story('c', '2026-10-14T08:00:00Z', { views: null, interactions: null, replies: null, shares: null }), story('d', '2026-10-15T08:00:00Z', { views: null, interactions: null, replies: null, shares: null })], allDays, week);
    expect(t).toMatchObject({ count: 4, views: null, viewsPerStory: null, interactions: null, withoutViews: 3, withoutInteractions: 3 });
    // La moitié exactement suffit.
    const half = storiesTotals([story('a', '2026-10-13T08:00:00Z'), story('b', '2026-10-13T09:00:00Z', { views: null })], allDays, week);
    expect(half).toMatchObject({ views: 1000, viewsPerStory: 1000, withoutViews: 1 });
  });
  it('takes replies + shares when Instagram gives no interaction total', () => {
    expect(storyInteractions({ interactions: null, replies: 4, shares: 2 })).toBe(6);
    expect(storyInteractions({ interactions: null, replies: 4, shares: null })).toBeNull();
    expect(storyInteractions({ interactions: 9, replies: 1, shares: 1 })).toBe(9);
  });
  it('shows a change only between two fully tracked periods', () => {
    const now = storiesTotals([story('a', '2026-10-13T08:00:00Z', { views: 3000 })], allDays, week);
    const before = storiesTotals([story('p', '2026-10-06T08:00:00Z', { views: 1000 })], pulls('2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12'), { start: '2026-10-05', end: '2026-10-11' });
    expect(storyDelta(now, before, 'views')).toBe(200);
    const partial = storiesTotals([story('p', '2026-10-06T08:00:00Z')], pulls('2026-10-10', '2026-10-11', '2026-10-12'), { start: '2026-10-05', end: '2026-10-11' });
    expect(partial.coverage).toBe('partial');
    expect(storyDelta(now, partial, 'views')).toBeUndefined();
    expect(storyDelta(now, storiesTotals([], [], { start: '2026-10-05', end: '2026-10-11' }), 'count')).toBeUndefined();
  });
  it('does not call a day covered when pulls were separated by a gap longer than the limit', () => {
    const steady = pulls('2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19');
    // Panne de 8 h qui se termine le 14 : les stories nées le 13 ou le 14 ont pu expirer sans être vues, les jours 13 et 14 ne sont pas couverts.
    const broken = steady.map((p) => (p.day === '2026-10-14' ? { ...p, maxGapMinutes: STORY_MAX_GAP_MINUTES + 120 } : { ...p, maxGapMinutes: 190 }));
    const t = storiesTotals([], broken, week);
    expect(t.coveredDays).toBe(5);
    expect(t.coverage).toBe('partial');
    expect(t.contiguous).toBe(false);
    expect(storyCoverageText(t)).toBe('5 jours relevés sur 7');
    expect(storiesTotals([], steady.map((p) => ({ ...p, maxGapMinutes: STORY_MAX_GAP_MINUTES })), week).coverage).toBe('full');
  });
  it('words the partial note from the shape of the coverage', () => {
    // Relevé depuis le 17 : un seul jour couvert, qui se suit jusqu'à hier.
    const viewedOn19 = { yesterday: '2026-10-18' };
    expect(storyCoverageText(storiesTotals([], pulls('2026-10-17', '2026-10-18'), week, viewedOn19))).toBe('relevé depuis le 17 oct.');
    // Seul le dernier jour manque (relevé du lendemain pas encore fait) : pas de « depuis ».
    expect(storyCoverageText(storiesTotals([], pulls('2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'), week, viewedOn19))).toBe('dernier jour en cours');
    // Même couverture, mais période close depuis longtemps : le dernier jour non couvert est un trou, pas un jour en cours.
    expect(storyCoverageText(storiesTotals([], pulls('2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'), week, { yesterday: '2026-12-30' }))).toBe('6 jours relevés sur 7');
    // Trou au milieu : le nombre de jours relevés.
    expect(storyCoverageText(storiesTotals([], pulls('2026-10-12', '2026-10-13', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19'), week))).toBe('4 jours relevés sur 7');
    expect(storyCoverageText(storiesTotals([], allDays, week))).toBeUndefined();
  });
  it('says the stories are momentarily unavailable when the read failed, never that tracking is off', () => {
    const t = storiesTotals([story('a', '2026-10-13T08:00:00Z')], allDays, week, { failed: true });
    expect(t).toMatchObject({ failed: true, coverage: 'none', count: null, views: null });
    expect(storyNote(t, 'count', true)).toBe('Stories momentanément indisponibles');
    expect(storyNote(t, 'views')).toBeUndefined();
    expect(storyDelta(storiesTotals([story('a', '2026-10-13T08:00:00Z')], allDays, week), t, 'views')).toBeUndefined();
  });
  it('explains the tracking start on the first card only', () => {
    const t = storiesTotals([], pulls('2026-10-17', '2026-10-18'), week, { yesterday: '2026-10-18' });
    expect(storyNote(t, 'count', true)).toBe('partiel : relevé depuis le 17 oct.');
    expect(storyNote(t, 'views')).toBe('partiel');
    const none = storiesTotals([], [], week);
    expect(storyNote(none, 'count', true)).toBe('Suivi des stories non actif sur cette période');
    expect(storyNote(none, 'views')).toBeUndefined();
  });
});

describe('historique importé des exports Meta (fenêtres de couverture)', () => {
  const windowOf = (day: string, through: string, level: 'complete' | 'partial' = 'complete'): StoryPull => ({ platform: 'instagram', day, through, pulls: 1, level });
  const june = { start: '2025-06-01', end: '2025-06-30' };
  const viewedLater = { yesterday: '2026-10-19' };
  it('covers every day of a complete window: real counts, real zero, and a change between two such periods', () => {
    const wins = [windowOf('2024-10-21', '2026-10-19')];
    const may = { start: '2025-05-01', end: '2025-05-31' };
    const t = storiesTotals([story('a', '2025-06-12T09:00:00Z', { views: 9000, interactions: 70 }), story('b', '2025-06-20T09:00:00Z', { views: 3000, interactions: 30 })], wins, june, viewedLater);
    expect(t).toMatchObject({ coverage: 'full', coveredDays: 30, count: 2, views: 12000, viewsPerStory: 6000, interactions: 100, incompleteDays: 0 });
    expect(storiesTotals([], wins, may, viewedLater)).toMatchObject({ coverage: 'full', count: 0, views: 0, interactions: 0 });
    expect(storyDelta(t, storiesTotals([story('p', '2025-05-10T09:00:00Z', { views: 3000 })], wins, may, viewedLater), 'views')).toBe(300);
  });
  it('keeps a partial window partial: known stories counted, never a zero, no change', () => {
    const wins = [windowOf('2023-10-21', '2024-10-20', 'partial')];
    const march = { start: '2024-03-01', end: '2024-03-31' };
    const t = storiesTotals([story('a', '2024-03-27T15:19:00Z', { views: null, interactions: 29 })], wins, march, viewedLater);
    expect(t).toMatchObject({ coverage: 'partial', coveredDays: 0, incompleteDays: 31, firstCoveredDay: null, count: 1, views: null, interactions: 29, withoutViews: 1 });
    expect(storyCoverageText(t)).toBe('historique incomplet');
    expect(storyNote(t, 'count', true)).toBe('partiel : historique incomplet');
    expect(storyDelta(t, t, 'count')).toBeUndefined();
    // Aucune story connue dans la fenêtre partielle : non disponible, pas « 0 story ».
    expect(storiesTotals([], wins, { start: '2024-01-01', end: '2024-01-31' }, viewedLater)).toMatchObject({ coverage: 'none', count: null, views: null });
  });
  it('is unavailable before the first import and partial across a window edge', () => {
    const wins = [windowOf('2023-10-21', '2024-10-20', 'partial'), windowOf('2024-10-21', '2026-10-19')];
    expect(storiesTotals([story('x', '2023-07-10T09:00:00Z')], wins, { start: '2023-07-03', end: '2023-07-16' }, viewedLater)).toMatchObject({ coverage: 'none', count: null });
    const year = storiesTotals([story('a', '2024-03-27T15:19:00Z'), story('b', '2025-06-12T09:00:00Z', { views: 500 })], wins, { start: '2024-01-01', end: '2024-12-31' }, viewedLater);
    expect(year).toMatchObject({ coverage: 'partial', coveredDays: 72, incompleteDays: 294, firstCoveredDay: '2024-10-21', contiguous: true, tailDays: 0, count: 1 });
    expect(storyCoverageText(year)).toBe('relevé depuis le 21 oct.');
  });
  it('lets live pulls continue the import without a hole, and stays partial where neither covers', () => {
    const wins = [windowOf('2024-10-21', '2026-10-20')];
    const live = [21, 22, 23].map((d) => ({ platform: 'instagram', day: `2026-10-${d}`, pulls: 3, maxGapMinutes: 190 }));
    const t = storiesTotals([], [...wins, ...live], { start: '2026-10-19', end: '2026-10-22' }, { yesterday: '2026-10-23' });
    expect(t).toMatchObject({ coverage: 'full', coveredDays: 4 });
    expect(storiesTotals([], wins, { start: '2026-10-19', end: '2026-10-22' }, { yesterday: '2026-10-23' })).toMatchObject({ coverage: 'partial', coveredDays: 2, tailDays: 2, contiguous: true });
    // Un trou de relevés après l'import (pas de relevé le 22) laisse les jours concernés non couverts.
    const gap = storiesTotals([], [...wins, ...live.filter((p) => p.day !== '2026-10-22')], { start: '2026-10-19', end: '2026-10-22' }, { yesterday: '2026-10-23' });
    expect(gap).toMatchObject({ coverage: 'partial', coveredDays: 2 });
  });
  it('merges the live pull and the import by story id, keeping the highest known figure and filling gaps', () => {
    const imported = story('same', '2026-10-19T09:00:00Z', { views: 900, reach: 700, replies: null, shares: 1, interactions: 20 });
    const live = story('same', '2026-10-19T09:00:00Z', { views: 1000, reach: null, replies: 2, shares: 0, interactions: null });
    const [merged, ...rest] = mergeStories([live], [imported, story('other', '2026-10-18T09:00:00Z')]);
    expect(rest).toHaveLength(1);
    expect(merged).toMatchObject({ story_id: 'same', views: 1000, reach: 700, replies: 2, shares: 1, interactions: 20 });
    expect(mergeStories([imported], [])[0]).toEqual(imported);
  });
});
