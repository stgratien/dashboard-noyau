import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Without the feature the page-visitors reading is inert: no table access, no Windsor call, and the answer of the queue tick keeps its shape (no pageAudience key). */
const h = vi.hoisted(() => ({ touched: [] as string[], fetches: 0 }));

vi.mock('@/integrations/supabase/client.server', () => ({
  supabaseAdmin: { from: (table: string) => { h.touched.push(table); throw new Error(`unexpected access to ${table}`); }, rpc: async () => ({ data: [], error: null }) },
}));
vi.mock('@/lib/windsor-accounts.server', () => ({ sourceAccount: () => 'acct-1', activeSources: () => ['linkedin_organic', 'linkedin'] }));
// Neutral configuration, LinkedIn only, the feature left off (its default).
vi.mock('@/client/config', async () => (await import('@/test/fixtures/neutral-client')).neutralClientModule({ sources: ['linkedin_organic', 'linkedin'] }));

import { processImport, syncPageAudience, syncPageAudienceWhenDue } from '@/lib/windsor-sync.server';

beforeEach(() => {
  h.touched = [];
  h.fetches = 0;
  vi.stubGlobal('fetch', vi.fn(async () => { h.fetches += 1; return { ok: true, status: 200, json: async () => ({ data: [] }) }; }));
});
afterEach(() => vi.unstubAllGlobals());

describe('page visitors reading with the feature off', () => {
  it('does nothing and touches nothing', async () => {
    expect(await syncPageAudienceWhenDue('k')).toEqual({ skipped: true, reason: 'Visiteurs de la page non activés' });
    expect(await syncPageAudience('k', { dimension: 'companySize', start: '2026-07-01', end: '2026-09-30' })).toEqual({ skipped: true, reason: 'Visiteurs de la page non activés' });
    expect(h.touched).toEqual([]);
    expect(h.fetches).toBe(0);
  });

  it('keeps the exact answer of the idle queue tick (no pageAudience key)', async () => {
    expect(await processImport('k')).toEqual({ done: true, stories: { skipped: true, reason: 'Instagram non configuré' } });
    expect(h.touched).toEqual([]);
    expect(h.fetches).toBe(0);
  });
});
