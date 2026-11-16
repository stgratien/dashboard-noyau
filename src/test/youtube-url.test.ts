import { describe, expect, it } from 'vitest';
import { youtubePayload } from '../lib/youtube';

const base = { channel_id: 'c', snapshot_date: '2026-10-01', subscriber_count: 1, days: [] };
const video = (url: unknown) => ({ ...base, videos: [{ video_id: 'abcdefghijk', published_at: '2026-10-01T00:00:00Z', ...(url === undefined ? {} : { url }) }] });

describe('YouTube ingest: video address', () => {
  it('accepts an https address on youtube.com or youtu.be, or none', () => {
    expect(youtubePayload.safeParse(video('https://www.youtube.com/watch?v=abcdefghijk')).success).toBe(true);
    expect(youtubePayload.safeParse(video('https://youtu.be/abcdefghijk')).success).toBe(true);
    expect(youtubePayload.safeParse(video(null)).success).toBe(true);
    expect(youtubePayload.safeParse(video(undefined)).success).toBe(true);
  });
  it('turns any other scheme, host or value into null instead of rejecting the whole payload', () => {
    for (const url of ['javascript:alert(1)', 'http://www.youtube.com/watch?v=x', 'https://evil.example/watch?v=x', 'https://youtube.com.evil.example/x', 'data:text/html,x', '', 42, 'x'.repeat(600)]) {
      const parsed = youtubePayload.safeParse(video(url));
      expect(parsed.success, String(url).slice(0, 30)).toBe(true);
      expect(parsed.success && parsed.data.videos[0]?.url, String(url).slice(0, 30)).toBeNull();
    }
  });
});
