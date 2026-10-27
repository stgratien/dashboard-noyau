import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DashboardFooter } from '../components/dashboard/footer';
import { client } from '../lib/client';

// The signature comes from the configuration: the generic tests read the neutral one ("Demo Studio").
vi.mock('@/client/config', async () => (await import('@/test/fixtures/neutral-client')).neutralClientModule());

describe('DashboardFooter', () => {
  it('writes the signature on every page, with a plain heart when nothing can be generated', () => {
    render(<DashboardFooter />);
    expect(screen.getByRole('contentinfo').textContent).toBe('Fait avec ♥️ par Demo Studio');
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('writes no signature when the client has none', () => {
    const credit = client.brand.footerCredit;
    client.brand.footerCredit = null;
    try {
      render(<DashboardFooter />);
      expect(screen.getByRole('contentinfo').textContent).toBe('Fait avec ♥️');
    } finally {
      client.brand.footerCredit = credit;
    }
  });
  it('makes the heart the link that generates a report on the Global tab', () => {
    const generate = vi.fn();
    render(<DashboardFooter onGenerate={generate} />);
    const heart = screen.getByRole('button', { name: 'Générer un reporting' });
    expect(heart.textContent).toBe('♥️');
    fireEvent.click(heart);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('disables the heart while a report is being generated', () => {
    render(<DashboardFooter onGenerate={() => undefined} generating />);
    expect((screen.getByRole('button', { name: 'Générer un reporting' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('is left out of PNG and PDF exports', () => {
    render(<DashboardFooter />);
    expect(screen.getByRole('contentinfo').hasAttribute('data-export-hide')).toBe(true);
  });
});
