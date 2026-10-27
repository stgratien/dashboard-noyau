import { describe, expect, it, vi } from 'vitest';
import { definition } from '@/lib/kpi-definitions';

// A client that has a manual history describes it through kpiNotes: the definitions then carry its own words.
vi.mock('@/client/config', async () => (await import('@/test/fixtures/neutral-client')).neutralClientModule({
  kpiNotes: { history: 'Historique X.', followersFallback: 'un export X', newFollowersLinkedin: 'Limite X.', posts: 'Origine X.', storyHistory: 'les exports X' },
}));

describe('definitions with client notes', () => {
  it('writes the client history sentence where figures can come from a manual history', () => {
    expect(definition('impressions', 'facebook')).toContain('Historique X.');
    expect(definition('interactions', 'linkedin')).toContain('Historique X.');
    expect(definition('videoViews', 'facebook')).toContain('Historique X.');
    expect(definition('newFollowers', 'facebook')).toContain('Source : Windsor.ai. Historique X.');
    // TikTok figures come from the published videos, never from the history.
    expect(definition('impressions', 'tiktok')).not.toContain('Historique X.');
  });
  it('writes the follower fallback, the LinkedIn limit, the publications origin and the story history', () => {
    expect(definition('followers', 'linkedin')).toContain('(instantané Windsor, sinon un export X, sinon reconstitution');
    expect(definition('newFollowers', 'linkedin')).toContain('Limite X. Source : Windsor.ai.');
    expect(definition('posts', 'facebook')).toContain('Origine X. Source : Windsor.ai.');
    expect(definition('storyInteractions', 'instagram')).toContain('(dans les exports X)');
  });
});
