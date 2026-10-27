import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Kpi } from '../components/dashboard/common';

vi.mock('@/client/config', async () => (await import('@/test/fixtures/neutral-client')).neutralClientModule());

describe('Kpi note', () => {
  it('shows « partiel » next to a figure', () => {
    render(<Kpi label="Impressions" value="1,2M" note="partiel" />);
    expect(screen.getByText('partiel')).toBeTruthy();
  });
  it('drops « partiel » next to « Donnée non disponible » but keeps the other notes', () => {
    render(<Kpi label="Impressions" value="Donnée non disponible" note="partiel · 3 vidéos sans vues" />);
    expect(screen.queryByText(/partiel/)).toBeNull();
    expect(screen.getByText('3 vidéos sans vues')).toBeTruthy();
  });
  it('shows no note at all when « partiel » was the only one', () => {
    const { container } = render(<Kpi label="Impressions" value="Donnée non disponible" note="partiel" />);
    expect(container.textContent).not.toContain('partiel');
  });
});
