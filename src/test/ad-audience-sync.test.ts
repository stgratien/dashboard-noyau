import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The sponsored-audience reading of windsor-sync.server.ts, run against an in-memory fake of the admin Supabase client (with the log of every write,
 * in order) and a fake Windsor endpoint: the period row is written last, a reading that did not complete never looks read, an empty answer only counts
 * when the stored paid delivery proves it, and the queue tick makes one Windsor call.
 */
type Row = Record<string, unknown>;
type Op = { table: string; op: 'upsert' | 'delete'; payload?: Row | Row[]; filters?: Row };
const h = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  log: [] as Op[],
  fail: null as null | ((table: string, op: string) => boolean),
  claim: [] as Row[],
  windsor: { status: 200, rows: [] as Row[] },
  fetches: [] as URL[],
}));

vi.mock('@/integrations/supabase/client.server', () => {
  const KEYS: Record<string, string[]> = {
    social_ad_audience: ['platform', 'dimension', 'period_start', 'period_end', 'label'],
    social_ad_audience_periods: ['platform', 'dimension', 'period_start', 'period_end'],
  };
  class Query {
    private mode: 'select' | 'upsert' | 'delete' = 'select';
    private payload: Row | Row[] | undefined;
    private conflict: string[] = [];
    private filters: Row = {};
    private ranges: { col: string; gte?: string; lte?: string }[] = [];
    private max = Infinity;
    constructor(private table: string) {}
    select() { return this; }
    upsert(payload: Row | Row[], options?: { onConflict?: string }) { this.mode = 'upsert'; this.payload = payload; this.conflict = (options?.onConflict ?? '').split(','); return this; }
    delete() { this.mode = 'delete'; return this; }
    eq(col: string, value: unknown) { this.filters[col] = value; return this; }
    match(values: Row) { Object.assign(this.filters, values); return this; }
    gte(col: string, value: string) { this.ranges.push({ col, gte: value }); return this; }
    lte(col: string, value: string) { this.ranges.push({ col, lte: value }); return this; }
    not() { return this; }
    order() { return this; }
    limit(n: number) { this.max = n; return this; }
    maybeSingle() { return Promise.resolve({ data: null, error: null }); }
    private matching() {
      return (h.tables[this.table] ??= []).filter((r) =>
        Object.entries(this.filters).every(([c, v]) => r[c] === v) &&
        this.ranges.every(({ col, gte, lte }) => (gte === undefined || String(r[col]) >= gte) && (lte === undefined || String(r[col]) <= lte)));
    }
    then(resolve: (v: { data: Row[] | null; error: unknown }) => unknown) {
      const op = this.mode;
      if (h.fail?.(this.table, op)) return resolve({ data: null, error: { message: 'boom' } });
      if (op === 'select') return resolve({ data: this.matching().slice(0, this.max).map((r) => ({ ...r })), error: null });
      if (op === 'delete') {
        h.log.push({ table: this.table, op, filters: { ...this.filters } });
        const gone = new Set(this.matching());
        h.tables[this.table] = (h.tables[this.table] ?? []).filter((r) => !gone.has(r));
        return resolve({ data: null, error: null });
      }
      const list = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
      h.log.push({ table: this.table, op, payload: JSON.parse(JSON.stringify(this.payload)) });
      const rows = (h.tables[this.table] ??= []);
      for (const item of list) {
        const keys = KEYS[this.table] ?? this.conflict;
        const existing = rows.find((r) => keys.every((k) => r[k] === item[k]));
        // PostgREST merges only the columns the payload carries.
        if (existing) Object.assign(existing, item);
        else rows.push({ ...(this.table === 'social_ad_audience_periods' ? { is_final: false } : {}), ...item });
      }
      return resolve({ data: null, error: null });
    }
  }
  return { supabaseAdmin: { from: (table: string) => new Query(table), rpc: async () => ({ data: h.claim, error: null }) } };
});
vi.mock('@/lib/windsor-accounts.server', () => ({ sourceAccount: () => 'acct-1', activeSources: () => ['linkedin_organic', 'linkedin'] }));
// Neutral configuration, LinkedIn only (so the stories, which are Instagram's, are never due), sponsored audience on.
vi.mock('@/client/config', async () =>
  (await import('@/test/fixtures/neutral-client')).neutralClientModule({ sources: ['linkedin_organic', 'linkedin'], features: { adAudience: true } }));

import { processImport, syncAdAudience, syncAdAudienceWhenDue } from '@/lib/windsor-sync.server';
import { adAudiencePeriods, dayNumber, isoFromDay } from '@/lib/dashboard-periods';
import { AD_AUDIENCE_DIMENSIONS } from '@/lib/ad-audience';

