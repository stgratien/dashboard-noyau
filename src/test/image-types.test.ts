import { describe, expect, it } from 'vitest';
import { allowedImageType } from '../lib/image-types';

describe('allowedImageType', () => {
  it('accepts the usual photo formats, ignoring case and parameters', () => {
    expect(allowedImageType('image/jpeg')).toBe('image/jpeg');
    expect(allowedImageType('IMAGE/PNG; charset=binary')).toBe('image/png');
    expect(allowedImageType('image/webp')).toBe('image/webp');
    expect(allowedImageType('image/jpg')).toBe('image/jpeg');
    expect(allowedImageType('image/pjpeg')).toBe('image/jpeg');
  });
  it('refuses SVG, other image types, other content and nothing at all', () => {
    for (const type of ['image/svg+xml', 'image/x-icon', 'image/*', 'text/html', 'application/octet-stream', '', null, undefined]) expect(allowedImageType(type as string | null | undefined), String(type)).toBeNull();
  });
});
