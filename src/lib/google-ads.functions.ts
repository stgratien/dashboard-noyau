import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const readGoogleAds = createServerFn({ method: 'GET' })
  .inputValidator((input) => z.object({ start: day, end: day }).parse(input))
  .handler(async ({ data }) => {
    const { loadGoogleAds } = await import('./google-ads.server');
    return loadGoogleAds(data);
  });
