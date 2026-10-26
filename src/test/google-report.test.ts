import { describe, it, expect } from 'vitest';
import { cardObjectId, changeObjectId, countReplacements, describeGoogleError, leftoverMarkers, MAX_REPORT_DAYS, periodLength, replaceRequests, reportFileName, reportQuery, shapeIds, textFieldMask, toneRequests, withoutObjects } from '../lib/google-report';

const run = (content: string) => ({ textElements: [{ textRun: { content } }] });

describe('google report helpers', () => {
  it('builds one case-sensitive replacement per marker', () => {
    expect(replaceRequests({ 'linkedin.impressions': '2,1M', trimestre: 'T2 2026' })).toEqual([
      { replaceAllText: { containsText: { text: '{{linkedin.impressions}}', matchCase: true }, replaceText: '2,1M' } },
      { replaceAllText: { containsText: { text: '{{trimestre}}', matchCase: true }, replaceText: 'T2 2026' } },
    ]);
  });
  it('finds leftover markers in shapes, table cells and nested groups with the slide number', () => {
    const presentation = {
      slides: [
        { pageElements: [{ shape: { text: run('Bilan {{trimestre}}') } }] },
        {
          pageElements: [
            { table: { tableRows: [{ tableCells: [{ text: run('ok') }, { text: run('{{facebook.cpm}} et {{facebook.cpe}}') }] }] } },
            { elementGroup: { children: [{ elementGroup: { children: [{ shape: { text: run('{{tiktok.cpv}}') } }] } }] } },
          ],
        },
        { pageElements: [{ shape: { text: { textElements: [{ textRun: { content: '{{linkedin.' } }, { textRun: { content: 'clicks}}' } }] } } }] },
      ],
    };
    expect(leftoverMarkers(presentation)).toEqual([
      { marker: 'trimestre', slide: 1 },
      { marker: 'facebook.cpm', slide: 2 },
      { marker: 'facebook.cpe', slide: 2 },
      { marker: 'tiktok.cpv', slide: 2 },
      { marker: 'linkedin.clicks', slide: 3 },
    ]);
    expect(leftoverMarkers({})).toEqual([]);
  });
  it('asks Google only for text, with nested groups', () => {
    const mask = textFieldMask();
    expect(mask.startsWith('slides(pageElements(')).toBe(true);
    expect(mask).toContain('elementGroup(children(');
    expect(mask).not.toContain('contentUrl');
  });
  it('sends the period and its comparison to the figures endpoint', () => {
    const q = new URLSearchParams(reportQuery({ period: { start: '2026-04-01', end: '2026-06-30' }, comparison: { period: { start: '2024-04-01', end: '2024-06-30' }, label: 'T2 2024' } }));
    expect(Object.fromEntries(q)).toEqual({ start: '2026-04-01', end: '2026-06-30', compare_start: '2024-04-01', compare_end: '2024-06-30', compare_label: 'T2 2024' });
  });
  it('names the file after the period, without characters Drive dislikes', () => {
    expect(reportFileName('T1 2026')).toBe('Bilan Social Media T1 2026');
    expect(reportFileName('septembre 2026')).toBe('Bilan Social Media septembre 2026');
    expect(reportFileName('1er avril / 30 juin: 2026')).toBe('Bilan Social Media 1er avril  30 juin 2026');
  });
  it('measures periods inclusively and flags the ones the endpoint refuses', () => {
    expect(periodLength({ start: '2026-04-01', end: '2026-06-30' })).toBe(91);
    expect(periodLength({ start: '2025-01-01', end: '2026-02-04' })).toBe(400);
    expect(periodLength({ start: '2025-01-01', end: '2026-02-05' })).toBeGreaterThan(MAX_REPORT_DAYS);
  });
  it('explains Google errors in French by reason', () => {
    expect(describeGoogleError(403, 'storageQuotaExceeded', 'x')).toContain('Drive est plein');
    expect(describeGoogleError(403, 'userRateLimitExceeded', 'x')).toContain('limite');
    expect(describeGoogleError(429, undefined, 'x')).toContain('limite');
    expect(describeGoogleError(403, 'domainPolicy', 'x')).toContain('administrateur');
    expect(describeGoogleError(401, undefined, 'x')).toContain('expiré');
    expect(describeGoogleError(500, undefined, 'Erreur 500')).toBe('Erreur 500');
  });
  it('counts the replacements Google reports, zero for a deck without markers', () => {
    expect(countReplacements({ replies: [{ replaceAllText: { occurrencesChanged: 2 } }, { replaceAllText: {} }, { replaceAllText: { occurrencesChanged: 1 } }] })).toBe(3);
    expect(countReplacements({ replies: [{ replaceAllText: {} }, { replaceAllText: {} }] })).toBe(0);
    expect(countReplacements({})).toBe(0);
  });
  it('lists every object id of a deck, groups included, so absent cards can be skipped when colouring', () => {
    const ids = shapeIds({ slides: [{ pageElements: [{ objectId: 'a' }, { objectId: 'g', elementGroup: { children: [{ objectId: 'b' }, { objectId: 'h', elementGroup: { children: [{ objectId: 'c' }] } }] } }] }, { pageElements: [{ objectId: 'd' }] }, {}] });
    expect([...ids].sort()).toEqual(['a', 'b', 'c', 'd', 'g', 'h']);
    expect(shapeIds({}).size).toBe(0);
  });
  it('derives the deck after deleting shapes (groups included) without reading it again, so the leftover check matches a fresh read', () => {
    const deck = {
      slides: [
        { pageElements: [{ objectId: 'a', shape: { text: run('{{image.linkedin.formats}}') } }, { objectId: 'b', shape: { text: run('{{linkedin.followers}}') } }] },
        { pageElements: [{ objectId: 'g', elementGroup: { children: [{ objectId: 'c', shape: { text: run('{{image.tiktok.post-1}}') } }, { objectId: 'd', shape: { text: run('{{tiktok.cpv}}') } }] } }] },
        {},
      ],
    };
    const after = withoutObjects(deck, ['a', 'c']);
    expect([...shapeIds(after)].sort()).toEqual(['b', 'd', 'g']);
    expect(leftoverMarkers(after)).toEqual([{ marker: 'linkedin.followers', slide: 1 }, { marker: 'tiktok.cpv', slide: 2 }]);
    // L'original n'est pas modifié ; seuls les identifiants listés sont retirés (un groupe garde son identifiant tant qu'il n'est pas listé).
    expect([...shapeIds(deck)].sort()).toEqual(['a', 'b', 'c', 'd', 'g']);
    expect(shapeIds(withoutObjects(deck, ['c', 'd'])).has('g')).toBe(true);
    expect(shapeIds(withoutObjects(deck, ['g'])).size).toBe(2);
    expect(withoutObjects({}, ['a'])).toEqual({});
  });
  it('colours only the change in brackets of each card line, green or red like the dashboard', () => {
    const tokens = {
      'linkedin.impressions_vs': 'vs 1,7M (+28%)', 'linkedin.impressions_tone': 'good',
      'linkedin.cpm_vs': 'vs 0,89€ (+25%)', 'linkedin.cpm_tone': 'bad',
      'linkedin.ads_vs': 'vs 11', 'linkedin.ads_tone': 'neutral',
    };
    const out = toneRequests(tokens, [
      { objectId: cardObjectId('linkedin', 'impressions'), prefix: 'linkedin', metric: 'impressions' },
      { objectId: cardObjectId('linkedin', 'cpm'), prefix: 'linkedin', metric: 'cpm' },
      { objectId: cardObjectId('linkedin', 'ads'), prefix: 'linkedin', metric: 'ads' },
      { objectId: cardObjectId('linkedin', 'clicks'), prefix: 'linkedin', metric: 'clicks' },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]?.updateTextStyle).toMatchObject({ objectId: 'kpi_linkedin_impressions_vs', textRange: { startIndex: 'vs 1,7M (+28%)'.indexOf('('), endIndex: 'vs 1,7M (+28%)'.length } });
    const colour = (i: number) => out[i]?.updateTextStyle.style.foregroundColor.opaqueColor.rgbColor ?? { red: 0, green: 0, blue: 0 };
    expect(colour(0).green).toBeGreaterThan(colour(0).red);
    expect(colour(1).red).toBeGreaterThan(colour(1).green);
  });
  it('colours the whole change zone of a YouTube row, and leaves a neutral or missing one alone', () => {
    const placements = [
      { objectId: changeObjectId('youtube', 'spend'), prefix: 'youtube', metric: 'spend', whole: true },
      { objectId: changeObjectId('youtube', 'cpm'), prefix: 'youtube', metric: 'cpm', whole: true },
    ];
    const out = toneRequests({ 'youtube.spend_change': '+33%', 'youtube.spend_tone': 'good' }, placements);
    expect(out).toHaveLength(1);
    expect(out[0]?.updateTextStyle).toMatchObject({ objectId: 'kpi_youtube_spend_change', textRange: { type: 'ALL' } });
    expect(toneRequests({ 'youtube.spend_change': '—', 'youtube.spend_tone': 'neutral' }, placements)).toEqual([]);
  });
});
