import { describe, expect, it } from 'vitest';
import { formatPercent, formatChangePercent, formatPoints } from '@/lib/dashboard-format';
describe('percent format', () => {
  it('drops decimals from 10 upward, keeps one below, no space', () => {
    expect(formatChangePercent(23.4)).toBe('+23%');
    expect(formatChangePercent(-15.2)).toBe('−15%');
    expect(formatPercent(12.3)).toBe('12%');
    expect(formatChangePercent(5.24)).toBe('+5,2%');
    expect(formatPercent(1.8)).toBe('1,8%');
    expect(formatChangePercent(9.96)).toBe('+10%');
  });
  it('applies the same rule to points', () => {
    expect(formatPoints(12.2)).toBe('+12pt');
    expect(formatPoints(0.4)).toBe('+0,4pt');
    expect(formatPoints(-0.04)).toBe('0,0pt');
  });
});
