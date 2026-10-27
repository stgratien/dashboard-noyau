import { describe, it, expect } from 'vitest';
import { audienceDates, audienceDefaultView, audienceSeries, audienceViews } from '../lib/social-followers';
import { dayNumber, isoFromDay } from '../lib/dashboard-periods';
import type { SocialDay } from '../lib/social-totals';

const day = (d: string, followers: number, estimated = false, platform = 'instagram', source = 'instagram'): SocialDay => ({ platform, source, day: d, followers_estimated: estimated, metrics: { followers } });
const today = '2026-10-20';

/** Période de `days` jours qui se termine la veille d'aujourd'hui. */
const span = (days: number) => ({ start: isoFromDay(dayNumber('2026-10-19') - days + 1), end: '2026-10-19' });

describe('audience evolution follows the selector dates', () => {
  it('offers Semaine from 14 days, Mois from 60 days and Année from 730 days', () => {
    expect(audienceViews(span(7), today)).toEqual([]);
    expect(audienceViews(span(13), today)).toEqual([]);
    expect(audienceViews(span(14), today)).toEqual(['week']);
    expect(audienceViews(span(21), today)).toEqual(['week']);
    expect(audienceViews(span(59), today)).toEqual(['week']);
    expect(audienceViews(span(60), today)).toEqual(['week', 'month']);
    expect(audienceViews(span(90), today)).toEqual(['week', 'month']);
    expect(audienceViews(span(365), today)).toEqual(['week', 'month']);
    expect(audienceViews(span(729), today)).toEqual(['week', 'month']);
    expect(audienceViews(span(730), today)).toEqual(['week', 'month', 'year']);
  });
  it('counts a period that ends in the future up to today only, and offers nothing for one that has not started', () => {
    expect(audienceViews({ start: '2026-10-01', end: '2026-12-31' }, today)).toEqual(['week']);
    expect(audienceViews({ start: '2027-09-13', end: '2027-09-19' }, today)).toEqual([]);
  });
  it('starts on the finest view that stays under 30 points, one point per day under 14 days', () => {
    expect(audienceDefaultView(span(7), today)).toBe('day');
    expect(audienceDefaultView(span(21), today)).toBe('week');
    expect(audienceDefaultView(span(90), today)).toBe('week');
    expect(audienceDefaultView(span(365), today)).toBe('month');
    expect(audienceDefaultView(span(730), today)).toBe('month');
    expect(audienceDefaultView(span(1100), today)).toBe('year');
  });
  it('gives one point per day on a short period, from the first to the last day', () => {
    const dates = audienceDates({ start: '2026-10-14', end: '2026-10-20' }, today);
    expect(dates).toEqual(['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20']);
  });
  it('gives one point per week from the start and always ends on the period end', () => {
    const dates = audienceDates({ start: '2026-07-01', end: '2026-09-30' }, today, 'week');
    expect(dates[0]).toBe('2026-07-01');
    expect(dates[1]).toBe('2026-07-08');
    expect(dates.at(-1)).toBe('2026-09-30');
    expect(dates).toHaveLength(14);
    expect(audienceDates({ start: '2026-10-01', end: '2026-10-21' }, today, 'week')).toEqual(['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-20']);
  });
  it('gives each month end and the end in the Mois view, the start only when it is not in the first month-end month', () => {
    const dates = audienceDates({ start: '2026-01-01', end: '2026-10-19' }, today, 'month');
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30', '2026-07-31', '2026-08-31', '2026-09-30', '2026-10-19']);
    expect(audienceDates({ start: '2025-01-01', end: '2025-12-31' }, today, 'month')).toHaveLength(12);
    expect(audienceDates({ start: '2026-03-19', end: '2026-10-19' }, today, 'month')[0]).toBe('2026-03-31');
  });
  it('gives the start, each year end and the end in the Année view', () => {
    expect(audienceDates({ start: '2023-09-11', end: '2026-10-19' }, today, 'year')).toEqual(['2023-09-11', '2023-12-31', '2024-12-31', '2025-12-31', '2026-10-19']);
    expect(audienceDates({ start: '2024-01-01', end: '2025-12-31' }, today, 'year')).toEqual(['2024-01-01', '2024-12-31', '2025-12-31']);
  });
  it('never goes past today, and is empty for a period that has not started', () => {
    expect(audienceDates({ start: '2026-10-10', end: '2026-10-31' }, today).at(-1)).toBe('2026-10-20');
    expect(audienceDates({ start: '2027-09-13', end: '2027-09-19' }, today)).toEqual([]);
  });
  it('takes the last known value at or before each point, without inventing zeros before the first snapshot', () => {
    const days = [day('2026-10-16', 100), day('2026-10-18', 110)];
    const points = audienceSeries(days, 'instagram', { start: '2026-10-14', end: '2026-10-20' }, today);
    expect(points.map(x => x.followers)).toEqual([null, null, 100, 100, 110, 110, 110]);
    expect(points.at(-1)?.date).toBe('2026-10-20');
  });
  it('uses the network own source and flags estimated values', () => {
    const days = [day('2026-10-17', 500, false, 'linkedin', 'linkedin_organic'), day('2026-10-18', 520, true, 'linkedin', 'linkedin_organic'), day('2026-10-17', 9999, false, 'instagram', 'instagram'), day('2026-10-19', 7, false, 'linkedin', 'linkedin_paid')];
    const points = audienceSeries(days, 'linkedin', { start: '2026-10-17', end: '2026-10-19' }, today);
    expect(points.map(x => x.followers)).toEqual([500, 520, 520]);
    expect(points.map(x => x.estimated)).toEqual([false, true, true]);
  });
  it('labels the points with their dates, with the year when the period spans two years or is long', () => {
    const short = audienceSeries([day('2026-10-01', 1)], 'instagram', { start: '2026-10-14', end: '2026-10-16' }, today);
    expect(short[0]?.label).toMatch(/^14 oct/);
    expect(short[0]?.full).toBe('14/10/2026');
    expect(short[0]?.label).not.toMatch(/26/);
    // Vue Mois : « mai 25 », sans jour, mais l'infobulle garde la vraie date du relevé.
    const long = audienceSeries([day('2025-01-01', 1)], 'instagram', { start: '2025-01-01', end: '2025-12-31' }, today, 'month');
    expect(long[0]?.label).toMatch(/^janv\.? 25$/);
    expect(long[4]?.label).toMatch(/^mai 25$/);
    expect(long[4]?.full).toBe('31/05/2025');
    expect(new Set(long.map(x => x.label)).size).toBe(long.length);
    // Vue Année : la date complète garde son jour.
    expect(audienceSeries([day('2023-06-05', 1)], 'instagram', { start: '2023-06-05', end: '2026-10-19' }, today, 'year')[1]?.label).toMatch(/31 déc\.? 23/);
    const across = audienceSeries([day('2025-12-01', 1)], 'instagram', { start: '2025-12-28', end: '2026-01-03' }, today);
    expect(across[0]?.label).toMatch(/25$/);
  });
});