const T3 = { start: '2026-07-01', end: '2026-09-30' };
const request = { dimension: 'function' as const, ...T3 };
const periodsTable = () => h.tables['social_ad_audience_periods'] ?? [];
const valuesTable = () => h.tables['social_ad_audience'] ?? [];
const periodRows = (dimension: string) => periodsTable().filter((r) => r['dimension'] === dimension);
const dailyRows = (start: string, end: string, impressions: (day: string) => number) =>
  Array.from({ length: dayNumber(end) - dayNumber(start) + 1 }, (_, i) => isoFromDay(dayNumber(start) + i)).map((day) => ({ platform: 'linkedin', source: 'linkedin', day, metrics: { impressions: impressions(day) } }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T10:00:00Z'));
  h.tables = { social_ad_audience: [], social_ad_audience_periods: [], social_daily: [], social_sync_status: [] };
  h.log = [];
  h.fail = null;
  h.claim = [];
  const profile = (label: string, impressions: number, clicks: number) => ({
    member_job_function: label, member_job_title: label, member_industry: label, member_company_name: label, member_seniority: label, member_region: label, impressions, clicks,
  });
  h.windsor = { status: 200, rows: [profile('Engineering', 1000, 20), profile('Marketing', 500, 5)] };
  h.fetches = [];
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
    h.fetches.push(new URL(url));
    return { ok: h.windsor.status < 400, status: h.windsor.status, json: async () => ({ data: h.windsor.rows }) };
  }));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('syncAdAudience', () => {
  it('asks Windsor for the exact period and the profile field, then writes the values and the period row LAST', async () => {
    vi.setSystemTime(new Date('2026-10-05T10:00:00Z'));
    const out = await syncAdAudience('k', request);
    expect(out).toMatchObject({ success: true, values: 2, returned: 2 });
    expect(h.fetches).toHaveLength(1);
    const url = h.fetches[0]!;
    expect(url.pathname).toBe('/linkedin');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ date_from: '2026-07-01', date_to: '2026-09-30', fields: 'member_job_function,impressions,clicks', select_accounts: 'acct-1' });
    // Order of the writes: the attempt (no synced_at, so a previous reading is untouched), the reopening, the values, the period row with synced_at.
    const writes = h.log.map((o) => `${o.table}:${o.op}`);
    expect(writes[0]).toBe('social_ad_audience_periods:upsert');
    expect(h.log[0]?.payload).not.toHaveProperty('synced_at');
    expect(writes.at(-1)).toBe('social_ad_audience_periods:upsert');
    const lastValue = writes.lastIndexOf('social_ad_audience:upsert');
    expect(lastValue).toBeGreaterThan(0);
    expect(lastValue).toBeLessThan(writes.length - 1);
    expect(periodRows('function')[0]).toMatchObject({ returned_count: 2, total_impressions: 1500, total_clicks: 25, is_final: false });
    expect(periodRows('function')[0]?.['synced_at']).toBeTruthy();
    expect(valuesTable().map((r) => `${r['label']}|${r['impressions']}|${r['clicks']}`).sort()).toEqual(['Engineering|1000|20', 'Marketing|500|5']);
  });

  it('makes a period final once it ended more than two weeks ago, and keeps it open when it just ended', async () => {
    vi.setSystemTime(new Date('2026-10-05T10:00:00Z'));
    await syncAdAudience('k', request);
    expect(periodRows('function')[0]?.['is_final']).toBe(false);
    h.tables['social_ad_audience_periods'] = [];
    await syncAdAudience('k', { dimension: 'function', start: '2026-04-01', end: '2026-06-30' });
    expect(periodRows('function')[0]?.['is_final']).toBe(true);
  });

  it('removes the values the network no longer returns, one by one, labels with quotes and commas included', async () => {
    const odd = 'Foo (« "Bar", Inc. »)';
    h.tables['social_ad_audience'] = [
      { platform: 'linkedin', dimension: 'function', period_start: T3.start, period_end: T3.end, label: odd, impressions: 5, clicks: 1 },
      { platform: 'linkedin', dimension: 'function', period_start: T3.start, period_end: T3.end, label: 'Engineering', impressions: 1, clicks: 1 },
      // Another period or dimension is never touched.
      { platform: 'linkedin', dimension: 'title', period_start: T3.start, period_end: T3.end, label: 'Gone', impressions: 5, clicks: 1 },
    ];
    await syncAdAudience('k', request);
    expect(valuesTable().map((r) => `${r['dimension']}|${r['label']}`).sort()).toEqual(['function|Engineering', 'function|Marketing', 'title|Gone']);
    expect(valuesTable().find((r) => r['label'] === 'Engineering')?.['impressions']).toBe(1000);
    const deletions = h.log.filter((o) => o.op === 'delete');
    expect(deletions).toHaveLength(1);
    expect(deletions[0]?.filters).toMatchObject({ dimension: 'function', label: odd });
  });

  it('puts the period back to « not read » when the rewrite is interrupted, so a mix of old and new values is never shown', async () => {
    h.tables['social_ad_audience_periods'] = [{ platform: 'linkedin', dimension: 'function', period_start: T3.start, period_end: T3.end, returned_count: 3, is_final: true, synced_at: '2026-10-01T00:00:00Z' }];
    h.tables['social_ad_audience'] = [{ platform: 'linkedin', dimension: 'function', period_start: T3.start, period_end: T3.end, label: 'Gone', impressions: 5, clicks: 1 }];
    h.fail = (table, op) => table === 'social_ad_audience' && op === 'delete';
    const out = await syncAdAudience('k', request);
    expect(out).toMatchObject({ success: false });
    // The loader keeps only readings with synced_at: this period reads as unavailable until a later tick completes it, and it is due again (not final).
    expect(periodRows('function')[0]?.['synced_at']).toBeNull();
    expect(periodRows('function')[0]?.['is_final']).toBe(false);
  });

  it('keeps the previous reading untouched when Windsor refuses the request, and does not leak the provider text', async () => {
    h.tables['social_ad_audience_periods'] = [{ platform: 'linkedin', dimension: 'function', period_start: T3.start, period_end: T3.end, returned_count: 3, is_final: false, synced_at: '2026-10-01T00:00:00Z' }];
    h.windsor.status = 400;
    const out = await syncAdAudience('super-secret-key', request);
    expect(out).toMatchObject({ success: false });
    expect(JSON.stringify(out)).not.toContain('super-secret-key');
    expect(periodRows('function')[0]?.['synced_at']).toBe('2026-10-01T00:00:00Z');
    expect(periodRows('function')[0]?.['last_attempt_at']).toBeTruthy();
    expect(valuesTable()).toEqual([]);
  });

  it('never writes the account sync status', async () => {
    await syncAdAudience('k', request);
    h.windsor.status = 500;
    await syncAdAudience('k', request);
    expect(h.log.some((o) => o.table === 'social_sync_status')).toBe(false);
  });

  describe('an empty answer', () => {
    beforeEach(() => { h.windsor.rows = []; });

    it('counts as « no delivery » only when a stored paid row on EVERY day proves a zero delivery', async () => {
      h.tables['social_daily'] = dailyRows(T3.start, T3.end, () => 0);
      expect(await syncAdAudience('k', request)).toMatchObject({ success: true, values: 0, returned: 0 });
      expect(periodRows('function')[0]).toMatchObject({ returned_count: 0, total_impressions: 0 });
      expect(periodRows('function')[0]?.['synced_at']).toBeTruthy();
    });

    it('is not counted when one day of the period has no stored paid row (a partly covered period proves nothing)', async () => {
      h.tables['social_daily'] = dailyRows(T3.start, T3.end, () => 0).filter((r) => r.day !== '2026-08-15');
      expect(await syncAdAudience('k', request)).toMatchObject({ success: false });
      expect(periodRows('function')[0]?.['synced_at']).toBeUndefined();
    });

    it('is not counted when a single stored day of the period has a paid delivery', async () => {
      h.tables['social_daily'] = dailyRows(T3.start, T3.end, (day) => (day === '2026-08-15' ? 12 : 0));
      expect(await syncAdAudience('k', request)).toMatchObject({ success: false });
      expect(valuesTable()).toEqual([]);
    });

    it('is not counted when nothing is stored for the period (history the network no longer serves, silent connector)', async () => {
      expect(await syncAdAudience('k', request)).toMatchObject({ success: false });
      expect(periodRows('function')[0]?.['synced_at']).toBeUndefined();
    });
  });
});

