import { supabaseAdmin as db } from '@/integrations/supabase/client.server';
import { THUMBNAIL_BUCKET } from './windsor-config';
import type { YoutubePayload, YoutubeData } from './youtube';

const num = (v: unknown) => v == null ? null : Number(v);
/** Server-only read of YouTube tables (no browser grants); thumbnails as short-lived signed URLs. */
export async function loadYoutube(range: { start: string; end: string }): Promise<YoutubeData> {
  const [days, snaps, videos, status] = await Promise.all([
    db.from('youtube_daily').select('*').order('day').limit(5000),
    db.from('youtube_subscriber_snapshots').select('day,subscriber_count').order('day').limit(5000),
    db.from('youtube_videos').select('video_id,published_at,title,url,thumbnail_path,views,likes,comments').gte('published_at', `${range.start}T00:00:00Z`).lte('published_at', `${range.end}T23:59:59.999Z`).order('published_at').limit(2000),
    db.from('social_sync_status').select('last_success_at').eq('source', 'youtube').maybeSingle(),
  ]);
  if (days.error || snaps.error || videos.error) throw new Error('Lecture YouTube impossible');
  const paths = videos.data.map(v => v.thumbnail_path).filter((p): p is string => Boolean(p));
  const signed = paths.length ? await db.storage.from(THUMBNAIL_BUCKET).createSignedUrls(paths, 3600) : null;
  const urls = new Map(signed?.data?.map(s => [s.path, s.signedUrl]) ?? []);
  return {
    days: days.data.map(d => ({ day: d.day, views: num(d.views), minutes_watched: num(d.minutes_watched), avg_view_duration_s: num(d.avg_view_duration_s), subscribers_gained: num(d.subscribers_gained), subscribers_lost: num(d.subscribers_lost), likes: num(d.likes), comments: num(d.comments), shares: num(d.shares) })),
    snapshots: snaps.data.map(s => ({ day: s.day, subscriber_count: Number(s.subscriber_count) })),
    videos: videos.data.map(v => ({ video_id: v.video_id, published_at: v.published_at, title: v.title, url: v.url, thumbnail_url: urls.get(v.thumbnail_path ?? '') ?? '', views: num(v.views), likes: num(v.likes), comments: num(v.comments) })),
    lastSuccess: status.data?.last_success_at ?? null,
  };
}

async function storeThumbnail(videoId: string, remote: string | null | undefined) {
  if (!remote) return null;
  let url: URL; try { url = new URL(remote); } catch { return null; }
  if (url.protocol !== 'https:' || !['ytimg.com', 'ggpht.com', 'googleusercontent.com'].some(h => url.hostname === h || url.hostname.endsWith(`.${h}`))) return null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: 'error' });
    const type = r.headers.get('content-type') ?? '';
    if (!r.ok || !type.startsWith('image/')) return null;
    const data = await r.arrayBuffer();
    if (data.byteLength > 10_000_000) return null;
    const path = `youtube/${encodeURIComponent(videoId)}.image`;
    const saved = await db.storage.from(THUMBNAIL_BUCKET).upload(path, data, { contentType: type, upsert: true });
    return saved.error ? null : path;
  } catch { return null; }
}

export async function ingestYoutube(p: YoutubePayload) {
  const now = new Date().toISOString();
  const days = [...new Map(p.days.map(d => [d.date, { day: d.date, channel_id: p.channel_id, views: d.views ?? null, minutes_watched: d.minutes_watched ?? null, avg_view_duration_s: d.avg_view_duration_s ?? null, subscribers_gained: d.subscribers_gained ?? null, subscribers_lost: d.subscribers_lost ?? null, likes: d.likes ?? null, comments: d.comments ?? null, shares: d.shares ?? null, synced_at: now }])).values()];
  if (days.length) { const r = await db.from('youtube_daily').upsert(days); if (r.error) throw new Error('days'); }
  const snap = await db.from('youtube_subscriber_snapshots').upsert({ day: p.snapshot_date, channel_id: p.channel_id, subscriber_count: p.subscriber_count, video_count: p.video_count ?? null, synced_at: now });
  if (snap.error) throw new Error('snapshot');
  const ids = p.videos.map(v => v.video_id);
  const existing = ids.length ? await db.from('youtube_videos').select('video_id,thumbnail_path').in('video_id', ids) : { data: [] as { video_id: string; thumbnail_path: string | null }[] };
  const known = new Map((existing.data ?? []).map(v => [v.video_id, v.thumbnail_path]));
  const videos = [];
  for (const v of new Map(p.videos.map(v => [v.video_id, v])).values()) {
    const thumbnail_path = known.get(v.video_id) ?? await storeThumbnail(v.video_id, v.thumbnail_url);
    videos.push({ video_id: v.video_id, channel_id: p.channel_id, published_at: v.published_at, title: v.title, url: v.url ?? null, thumbnail_path, duration: v.duration ?? null, views: v.views ?? null, likes: v.likes ?? null, comments: v.comments ?? null, synced_at: now });
  }
  if (videos.length) { const r = await db.from('youtube_videos').upsert(videos); if (r.error) throw new Error('videos'); }
  await db.from('social_sync_status').upsert({ source: 'youtube', last_attempt_at: now, last_success_at: now, state: 'ok', message: null });
  return { days: days.length, videos: videos.length };
}
export async function markYoutubeFailure() {
  await db.from('social_sync_status').upsert({ source: 'youtube', last_attempt_at: new Date().toISOString(), state: 'error', message: 'Enregistrement YouTube impossible' });
}
