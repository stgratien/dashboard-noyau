import { createServerFn } from '@tanstack/react-start';
import { readRange } from './period-input';
export const readYoutube = createServerFn({ method: 'GET' })
  .inputValidator((input) => readRange.parse(input))
  .handler(async ({ data }) => {
    const { loadYoutube } = await import('./youtube.server');
    return loadYoutube(data);
  });
