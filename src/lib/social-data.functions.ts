import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
const period = z.object({ start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
export const readSocialData = createServerFn({ method: 'GET' })
  .inputValidator((input) => z.object({ period, comparison: period, fresh: z.boolean().optional() }).parse(input))
  .handler(async ({ data }) => {
    const { loadSocialData } = await import('./social-data.server');
    return loadSocialData(data);
  });
