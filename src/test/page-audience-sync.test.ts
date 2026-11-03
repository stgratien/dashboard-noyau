import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The page-visitors reading of windsor-sync.server.ts, run against an in-memory fake of the admin Supabase client (with the log of every write,
 * in order) and a fake Windsor endpoint: the period row is written last, a reading that did not complete never looks read, an empty answer is never
 * counted, and the queue tick makes one Windsor call (the stories, then the sponsored audience, then the page visitors).
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
    social_page_audience: ['platform', 'dimension', 'period_start', 'period_end', 'label'],
    social_page_audience_periods: ['platform', 'dimension', 'period_start', 'period_end'],
    social_ad_audience: ['platform', 'dimension', 'period_start', 'period_end', 'label'],
    social_ad_audience_periods: ['platform', 'dimension', 'period_start', 'period_end'],
  };
  class Query {
    private mode: 'select' | 'upsert' | 'delete' = 'select';
    private payload: Row | Row[] | undefined;
    private conflict: string[] = [];
    private filters: Row = {};
    private max = Infinity;
    constructor(private table: string) {}
    select() { return this; }
    upsert(payload: Row | Row[], options?: { onConflict?: string }) { this.mode = 'upsert'; this.payload = payload; this.conflict = (options?.onConflict ?? '').split(','); return this; }
    delete() { this.mode = 'delete'; return this; }
    update() { return this; }
    eq(col: string, value: unknown) { this.filters[col] = value; return this; }
    match(values: Row) { Object.assign(this.filters, values); return this; }
    gte() { return this; }
    lte() { return this; }
    not() { return this; }
    order() { return this; }
    limit(n: number) { this.max = n; return this; }
    maybeSingle() { return Promise.resolve({ data: null, error: null }); }
    private matching() {
      return (h.tables[this.table] ??= []).filter((r) => Object.entries(this.filters).every(([c, v]) => r[c] === v));
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
        else rows.push({ ...(this.table.endsWith('_periods') ? { is_final: false } : {}), ...item });
      }
      return resolve({ data: null, error: null });
    }
  }
  return { supabaseAdmin: { from: (table: string) => new Query(table), rpc: async () => ({ data: h.claim, error: null }) } };
});
vi.mock('@/lib/windsor-accounts.server', () => ({ sourceAccount: () => 'acct-1', activeSources: () => ['linkedin_organic', 'linkedin'] }));
// Neutral configuration, LinkedIn only (so the stories, which are Instagram's, are never due), page visitors on, sponsored audience on.
vi.mock('@/client/config', async () =>
  (await import('@/test/fixtures/neutral-client')).neutralClientModule({ sources: ['linkedin_organic', 'linkedin'], features: { adAudience: true, pageAudience: true } }));

import { processImport, syncPageAudience, syncPageAudienceWhenDue } from '@/lib/windsor-sync.server';
import { adAudiencePeriods } from '@/lib/dashboard-periods';
import { PAGE_AUDIENCE_DIMENSIONS } from '@/lib/page-audience';

