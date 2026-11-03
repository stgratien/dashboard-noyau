import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RefreshButton } from '../components/dashboard/common';

vi.mock('@/client/config', async () => (await import('@/test/fixtures/neutral-client')).neutralClientModule());

describe('RefreshButton', () => {
  it('shows the icon only, keeps « Actualiser » as its accessible name, and has no hover tooltip', () => {
    const { container } = render(<RefreshButton onRefresh={() => {}} />);
    const button = screen.getByRole('button', { name: 'Actualiser' });
    expect(button.textContent).toBe('');
    expect(button.querySelector('svg')).not.toBeNull();
    expect(button.hasAttribute('title')).toBe(false);
    // Same square icon button as the theme toggle next to it.
    expect(button.className).toContain('w-9');
    expect(container.querySelectorAll('button')).toHaveLength(1);
  });

  it('calls the refresh handler once per click and carries the extra class of the header', () => {
    const onRefresh = vi.fn();
    render(<RefreshButton onRefresh={onRefresh} className="max-sm:order-2" />);
    const button = screen.getByRole('button', { name: 'Actualiser' });
    fireEvent.click(button);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(button.className).toContain('max-sm:order-2');
  });
});
