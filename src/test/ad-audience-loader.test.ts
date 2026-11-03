import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * loadSocialData against an in-memory fake of the Supabase client, with the sponsored audience turned on: the readings of the displayed and
 * the compared period are read by their exact dates, and only the ones that completed (a synced reading) come back with their values.
 */
type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>, selects: [] as [string, string][],
  failOn: null as null | ((table: string) => boolean), failCode: undefined as string | undefined,
}));

vi.mock('@supabase/supabase-js', () => {
  class Query {
    private rows: Row[]; private orderBy: string[] = []; private from = 0; private to = Infinity;
    constructor(private table: string) { this.rows = [...(state.tables[table] ?? [])]; }
    select(columns?: string) { state.selects.push([this.table, String(columns ?? '*')]); return this; }
    eq(col: string, v: unknown) { this.rows = this.rows.filter(r => r[col] === v); return this; }
    in(col: string, vs: unknown[]) { this.rows = this.rows.filter(r => vs.includes(r[col])); return this; }
    gte(col: string, v: string) { this.rows = this.rows.filter(r => String(r[col]) >= v); return this; }
    lte(col: string, v: string) { this.rows = this.rows.filter(r => String(r[col]) <= v); return this; }
    lt(col: string, v: string) { this.rows = this.rows.filter(r => String(r[col]) < v); return this; }
    not() { return this; }
    order(col: string) { this.orderBy.push(col); return this; }
    limit(n: number) { this.to = this.from + n - 1; return this; }
    range(a: number, b: number) { this.from = a; this.to = b; return this; }
    then(resolve: (v: { data: Row[] | null; error: unknown }) => unknown) {
      if (state.failOn?.(this.table)) return resolve({ data: null, error: { message: 'boom', ...(state.failCode ? { code: state.failCode } : {}) } });
      const sorted = [...this.rows].sort((x, y) => { for (const c of this.orderBy) { const d = String(x[c] ?? '').localeCompare(String(y[c] ?? '')); if (d) return d; } return 0; });
      return resolve({ data: sorted.slice(this.from, this.to + 1), error: null });
    }
  }
  const client = {
    from: (table: string) => new Query(table),
    storage: { from: () => ({ createSignedUrls: async (paths: string[]) => ({ data: paths.map(path => ({ path, signedUrl: `https://signed.test/${path}` })), error: null }) }) },
  };
  return { createClient: () => client };
});

// Neutral configuration with the sponsored audience on (the LinkedIn source is part of it).
vi.mock('@/client/config', async () => (await import('@/test/fixtures/neutral-client')).neutralClientModule({ features: { adAudience: true } }));

import { loadSocialData, resetSocialDataCache } from '@/lib/social-data.server';

const period = { start: '2026-07-01', end: '2026-09-30' };
const comparison = { start: '2024-07-01', end: '2024-09-30' };
const periodRow = (dimension: string, start: string, end: string, extra: Row = {}) => ({
  platform: 'linkedin', dimension, period_start: start, period_end: end, returned_count: 2, total_impressions: 1500, total_clicks: 30, is_final: false, synced_at: '2026-11-03T08:00:00Z', ...extra,
});
const valueRow = (dimension: string, start: string, end: string, label: string, impressions: number, clicks: number | null) => ({ platform: 'linkedin', dimension, period_start: start, period_end: end, label, impressions, clicks });

beforeEach(() => {
  process.env['SUPABASE_URL'] = 'https://fake.supabase.test';
  process.env['SUPABASE_PUBLISHABLE_KEY'] = 'sb_publishable_fake';
  process.env['SOCIAL_DATA_CACHE_MS'] = '0';
  resetSocialDataCache();
  state.failOn = null;
  state.failCode = undefined;
  state.selects = [];
  state.tables = {
    social_daily: [], social_follower_history: [], social_organic_history: [], social_ad_daily: [], social_ad_coverage: [],
    social_posts: [], social_post_ad_daily: [], social_ad_creative_daily: [], social_ad_creatives: [], social_audience: [], social_sync_status: [], social_ad_post_links: [],
    social_ad_audience: [], social_ad_audience_periods: [],
  };
});

