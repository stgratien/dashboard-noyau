import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { readRange } from './period-input';
export const readSocialData = createServerFn({ method: 'GET' })
  .inputValidator((input) => z.object({ period: readRange, comparison: readRange, fresh: z.boolean().optional() }).parse(input))
  .handler(async ({ data }) => {
    const { loadSocialData } = await import('./social-data.server');
    return loadSocialData(data);
  });
