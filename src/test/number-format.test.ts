import { describe, it, expect } from 'vitest';
import { formatNumber, formatEuro, formatPercent, plural, changePercent, typographicMinus, videosNote, formatBudget, labelForValue, dayMonth } from '../lib/dashboard-format';

describe('number format', () => {
  it('drops the decimal from 100K upward and keeps one below', () => {
    expect(formatNumber(162000)).toBe('162K');
    expect(formatNumber(471499)).toBe('471K');
    expect(formatNumber(99949)).toBe('99,9K');
    expect(formatNumber(99950)).toBe('100K');
    expect(formatNumber(75100)).toBe('75,1K');
    expect(formatNumber(98234)).toBe('98,2K');
    expect(formatEuro(1400)).toBe('1,4K€');
    expect(formatEuro(162000)).toBe('162K€');
  });
  it('millions always keep one decimal, even when it is zero', () => {
    expect(formatNumber(1027325)).toBe('1,0M');
    expect(formatNumber(1000000)).toBe('1,0M');
    expect(formatNumber(1100000)).toBe('1,1M');
    expect(formatNumber(2000000)).toBe('2,0M');
    expect(formatNumber(12345678)).toBe('12,3M');
    expect(formatEuro(1027325, 2)).toBe('1,03M€');
  });
  it('switches to the next unit before rounding up to 1 000', () => {
    expect(formatNumber(999499)).toBe('999K');
    expect(formatNumber(999500)).toBe('1,0M');
    expect(formatNumber(999600)).toBe('1,0M');
    expect(formatNumber(999.6)).toBe('1K');
    expect(formatNumber(999)).toBe('999');
    expect(formatEuro(999.6, 2)).toBe('999,60€');
  });
  it('shows no minus sign on a percentage that rounds to zero', () => {
    expect(formatPercent(-0.04)).toBe('0,0%');
    expect(formatPercent(-0.5)).toBe('−0,5%');
    expect(formatPercent(9.6)).toBe('9,6%');
    expect(formatPercent(14)).toBe('14%');
  });
  it('shows a budget without cents: whole euros under 1 000, then K with a comma', () => {
    expect(formatBudget(0.4)).toBe('<1€');
    expect(formatBudget(0.49)).toBe('<1€');
    expect(formatBudget(0.5)).toBe('1€');
    expect(formatBudget(0)).toBe('0€');
    expect(formatBudget(7.81)).toBe('8€');
    expect(formatBudget(81.54)).toBe('82€');
    expect(formatBudget(329)).toBe('329€');
    expect(formatBudget(999.6)).toBe('1K€');
    expect(formatBudget(1500)).toBe('1,5K€');
    expect(formatBudget(1540.4)).toBe('1,5K€');
    expect(formatBudget(2564)).toBe('2,6K€');
    expect(formatBudget(12345.6)).toBe('12,3K€');
    expect(formatBudget(162000)).toBe('162K€');
    expect(formatBudget(0)).toBe('0€');
    expect(formatBudget(-0.2)).toBe('0€');
    expect(formatBudget(null)).toBe('Donnée non disponible');
    expect(formatBudget(Number.NaN)).toBe('Donnée non disponible');
  });
  it('uses a real minus sign and never shows -0', () => {
    expect(formatNumber(-3)).toBe('−3');
    expect(formatNumber(-1500)).toBe('−1,5K');
    expect(formatNumber(-0.4)).toBe('0');
    expect(formatEuro(-45)).toBe('−45€');
    expect(typographicMinus('-12')).toBe('−12');
    expect(typographicMinus('12')).toBe('12');
  });
  it('keeps the sign of a variation when the previous value is negative', () => {
    expect(changePercent(-2, -3)).toBeCloseTo(33.33, 1);
    expect(changePercent(-4, -3)).toBeCloseTo(-33.33, 1);
    expect(changePercent(5, -3)).toBeGreaterThan(0);
    expect(changePercent(110, 100)).toBeCloseTo(10, 5);
    expect(changePercent(0, 10633)).toBe(-100);
    expect(changePercent(5, 0)).toBeUndefined();
  });
  it('words the note under "Vues de vidéo" without repeating the video count (it has its own card)', () => {
    expect(videosNote({ videos: 5, videoViews: 34920 })).toBe('');
    expect(videosNote({ videos: 1, videoViews: 10633 })).toBe('');
    expect(videosNote({ videos: 0, videoViews: 0 })).toBe('Aucune vidéo publiée sur la période');
    expect(videosNote({ videos: 0, videoViews: 4200 })).toBe('Vues de vidéos publiées avant la période');
    expect(videosNote({ videos: null, videoViews: 100 })).toBe('Nombre de vidéos non disponible');
    expect(videosNote({ videos: 14, videoViews: 100 }, ['Facebook'])).toBe('hors Facebook');
    expect(videosNote({ videos: null, videoViews: null }, ['Facebook', 'Instagram'])).toBe('Nombre de vidéos non disponible');
  });
  it('agrees the French plural', () => {
    expect([0, 1, 2, 16].map(n => `${n} ${plural(n, 'vidéo')}`)).toEqual(['0 vidéo', '1 vidéo', '2 vidéos', '16 vidéos']);
  });
});

describe('card titles follow their value', () => {
  it('uses the singular for 0 and 1, the plural from 2', () => {
    expect(labelForValue('Vidéos publiées', '0')).toBe('Vidéo publiée');
    expect(labelForValue('Vidéos publiées', '1')).toBe('Vidéo publiée');
    expect(labelForValue('Vidéos publiées', '2')).toBe('Vidéos publiées');
    expect(labelForValue('Nouveaux abonnés', '+1')).toBe('Nouvel abonné');
    expect(labelForValue('Nouveaux abonnés', '+0')).toBe('Nouvel abonné');
    expect(labelForValue('Nouveaux abonnés', '+566')).toBe('Nouveaux abonnés');
    expect(labelForValue('Publications', '0')).toBe('Publication');
    expect(labelForValue('Clics sur les liens', '1')).toBe('Clic sur les liens');
  });
  it('leaves other values, other labels and unavailable data alone', () => {
    expect(labelForValue('Vidéos publiées', 'Donnée non disponible')).toBe('Vidéos publiées');
    expect(labelForValue('Vidéos publiées', '1,5K')).toBe('Vidéos publiées');
    expect(labelForValue('Budget dépensé', '0')).toBe('Budget dépensé');
    expect(labelForValue('CPM', '1')).toBe('CPM');
  });
});

describe('chart dates', () => {
  it('shows day, dash, month, without the year', () => {
    expect(dayMonth('2026-10-18')).toBe('18-10');
    expect(dayMonth('2026-01-05')).toBe('05-01');
    expect(dayMonth('2026-10-18T10:00:00Z')).toBe('18-10');
  });
  it('leaves anything else as it is', () => {
    expect(dayMonth('oct. 26')).toBe('oct. 26');
    expect(dayMonth(42)).toBe('42');
  });
});