describe('syncAdAudienceWhenDue and the queue tick', () => {
  it('reads the most recent closed period first, one dimension per pass, and skips what was just tried', async () => {
    expect(await syncAdAudienceWhenDue('k')).toMatchObject({ success: true, dimension: 'function', start: '2026-07-01', end: '2026-09-30' });
    expect(await syncAdAudienceWhenDue('k')).toMatchObject({ success: true, dimension: 'title', start: '2026-07-01', end: '2026-09-30' });
    expect(h.fetches).toHaveLength(2);
    expect(new Set(h.fetches.map((u) => u.searchParams.get('fields'))).size).toBe(2);
  });

  it('does nothing when every reading is final, and when the tables are not there', async () => {
    h.tables['social_ad_audience_periods'] = adAudiencePeriods('2026-11-03').flatMap((p) =>
      AD_AUDIENCE_DIMENSIONS.map((d) => ({ platform: 'linkedin', dimension: d.key, period_start: p.start, period_end: p.end, is_final: true, synced_at: '2026-10-30T00:00:00Z' })));
    expect(await syncAdAudienceWhenDue('k')).toEqual({ skipped: true, reason: 'relevés à jour' });
    h.fail = (table) => table === 'social_ad_audience_periods';
    expect(await syncAdAudienceWhenDue('k')).toMatchObject({ skipped: true });
    expect(h.fetches).toHaveLength(0);
  });

  it('makes exactly one Windsor call per idle tick, and leaves the shape of the answer alone when a job is claimed elsewhere', async () => {
    const out = await processImport('k');
    expect(out).toMatchObject({ done: true, stories: { skipped: true }, adAudience: { success: true } });
    expect(h.fetches).toHaveLength(1);
  });
});
