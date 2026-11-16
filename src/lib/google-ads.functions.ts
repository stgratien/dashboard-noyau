import { createServerFn } from '@tanstack/react-start';
import { readRange } from './period-input';
export const readGoogleAds = createServerFn({ method: 'GET' })
  .inputValidator((input) => readRange.parse(input))
  .handler(async ({ data }) => {
    const { loadGoogleAds } = await import('./google-ads.server');
    return loadGoogleAds(data);
  });
