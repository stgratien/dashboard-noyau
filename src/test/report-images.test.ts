import { describe, it, expect } from 'vitest';
import { googleTokenAllowed, isPng } from '../lib/report-image-auth';
import { imageRequest, imageTag, imageTagShapes } from '../lib/google-report';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const reply = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

describe('report image hosting checks', () => {
  it('accepts only PNG bytes', () => {
    expect(isPng(png)).toBe(true);
    expect(isPng(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0]))).toBe(false);
    expect(isPng(new Uint8Array([0x89, 0x50]))).toBe(false);
  });
  it('lets in only Google tokens issued to the dashboard client with file access', async () => {
    const tok = 'ya29.a0AfH6SMExampleAccessToken_1234567890';
    const info = { aud: 'client-1', scope: 'openid https://www.googleapis.com/auth/drive.file', expires_in: '3000' };
    expect(await googleTokenAllowed(tok, 'client-1', reply(info))).toBe(true);
    expect(await googleTokenAllowed(tok, 'client-2', reply(info))).toBe(false);
    expect(await googleTokenAllowed(tok, 'client-1', reply({ ...info, scope: 'openid' }))).toBe(false);
    expect(await googleTokenAllowed(tok, 'client-1', reply({ ...info, expires_in: 0 }))).toBe(false);
    expect(await googleTokenAllowed(tok, 'client-1', reply({}, false))).toBe(false);
    expect(await googleTokenAllowed('', 'client-1', reply(info))).toBe(false);
    expect(await googleTokenAllowed(tok, 'client-1', (async () => { throw new Error('réseau'); }) as unknown as typeof fetch)).toBe(false);
  });
  it('sends the token to Google in a POST body, never in the address', async () => {
    const tok = 'ya29.a0AfH6SMExampleAccessToken_1234567890';
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const spy = (async (url: string, init?: RequestInit) => { calls.push({ url: String(url), init }); return { ok: true, json: async () => ({ aud: 'c', scope: 'https://www.googleapis.com/auth/drive.file', expires_in: 10 }) }; }) as unknown as typeof fetch;
    expect(await googleTokenAllowed(tok, 'c', spy)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://oauth2.googleapis.com/tokeninfo');
    expect(calls[0]!.url).not.toContain(tok);
    expect(calls[0]!.init?.method).toBe('POST');
    expect(String(calls[0]!.init?.body)).toBe(`access_token=${encodeURIComponent(tok)}`);
  });
  it('refuses a token that does not look like a Google access token without calling Google', async () => {
    let called = 0;
    const spy = (async () => { called++; return { ok: true, json: async () => ({}) }; }) as unknown as typeof fetch;
    for (const bad of ['tok', 'abc.def.ghi', 'ya29.', 'ya29.short', `ya29.${'a'.repeat(2600)}`, 'ya29.valid token with spaces', 'ya29.ok_but_\nnewline_chars']) {
      expect(await googleTokenAllowed(bad, 'c', spy), bad.slice(0, 20)).toBe(false);
    }
    expect(called).toBe(0);
  });
});

describe('image placeholders in the Slides deck', () => {
  it('writes the placeholder text and the replacement request for one block', () => {
    expect(imageTag('linkedin.formats')).toBe('{{image.linkedin.formats}}');
    expect(imageRequest('https://signed.test/a.png', 'linkedin.formats')).toEqual({
      replaceAllShapesWithImage: { imageUrl: 'https://signed.test/a.png', imageReplaceMethod: 'CENTER_INSIDE', containsText: { text: '{{image.linkedin.formats}}', matchCase: true } },
    });
  });
  it('finds the placeholders still empty, including inside groups, and ignores other text', () => {
    const run = (content: string) => ({ textElements: [{ textRun: { content } }] });
    const deck = {
      slides: [
        { pageElements: [
          { objectId: 'a', shape: { text: run('{{image.linkedin.formats}}\n') } },
          { objectId: 'b', shape: { text: run('Texte libre {{image.linkedin.formats}}') } },
          { objectId: 'c', elementGroup: { children: [{ objectId: 'd', shape: { text: run('{{image.tiktok.post-1}}') } }] } },
          { objectId: 'e', shape: { text: run('{{linkedin.followers}}') } },
        ] },
      ],
    };
    expect(imageTagShapes(deck)).toEqual([{ objectId: 'a', tag: '{{image.linkedin.formats}}' }, { objectId: 'd', tag: '{{image.tiktok.post-1}}' }]);
  });
});
