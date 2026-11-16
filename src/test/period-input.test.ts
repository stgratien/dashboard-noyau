import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_READ_DAYS, readRange } from '../lib/period-input';

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-16T10:00:00Z')); });
afterEach(() => vi.useRealTimers());
const ok = (start: string, end: string) => readRange.safeParse({ start, end }).success;

describe('readRange (periods accepted by the public read functions)', () => {
  it('accepts the periods the dashboard sends', () => {
    expect(ok('2026-10-14', '2026-11-12')).toBe(true);
    expect(ok('2023-02-01', '2026-11-15')).toBe(true);
    expect(ok('2025-06-01', '2025-06-01')).toBe(true);
    expect(ok('2027-03-10', '2027-03-16')).toBe(true);
  });
  it('refuses dates that do not exist, a reversed period and a malformed value', () => {
    expect(ok('2026-02-30', '2026-03-05')).toBe(false);
    expect(ok('2026-13-01', '2026-13-05')).toBe(false);
    expect(ok('2026-11-12', '2026-11-01')).toBe(false);
    expect(ok('26-11-01', '2026-11-12')).toBe(false);
  });
  it('refuses a period that is far too old, far in the future or far too long', () => {
    expect(ok('0001-01-01', '2026-11-12')).toBe(false);
    expect(ok('2026-01-01', '9999-12-31')).toBe(false);
    expect(ok('2000-01-01', '2026-11-12')).toBe(false);
    expect(MAX_READ_DAYS).toBeGreaterThan(1500);
    expect(readRange.safeParse({ start: 20260101, end: '2026-02-01' }).success).toBe(false);
  });
});
