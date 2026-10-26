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
    const info = { aud: 'client-1', scope: 'openid https://www.googleapis.com/auth/drive.file', expires_in: '3000' };
    expect(await googleTokenAllowed('tok', 'client-1', reply(info))).toBe(true);
    expect(await googleTokenAllowed('tok', 'client-2', reply(info))).toBe(false);
    expect(await googleTokenAllowed('tok', 'client-1', reply({ ...info, scope: 'openid' }))).toBe(false);
    expect(await googleTokenAllowed('tok', 'client-1', reply({ ...info, expires_in: 0 }))).toBe(false);
    expect(await googleTokenAllowed('tok', 'client-1', reply({}, false))).toBe(false);
    expect(await googleTokenAllowed('', 'client-1', reply(info))).toBe(false);
    expect(await googleTokenAllowed('tok', 'client-1', (async () => { throw new Error('réseau'); }) as unknown as typeof fetch)).toBe(false);
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
