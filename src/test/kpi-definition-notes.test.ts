import { describe, expect, it, vi } from 'vitest';
import { definition, type KpiKey } from '@/lib/kpi-definitions';

// The neutral configuration carries no kpiNotes: the definitions must then say nothing about an agency, an export or a date.
vi.mock('@/client/config', async () => (await import('@/test/fixtures/neutral-client')).neutralClientModule());

const KEYS: KpiKey[] = ['followers', 'newFollowers', 'posts', 'impressions', 'videoViews', 'interactions', 'engagementRate', 'storyInteractions', 'topPosts'];
const PLATFORMS = ['all', 'facebook', 'instagram', 'tiktok', 'linkedin'] as const;

describe('definitions without client notes', () => {
  it('stay generic: no agency, no history export, no year', () => {
    for (const key of KEYS) for (const p of PLATFORMS) {
      const text = definition(key, p);
      expect(text, `${key} / ${p}`).not.toMatch(/agence|Business Suite|\b20\d{2}\b/);
      expect(text, `${key} / ${p}`).not.toMatch(/ {2}|^ | $/);
    }
  });
  it('still describe the synchronized publications and the Windsor snapshot', () => {
    expect(definition('posts', 'facebook')).toContain('Le nombre vient des publications synchronisées.');
    expect(definition('followers', 'linkedin')).toContain('(instantané Windsor, sinon reconstitution marquée « Valeur estimée »)');
    expect(definition('storyInteractions', 'instagram')).toContain('(dans l’historique importé)');
  });
});
