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
      expect(text, `${key} / ${p}`).not.toMatch(/agence|export de|export importé|exports? natifs?|Business Suite|\b20\d{2}\b/);
      expect(text, `${key} / ${p}`).not.toMatch(/ {2}|^ | $/);
    }
  });
  it('define the CPE as the budget over the total interactions, organic and paid, on every network', () => {
    for (const p of PLATFORMS) {
      expect(definition('cpe', p)).toContain('interactions totales');
      expect(definition('cpe', p)).toContain('organique et payant confondus');
    }
    expect(definition('cpe', 'all')).toContain('budget des réseaux sociaux ÷ interactions de ces mêmes réseaux (YouTube');
    expect(definition('cpe', 'tiktok')).toContain('vidéos publiées sur la période');
    expect(definition('cpe', 'facebook')).not.toContain('YouTube');
    expect(definition('topPosts', 'linkedin')).toContain('interactions totales de la publication');
  });
  it('still describe the synchronized publications and the Windsor snapshot', () => {
    expect(definition('posts', 'facebook')).toContain('Le nombre vient des publications synchronisées.');
    expect(definition('followers', 'linkedin')).toContain('(instantané Windsor, sinon reconstitution marquée « Valeur estimée »)');
    expect(definition('storyInteractions', 'instagram')).toContain('(dans l’historique importé)');
  });
});
