import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Sponsored audience on, page visitors off: the idle queue tick answers with an adAudience key and never with a pageAudience one, and the page-visitors tables are never touched.
 */
const h = vi.hoisted(() => ({ touched: [] as string[], fetches: [] as string[] }));

vi.mock('@/integrations/supabase/client.server', () => {
  // An empty table that accepts every read and write.
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'upsert', 'delete', 'eq', 'match', 'gte', 'lte', 'not', 'order', 'limit']) query[method] = () => query;
  query['then'] = (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: [], error: null });
  return { supabaseAdmin: { from: (table: string) => { h.touched.push(table); return query; }, rpc: async () => ({ data: [], error: null }) } };
});
vi.mock('@/lib/windsor-accounts.server', () => ({ sourceAccount: () => 'acct-1', activeSources: () => ['linkedin_organic', 'linkedin'] }));
vi.mock('@/client/config', async () =>
  (await import('@/test/fixtures/neutral-client')).neutralClientModule({ sources: ['linkedin_organic', 'linkedin'], features: { adAudience: true } }));

import { processImport } from '@/lib/windsor-sync.server';

beforeEach(() => {
  h.touched = [];
  h.fetches = [];
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T10:00:00Z'));
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
    h.fetches.push(new URL(url).pathname);
    return { ok: true, status: 200, json: async () => ({ data: [{ member_job_function: 'Engineering', impressions: 10, clicks: 1 }] }) };
  }));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('idle queue tick with the sponsored audience on and the page visitors off', () => {
  it('answers with the sponsored audience only, from one Windsor call, and never reads a page-visitors table', async () => {
    const out = await processImport('k');
    expect(out).toMatchObject({ done: true, stories: { skipped: true }, adAudience: { success: true } });
    expect(out).not.toHaveProperty('pageAudience');
    expect(h.fetches).toEqual(['/linkedin']);
    expect(h.touched.some((table) => table.startsWith('social_page_audience'))).toBe(false);
  });
});
