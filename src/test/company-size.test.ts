import { describe, expect, it } from 'vitest';
import { companySizeLabel } from '../lib/company-size';
import { audienceBreakdowns, audiencePanels } from '../lib/top-posts';

const nb = (s: string) => s.replace(/ /g, ' ');

describe('companySizeLabel', () => {
  it('turns the network codes into short French labels', () => {
    expect(nb(companySizeLabel('SIZE_11_TO_50'))).toBe('11-50 employés');
    expect(nb(companySizeLabel('SIZE_51_TO_200'))).toBe('51-200 employés');
    expect(nb(companySizeLabel('SIZE_201_TO_500'))).toBe('201-500 employés');
    expect(nb(companySizeLabel('SIZE_501_TO_1000'))).toBe('501-1 000 employés');
    expect(nb(companySizeLabel('SIZE_1001_TO_5000'))).toBe('1001-5 000 employés');
    expect(nb(companySizeLabel('SIZE_5001_TO_10000'))).toBe('5001-10 000 employés');
    expect(nb(companySizeLabel('SIZE_10001_OR_MORE'))).toBe('+ de 10 000 employés');
    expect(companySizeLabel('SIZE_1')).toBe('1 employé');
    expect(companySizeLabel('SIZE_NOT_AVAILABLE')).toBe('Non précisé');
  });
  it('normalizes readable labels the same way and keeps anything else as it is', () => {
    expect(nb(companySizeLabel('11-50'))).toBe('11-50 employés');
    expect(nb(companySizeLabel('10001+'))).toBe('+ de 10 000 employés');
    expect(nb(companySizeLabel(' 201 – 500 '))).toBe('201-500 employés');
    expect(companySizeLabel('Autre tranche')).toBe('Autre tranche');
    expect(companySizeLabel('SIZE_SOME_NEW_CODE')).toBe('SOME NEW CODE');
    // Séparateurs de milliers et libellés vides.
    expect(nb(companySizeLabel('10 001+'))).toBe('+ de 10 000 employés');
    expect(nb(companySizeLabel('10,001+'))).toBe('+ de 10 000 employés');
    expect(nb(companySizeLabel('1 001-5 000'))).toBe('1001-5 000 employés');
    expect(companySizeLabel('SIZE_')).toBe('Non précisé');
    expect(companySizeLabel('')).toBe('Non précisé');
    expect(companySizeLabel(undefined as unknown as string)).toBe('Non précisé');
  });
});

describe('company size panel of the LinkedIn followers', () => {
  const row = (label: string, value: number) => ({ platform: 'linkedin', dimension: 'companySize', label, value, unit: 'count' });
  it('ranks the ranges by followers with their share, in French, adding the codes that give the same label', () => {
    const a = audienceBreakdowns([row('SIZE_10001_OR_MORE', 600), row('SIZE_11_TO_50', 100), row('SIZE_1001_TO_5000', 250), row('11-50', 50)], 'linkedin');
    expect(a.companySize.map((i) => [nb(i.label), i.value])).toEqual([['+ de 10 000 employés', 600], ['1001-5 000 employés', 250], ['11-50 employés', 150]]);
    expect(a.companySize[0]?.percent).toBeCloseTo(60, 5);
    const panel = audiencePanels('linkedin', a).find((p) => p.key === 'companySize');
    expect(panel?.title).toBe('Tailles d’entreprise (top 10)');
    expect(panel?.items).toHaveLength(3);
  });
  it('is not a panel of the other networks', () => {
    expect(audiencePanels('instagram', audienceBreakdowns([], 'instagram')).some((p) => p.key === 'companySize')).toBe(false);
  });
});