describe('loadSocialData: sponsored audience', () => {
  it('returns the completed readings of the displayed and compared periods by their exact dates, with their values', async () => {
    state.tables['social_ad_audience_periods'] = [
      periodRow('function', '2026-07-01', '2026-09-30'),
      periodRow('function', '2024-07-01', '2024-09-30', { is_final: true }),
      // Another period (a quarter earlier) and the same quarter with different dates are not read.
      periodRow('function', '2026-04-01', '2026-06-30'),
      periodRow('function', '2026-07-01', '2026-09-29'),
    ];
    state.tables['social_ad_audience'] = [
      valueRow('function', '2026-07-01', '2026-09-30', 'Engineering', 1000, 20),
      valueRow('function', '2026-07-01', '2026-09-30', 'Marketing', 500, null),
      valueRow('function', '2024-07-01', '2024-09-30', 'Engineering', 700, 10),
      valueRow('function', '2026-04-01', '2026-06-30', 'Sales', 999, 9),
    ];
    const { adAudience } = await loadSocialData({ period, comparison });
    expect(adAudience.failed).toBe(false);
    expect(adAudience.periods.map(p => `${p.dimension}|${p.period_start}|${p.period_end}|${p.is_final}`).sort()).toEqual(['function|2024-07-01|2024-09-30|true', 'function|2026-07-01|2026-09-30|false']);
    expect(adAudience.periods[0]).toMatchObject({ platform: 'linkedin', returned_count: 2, total_impressions: 1500, total_clicks: 30 });
    expect(adAudience.rows.map(r => `${r.period_start}|${r.label}|${r.impressions}|${r.clicks}`).sort()).toEqual([
      '2024-07-01|Engineering|700|10', '2026-07-01|Engineering|1000|20', '2026-07-01|Marketing|500|null',
    ]);
  });

  it('keeps a reading that returned nothing (a real « no delivery »), and ignores a reading that never completed with the values written before it', async () => {
    state.tables['social_ad_audience_periods'] = [
      periodRow('industry', '2026-07-01', '2026-09-30', { returned_count: 0, total_impressions: 0, total_clicks: 0 }),
      // Attempted, never completed (synced_at empty): not a reading, and the values written before the reading row do not count.
      periodRow('region', '2026-07-01', '2026-09-30', { synced_at: null }),
    ];
    state.tables['social_ad_audience'] = [valueRow('region', '2026-07-01', '2026-09-30', 'Île-de-France', 800, 5)];
    const { adAudience } = await loadSocialData({ period, comparison });
    expect(adAudience.periods.map(p => p.dimension)).toEqual(['industry']);
    expect(adAudience.periods[0]?.returned_count).toBe(0);
    expect(adAudience.rows).toEqual([]);
  });

  it('ignores a dimension it does not know and never asks the browser-facing client for the server-only attempt date', async () => {
    state.tables['social_ad_audience_periods'] = [periodRow('shoe-size', '2026-07-01', '2026-09-30')];
    state.tables['social_ad_audience'] = [valueRow('shoe-size', '2026-07-01', '2026-09-30', '42', 10, 1)];
    const { adAudience } = await loadSocialData({ period, comparison });
    expect(adAudience).toEqual({ rows: [], periods: [], failed: false });
    const audienceReads = state.selects.filter(([table]) => table.startsWith('social_ad_audience'));
    expect(audienceReads.length).toBeGreaterThan(0);
    for (const [, columns] of audienceReads) expect(columns).not.toContain('last_attempt_at');
  });

  it('reads one period once when the comparison has the same dates', async () => {
    state.tables['social_ad_audience_periods'] = [periodRow('title', '2026-07-01', '2026-09-30')];
    state.tables['social_ad_audience'] = [valueRow('title', '2026-07-01', '2026-09-30', 'Engineer', 100, 1)];
    const { adAudience } = await loadSocialData({ period, comparison: period });
    expect(adAudience.periods).toHaveLength(1);
    expect(adAudience.rows).toHaveLength(1);
  });

  it('treats missing tables (migration not run) as no readings, without failing', async () => {
    state.failOn = table => table.startsWith('social_ad_audience');
    state.failCode = 'PGRST205';
    const result = await loadSocialData({ period, comparison });
    expect(result.adAudience).toEqual({ rows: [], periods: [], failed: false });
  });

  it('reports any other read error as failed, never as an absence, and does not keep that result in the cache', async () => {
    process.env['SOCIAL_DATA_CACHE_MS'] = '60000';
    state.tables['social_ad_audience_periods'] = [periodRow('function', '2026-07-01', '2026-09-30')];
    state.tables['social_ad_audience'] = [valueRow('function', '2026-07-01', '2026-09-30', 'Engineering', 1000, 20)];
    state.failOn = table => table === 'social_ad_audience';
    const failed = await loadSocialData({ period, comparison });
    expect(failed.adAudience).toEqual({ rows: [], periods: [], failed: true });
    state.failOn = null;
    const healthy = await loadSocialData({ period, comparison });
    expect(healthy.adAudience.failed).toBe(false);
    expect(healthy.adAudience.rows).toHaveLength(1);
    // A healthy result is cached: the next request does not read again.
    state.tables['social_ad_audience'] = [];
    expect((await loadSocialData({ period, comparison })).adAudience.rows).toHaveLength(1);
  });
});
