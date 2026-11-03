import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * loadSocialData against an in-memory fake of the Supabase client, with the company sizes turned on: the readings of the displayed and
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

// Neutral configuration with the company sizes on.
vi.mock('@/client/config', async () => (await import('@/test/fixtures/neutral-client')).neutralClientModule({ features: { pageAudience: true } }));

import { loadSocialData, resetSocialDataCache } from '@/lib/social-data.server';

const period = { start: '2026-07-01', end: '2026-09-30' };
const comparison = { start: '2024-07-01', end: '2024-09-30' };
const periodRow = (start: string, end: string, extra: Row = {}) => ({
  platform: 'linkedin', dimension: 'companySize', period_start: start, period_end: end, returned_count: 2, total_views: 1500, is_final: false, synced_at: '2026-11-03T08:00:00Z', ...extra,
});
const valueRow = (start: string, end: string, label: string, views: number) => ({ platform: 'linkedin', dimension: 'companySize', period_start: start, period_end: end, label, views });

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
    social_page_audience: [], social_page_audience_periods: [],
  };
});

describe('loadSocialData: page visitors', () => {
  it('returns the completed readings of the displayed and compared periods by their exact dates, with their values', async () => {
    state.tables['social_page_audience_periods'] = [
      periodRow('2026-07-01', '2026-09-30'),
      periodRow('2024-07-01', '2024-09-30', { is_final: true }),
      // Another period (a quarter earlier) and the same quarter with different dates are not read.
      periodRow('2026-04-01', '2026-06-30'),
      periodRow('2026-07-01', '2026-09-29'),
    ];
    state.tables['social_page_audience'] = [
      valueRow('2026-07-01', '2026-09-30', 'SIZE_11_TO_50', 1000),
      valueRow('2026-07-01', '2026-09-30', 'SIZE_51_TO_200', 500),
      valueRow('2024-07-01', '2024-09-30', 'SIZE_11_TO_50', 700),
      valueRow('2026-04-01', '2026-06-30', 'SIZE_1', 999),
    ];
    const { pageAudience } = await loadSocialData({ period, comparison });
    expect(pageAudience.failed).toBe(false);
    expect(pageAudience.periods.map(p => `${p.dimension}|${p.period_start}|${p.period_end}|${p.is_final}`).sort()).toEqual(['companySize|2024-07-01|2024-09-30|true', 'companySize|2026-07-01|2026-09-30|false']);
    expect(pageAudience.periods[0]).toMatchObject({ platform: 'linkedin', returned_count: 2, total_views: 1500 });
    expect(pageAudience.rows.map(r => `${r.period_start}|${r.label}|${r.views}`).sort()).toEqual([
      '2024-07-01|SIZE_11_TO_50|700', '2026-07-01|SIZE_11_TO_50|1000', '2026-07-01|SIZE_51_TO_200|500',
    ]);
  });

  it('keeps a reading that returned nothing, and ignores a reading that never completed with the values written before it', async () => {
    state.tables['social_page_audience_periods'] = [
      periodRow('2026-07-01', '2026-09-30', { returned_count: 0, total_views: 0 }),
      // Attempted, never completed (synced_at empty): not a reading, and the values written before the reading row do not count.
      periodRow('2024-07-01', '2024-09-30', { synced_at: null }),
    ];
    state.tables['social_page_audience'] = [valueRow('2024-07-01', '2024-09-30', 'SIZE_1', 800)];
    const { pageAudience } = await loadSocialData({ period, comparison });
    expect(pageAudience.periods.map(p => p.period_start)).toEqual(['2026-07-01']);
    expect(pageAudience.periods[0]?.returned_count).toBe(0);
    expect(pageAudience.rows).toEqual([]);
  });

  it('keeps the two dimensions apart: a completed period row of one does not unlock the values of the other', async () => {
    state.tables['social_page_audience_periods'] = [periodRow('2026-07-01', '2026-09-30')];
    state.tables['social_page_audience'] = [
      valueRow('2026-07-01', '2026-09-30', 'SIZE_11_TO_50', 1000),
      { ...valueRow('2026-07-01', '2026-09-30', 'SIZE_1', 50), dimension: 'followersCompanySize' },
    ];
    const first = await loadSocialData({ period, comparison });
    expect(first.pageAudience.rows.map(r => `${r.dimension}|${r.label}`)).toEqual(['companySize|SIZE_11_TO_50']);
    // Once the followers' own period row exists, their values come back, next to the visitors'.
    state.tables['social_page_audience_periods'] = [periodRow('2026-07-01', '2026-09-30'), periodRow('2026-07-01', '2026-09-30', { dimension: 'followersCompanySize' })];
    resetSocialDataCache();
    const both = await loadSocialData({ period, comparison });
    expect(both.pageAudience.periods.map(p => p.dimension).sort()).toEqual(['companySize', 'followersCompanySize']);
    expect(both.pageAudience.rows.map(r => `${r.dimension}|${r.label}`).sort()).toEqual(['companySize|SIZE_11_TO_50', 'followersCompanySize|SIZE_1']);
  });

  it('ignores a dimension it does not know and never asks the browser-facing client for the server-only attempt date', async () => {
    state.tables['social_page_audience_periods'] = [periodRow('2026-07-01', '2026-09-30', { dimension: 'shoe-size' })];
    state.tables['social_page_audience'] = [{ ...valueRow('2026-07-01', '2026-09-30', '42', 10), dimension: 'shoe-size' }];
    const { pageAudience } = await loadSocialData({ period, comparison });
    expect(pageAudience).toEqual({ rows: [], periods: [], failed: false });
    const reads = state.selects.filter(([table]) => table.startsWith('social_page_audience'));
    expect(reads.length).toBeGreaterThan(0);
    for (const [, columns] of reads) expect(columns).not.toContain('last_attempt_at');
  });

  it('reads one period once when the comparison has the same dates', async () => {
    state.tables['social_page_audience_periods'] = [periodRow('2026-07-01', '2026-09-30')];
    state.tables['social_page_audience'] = [valueRow('2026-07-01', '2026-09-30', 'SIZE_1', 100)];
    const { pageAudience } = await loadSocialData({ period, comparison: period });
    expect(pageAudience.periods).toHaveLength(1);
    expect(pageAudience.rows).toHaveLength(1);
  });

  it('treats missing tables (migration not run) as no readings, without failing', async () => {
    state.failOn = table => table.startsWith('social_page_audience');
    state.failCode = 'PGRST205';
    const result = await loadSocialData({ period, comparison });
    expect(result.pageAudience).toEqual({ rows: [], periods: [], failed: false });
  });

  it('reports any other read error as failed, never as an absence, and does not keep that result in the cache', async () => {
    process.env['SOCIAL_DATA_CACHE_MS'] = '60000';
    state.tables['social_page_audience_periods'] = [periodRow('2026-07-01', '2026-09-30')];
    state.tables['social_page_audience'] = [valueRow('2026-07-01', '2026-09-30', 'SIZE_11_TO_50', 1000)];
    state.failOn = table => table === 'social_page_audience';
    const failed = await loadSocialData({ period, comparison });
    expect(failed.pageAudience).toEqual({ rows: [], periods: [], failed: true });
    state.failOn = null;
    const healthy = await loadSocialData({ period, comparison });
    expect(healthy.pageAudience.failed).toBe(false);
    expect(healthy.pageAudience.rows).toHaveLength(1);
    // A healthy result is cached: the next request does not read again.
    state.tables['social_page_audience'] = [];
    expect((await loadSocialData({ period, comparison })).pageAudience.rows).toHaveLength(1);
  });

  it('does not read the sponsored audience tables, which this client left off', async () => {
    state.failOn = table => table.startsWith('social_ad_audience');
    const result = await loadSocialData({ period, comparison });
    expect(result.adAudience).toEqual({ rows: [], periods: [], failed: false });
    expect(result.pageAudience.failed).toBe(false);
  });
});