const T3 = { start: '2026-07-01', end: '2026-09-30' };
const request = { dimension: 'companySize' as const, ...T3 };
const periodsTable = () => h.tables['social_page_audience_periods'] ?? [];
const valuesTable = () => h.tables['social_page_audience'] ?? [];
const range = (label: string, views: number | string | null, day?: string) => ({ page_staff_count_range: label, page_views_by_staff_count_range: views, ...(day ? { date: day } : {}) });
/** Every sponsored-audience reading final: the sponsored audience then has nothing to do on a queue tick. */
const sponsoredAllFinal = () => adAudiencePeriods('2026-11-03').flatMap((p) =>
  ['function', 'title', 'industry', 'company', 'seniority', 'region'].map((dimension) => ({ platform: 'linkedin', dimension, period_start: p.start, period_end: p.end, is_final: true, synced_at: '2026-10-30T00:00:00Z' })));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T10:00:00Z'));
  h.tables = { social_page_audience: [], social_page_audience_periods: [], social_ad_audience: [], social_ad_audience_periods: [], social_daily: [], social_sync_status: [] };
  h.log = [];
  h.fail = null;
  h.claim = [];
  h.windsor = { status: 200, rows: [range('SIZE_11_TO_50', 1000), range('SIZE_51_TO_200', 500)] };
  h.fetches = [];
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
    h.fetches.push(new URL(url));
    return { ok: h.windsor.status < 400, status: h.windsor.status, json: async () => ({ data: h.windsor.rows }) };
  }));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('syncPageAudience', () => {
  it('asks Windsor (page connector) for the exact period and the two fields, then writes the values and the period row LAST', async () => {
    vi.setSystemTime(new Date('2026-10-05T10:00:00Z'));
    const out = await syncPageAudience('k', request);
    expect(out).toMatchObject({ success: true, values: 2, returned: 2 });
    expect(h.fetches).toHaveLength(1);
    const url = h.fetches[0]!;
    expect(url.pathname).toBe('/linkedin_organic');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ date_from: '2026-07-01', date_to: '2026-09-30', fields: 'page_staff_count_range,page_views_by_staff_count_range', select_accounts: 'acct-1' });
    // Order of the writes: the attempt (no synced_at, so a previous reading is untouched), the reopening, the values, the period row with synced_at.
    const writes = h.log.map((o) => `${o.table}:${o.op}`);
    expect(writes[0]).toBe('social_page_audience_periods:upsert');
    expect(h.log[0]?.payload).not.toHaveProperty('synced_at');
    expect(writes.at(-1)).toBe('social_page_audience_periods:upsert');
    const lastValue = writes.lastIndexOf('social_page_audience:upsert');
    expect(lastValue).toBeGreaterThan(0);
    expect(lastValue).toBeLessThan(writes.length - 1);
    expect(periodsTable()[0]).toMatchObject({ dimension: 'companySize', returned_count: 2, total_views: 1500, is_final: false });
    expect(periodsTable()[0]?.['synced_at']).toBeTruthy();
    // The raw labels of the network are stored, the French labels come at display time.
    expect(valuesTable().map((r) => `${r['label']}|${r['views']}`).sort()).toEqual(['SIZE_11_TO_50|1000', 'SIZE_51_TO_200|500']);
    expect(writes.every((w) => w.startsWith('social_page_audience'))).toBe(true);
  });

  it('adds the rows of the same label (the network may answer one row per day) before storing', async () => {
    h.windsor.rows = [range('SIZE_11_TO_50', 300, '2026-07-01'), range('SIZE_11_TO_50', '200', '2026-07-02'), range('SIZE_1', 40, '2026-07-01'), range('', 99), range('SIZE_501_TO_1000', 0)];
    expect(await syncPageAudience('k', request)).toMatchObject({ success: true, values: 2, returned: 2 });
    expect(valuesTable().map((r) => `${r['label']}|${r['views']}`).sort()).toEqual(['SIZE_11_TO_50|500', 'SIZE_1|40'].sort());
    expect(periodsTable()[0]).toMatchObject({ returned_count: 2, total_views: 540 });
  });

  it('makes a period final once it ended more than two weeks ago, and keeps it open when it just ended', async () => {
    vi.setSystemTime(new Date('2026-10-05T10:00:00Z'));
    await syncPageAudience('k', request);
    expect(periodsTable()[0]?.['is_final']).toBe(false);
    h.tables['social_page_audience_periods'] = [];
    await syncPageAudience('k', { dimension: 'companySize', start: '2026-04-01', end: '2026-06-30' });
    expect(periodsTable()[0]?.['is_final']).toBe(true);
  });

  it('removes the values the network no longer returns, one by one, labels with quotes and commas included', async () => {
    const odd = 'Foo (« "Bar", Inc. »)';
    const row = (period: typeof T3, label: string, views: number) => ({ platform: 'linkedin', dimension: 'companySize', period_start: period.start, period_end: period.end, label, views });
    h.tables['social_page_audience'] = [
      row(T3, odd, 5), row(T3, 'SIZE_11_TO_50', 1),
      // Another period is never touched.
      row({ start: '2026-04-01', end: '2026-06-30' }, 'Gone', 5),
    ];
    await syncPageAudience('k', request);
    expect(valuesTable().map((r) => `${r['period_start']}|${r['label']}`).sort()).toEqual(['2026-04-01|Gone', '2026-07-01|SIZE_11_TO_50', '2026-07-01|SIZE_51_TO_200']);
    expect(valuesTable().find((r) => r['label'] === 'SIZE_11_TO_50')?.['views']).toBe(1000);
    const deletions = h.log.filter((o) => o.op === 'delete');
    expect(deletions).toHaveLength(1);
    expect(deletions[0]?.filters).toMatchObject({ dimension: 'companySize', label: odd });
  });

  it('puts the period back to « not read » when the rewrite is interrupted, so a mix of old and new values is never shown', async () => {
    h.tables['social_page_audience_periods'] = [{ platform: 'linkedin', dimension: 'companySize', period_start: T3.start, period_end: T3.end, returned_count: 3, is_final: true, synced_at: '2026-10-01T00:00:00Z' }];
    h.tables['social_page_audience'] = [{ platform: 'linkedin', dimension: 'companySize', period_start: T3.start, period_end: T3.end, label: 'Gone', views: 5 }];
    h.fail = (table, op) => table === 'social_page_audience' && op === 'delete';
    const out = await syncPageAudience('k', request);
    expect(out).toMatchObject({ success: false });
    // The loader keeps only readings with synced_at: this period reads as unavailable until a later tick completes it, and it is due again (not final).
    expect(periodsTable()[0]?.['synced_at']).toBeNull();
    expect(periodsTable()[0]?.['is_final']).toBe(false);
  });

  it('keeps the previous reading untouched when Windsor refuses the request, and does not leak the provider text', async () => {
    h.tables['social_page_audience_periods'] = [{ platform: 'linkedin', dimension: 'companySize', period_start: T3.start, period_end: T3.end, returned_count: 3, is_final: false, synced_at: '2026-10-01T00:00:00Z' }];
    h.windsor.status = 400;
    const out = await syncPageAudience('super-secret-key', request);
    expect(out).toMatchObject({ success: false });
    expect(JSON.stringify(out)).not.toContain('super-secret-key');
    expect(periodsTable()[0]?.['synced_at']).toBe('2026-10-01T00:00:00Z');
    expect(periodsTable()[0]?.['last_attempt_at']).toBeTruthy();
    expect(valuesTable()).toEqual([]);
  });

  it('never writes the account sync status', async () => {
    await syncPageAudience('k', request);
    h.windsor.status = 500;
    await syncPageAudience('k', request);
    h.windsor = { status: 200, rows: [] };
    await syncPageAudience('k', request);
    expect(h.log.some((o) => o.table === 'social_sync_status')).toBe(false);
  });

  describe('an empty answer', () => {
    beforeEach(() => { h.windsor.rows = []; });

    it('is NEVER counted, whatever the stored paid delivery says : nothing proves an absence of visits', async () => {
      const day = (d: string) => ({ platform: 'linkedin', source: 'linkedin', day: d, metrics: { impressions: 0 } });
      // Even a stored zero delivery on every day of the period (what makes the sponsored audience accept an empty answer) proves nothing about the page.
      h.tables['social_daily'] = Array.from({ length: 92 }, (_, i) => day(new Date(Date.UTC(2026, 6, 1 + i)).toISOString().slice(0, 10)));
      const out = await syncPageAudience('k', request);
      expect(out).toMatchObject({ success: false });
      expect(valuesTable()).toEqual([]);
      expect(periodsTable()[0]?.['synced_at']).toBeUndefined();
    });

    it('notes the attempt (so a silent connector is not asked again at every tick) and leaves a previous reading untouched', async () => {
      h.tables['social_page_audience_periods'] = [{ platform: 'linkedin', dimension: 'companySize', period_start: T3.start, period_end: T3.end, returned_count: 2, total_views: 1500, is_final: false, synced_at: '2026-10-01T00:00:00Z' }];
      h.tables['social_page_audience'] = [{ platform: 'linkedin', dimension: 'companySize', period_start: T3.start, period_end: T3.end, label: 'SIZE_1', views: 9 }];
      expect(await syncPageAudience('k', request)).toMatchObject({ success: false });
      expect(periodsTable()[0]?.['last_attempt_at']).toBeTruthy();
      expect(periodsTable()[0]?.['synced_at']).toBe('2026-10-01T00:00:00Z');
      expect(valuesTable()).toHaveLength(1);
      expect(h.log.filter((o) => o.op === 'delete')).toEqual([]);
    });

    it('is not counted either when every row was unusable (no label, no page view)', async () => {
      h.windsor.rows = [range('', 10), range('SIZE_1', 0), range('SIZE_11_TO_50', null)];
      expect(await syncPageAudience('k', request)).toMatchObject({ success: false });
      expect(periodsTable()[0]?.['synced_at']).toBeUndefined();
    });
  });
});

