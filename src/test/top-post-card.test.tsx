import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TopPostCard } from '../components/dashboard/platform-view';
import { postStats } from '../lib/top-posts';

vi.mock('@/client/config', async () => (await import('@/test/fixtures/neutral-client')).neutralClientModule());

const post = (extra: Record<string, unknown> = {}) =>
  postStats({ platform: 'instagram', post_id: 'p1', published_at: '2026-09-10T08:00:00Z', title: 'Un titre de publication assez long pour être tronqué à l’écran', format: 'Photo', permalink: 'https://www.instagram.com/p/abc/', thumbnail_path: null, thumbnail_url: 'https://example.test/p.jpg', metrics: { impressions: 13200, likes: 250, comments: 10, shares: 32 }, ...extra } as never);

describe('TopPostCard', () => {
  it('shows the whole picture first, then the title, the date and the figures below', () => {
    const { container } = render(<TopPostCard title="Visibilité" post={post()} kind="visibility" />);
    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toBe('https://example.test/p.jpg');
    // Entire picture on a neutral ground, never cropped.
    expect(image?.className).toContain('object-contain');
    expect(image?.className).not.toContain('object-cover');
    const order = [...container.querySelectorAll('img, dl')].map((el) => el.tagName);
    expect(order).toEqual(['IMG', 'DL']);
    expect(screen.getByText(/10\/09\/2026/)).toBeTruthy();
    // Each figure keeps its label (dt) before its value (dd) in the markup.
    const first = container.querySelector('dl > div');
    expect([...first!.children].map((el) => el.tagName)).toEqual(['DT', 'DD']);
    expect(screen.getByText('Impressions / vues')).toBeTruthy();
  });
  it('keeps the full title available on hover when it is cut to one line', () => {
    render(<TopPostCard title="Visibilité" post={post()} kind="visibility" />);
    expect(screen.getAllByTitle(/Un titre de publication/).length).toBeGreaterThan(0);
  });
  it('shows a format tile instead of a picture when there is none, and the empty note without post', () => {
    const { container, rerender } = render(<TopPostCard title="Visibilité" post={post({ thumbnail_url: '' })} kind="visibility" />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('img', { name: /Visuel non disponible : Photo/ })).toBeTruthy();
    rerender(<TopPostCard title="Engagement" post={null} kind="engagement" emptyNote="Aucune publication sur la période" />);
    expect(screen.getByText('Aucune publication sur la période')).toBeTruthy();
  });
  it('puts the figure that ranks the card first', () => {
    const { container } = render(<TopPostCard title="Engagement" post={post()} kind="engagement" />);
    expect(container.querySelector('dl dt')?.textContent).toBe('Interactions');
  });
});