describe('syncPageAudienceWhenDue and the queue tick', () => {
  it('reads the most recent closed period first, one reading per pass, and skips what was just tried', async () => {
    expect(await syncPageAudienceWhenDue('k')).toMatchObject({ success: true, dimension: 'companySize', start: '2026-07-01', end: '2026-09-30' });
    const second = await syncPageAudienceWhenDue('k');
    // The newest period was just read: the next pass takes the previous closed period.
    expect(second).toMatchObject({ success: true, dimension: 'companySize' });
    expect((second as { start: string }).start < '2026-07-01').toBe(true);
    expect(h.fetches).toHaveLength(2);
  });

  it('does nothing when every reading is final, and when the tables are not there', async () => {
    h.tables['social_page_audience_periods'] = adAudiencePeriods('2026-11-03').flatMap((p) =>
      PAGE_AUDIENCE_DIMENSIONS.map((d) => ({ platform: 'linkedin', dimension: d.key, period_start: p.start, period_end: p.end, is_final: true, synced_at: '2026-10-30T00:00:00Z' })));
    expect(await syncPageAudienceWhenDue('k')).toEqual({ skipped: true, reason: 'relevés à jour' });
    h.fail = (table) => table === 'social_page_audience_periods';
    expect(await syncPageAudienceWhenDue('k')).toMatchObject({ skipped: true });
    expect(h.fetches).toHaveLength(0);
  });

  it('retries a period whose attempt failed only after the delay', async () => {
    h.windsor.status = 500;
    expect(await syncPageAudienceWhenDue('k')).toMatchObject({ success: false });
    h.windsor.status = 200;
    // Same pass, a few minutes later: the failed period is skipped for the retry delay, the next closed period is taken.
    vi.setSystemTime(new Date('2026-11-03T10:03:00Z'));
    const next = await syncPageAudienceWhenDue('k');
    expect(next).toMatchObject({ success: true });
    expect((next as { start: string }).start < '2026-07-01').toBe(true);
  });

  it('makes exactly one Windsor call per idle tick: the sponsored audience goes first, the page visitors wait for it to have nothing to do', async () => {
    // The sponsored audience reads the profile fields of the ads connector: the fake answers with such a row on the first tick.
    h.windsor.rows = [{ member_job_function: 'Engineering', impressions: 10, clicks: 1 }];
    const first = await processImport('k');
    expect(first).toMatchObject({ done: true, stories: { skipped: true }, adAudience: { success: true } });
    expect(first).not.toHaveProperty('pageAudience');
    expect(h.fetches).toHaveLength(1);
    expect(h.fetches[0]?.pathname).toBe('/linkedin');
    expect(valuesTable()).toEqual([]);

    h.fetches = [];
    h.windsor.rows = [range('SIZE_11_TO_50', 1000)];
    h.tables['social_ad_audience_periods'] = sponsoredAllFinal();
    const second = await processImport('k');
    expect(second).toMatchObject({ done: true, stories: { skipped: true }, adAudience: { skipped: true }, pageAudience: { success: true } });
    expect(h.fetches).toHaveLength(1);
    expect(h.fetches[0]?.pathname).toBe('/linkedin_organic');
  });

  it('does not read the page visitors on a tick where a job of the queue is claimed', async () => {
    h.claim = [{ id: 1, source: 'nobody', date_from: '2026-10-01', date_to: '2026-10-02' }];
    const out = await processImport('k');
    expect(out).not.toHaveProperty('pageAudience');
    expect(h.fetches).toHaveLength(0);
  });
});
