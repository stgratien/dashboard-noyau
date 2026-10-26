import { z } from 'zod';
import type { Period } from './dashboard-periods';
import type { GoogleAdsRow } from './google-ads';

/** YouTube ingestion contract (nightly Google Apps Script → /api/public/youtube-ingest). */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d => { const t = new Date(`${d}T00:00:00Z`); return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d; }, 'Date invalide');
const n = z.number().finite().min(0);
const nn = n.nullable().optional();
export const YOUTUBE_MAX_DAYS = 400, YOUTUBE_MAX_VIDEOS = 150;
export const youtubePayload = z.object({
  channel_id: z.string().trim().min(1).max(64), channel_title: z.string().max(300).default(''),
  snapshot_date: isoDate, subscriber_count: n, video_count: nn,
  days: z.array(z.object({ date: isoDate, views: nn, minutes_watched: nn, avg_view_duration_s: nn, subscribers_gained: nn, subscribers_lost: nn, likes: nn, comments: nn, shares: nn }).strict()).max(YOUTUBE_MAX_DAYS),
  videos: z.array(z.object({ video_id: z.string().trim().min(1).max(64), published_at: z.string().datetime({ offset: true }), title: z.string().max(500).default(''), url: z.string().url().max(500).nullable().optional(), thumbnail_url: z.string().url().max(1000).nullable().optional(), duration: z.string().max(40).nullable().optional(), views: nn, likes: nn, comments: nn }).strict()).max(YOUTUBE_MAX_VIDEOS),
}).strict();
export type YoutubePayload = z.infer<typeof youtubePayload>;

export type YtDay = { day: string; views: number | null; minutes_watched: number | null; avg_view_duration_s: number | null; subscribers_gained: number | null; subscribers_lost: number | null; likes: number | null; comments: number | null; shares: number | null };
export type YtVideo = { video_id: string; published_at: string; title: string; url: string | null; thumbnail_url?: string; views: number | null; likes: number | null; comments: number | null };
export type YtSnapshot = { day: string; subscriber_count: number };
export type YoutubeData = { days: YtDay[]; videos: YtVideo[]; snapshots: YtSnapshot[]; lastSuccess: string | null };

const PAID_VIDEO_CHANNELS = ['VIDEO', 'DEMAND_GEN'];
const sumN = (xs: (number | null)[]) => xs.some(x => x != null) ? xs.reduce<number>((s, x) => s + (x ?? 0), 0) : null;
const ratio = (a: number | null, b: number | null, k = 1) => a == null || b == null || b <= 0 ? null : a / b * k;
const prevDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

/** Subscribers at end of `date`: latest snapshot ≤ date, else the next snapshot minus net daily gains after `date` (estimated). */
export function youtubeSubscribersAt(data: Pick<YoutubeData, 'days' | 'snapshots'>, date: string): { value: number | null; estimated: boolean } {
  const snaps = [...data.snapshots].sort((a, b) => a.day.localeCompare(b.day));
  const before = snaps.filter(s => s.day <= date).at(-1);
  if (before) return { value: before.subscriber_count, estimated: false };
  const after = snaps.find(s => s.day > date);
  if (!after) return { value: null, estimated: false };
  const between = data.days.filter(d => d.day > date && d.day <= after.day);
  const expected = (Date.parse(`${after.day}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000;
  if (between.length < expected || between.some(d => d.subscribers_gained == null || d.subscribers_lost == null)) return { value: null, estimated: false };
  return { value: after.subscriber_count - between.reduce((s, d) => s + (d.subscribers_gained ?? 0) - (d.subscribers_lost ?? 0), 0), estimated: true };
}

export function youtubeTotals(data: YoutubeData, google: GoogleAdsRow[], p: Period) {
  const days = data.days.filter(d => d.day >= p.start && d.day <= p.end);
  const paid = google.filter(r => r.day >= p.start && r.day <= p.end && PAID_VIDEO_CHANNELS.includes(r.channel));
  const videos = data.videos.filter(v => v.published_at.slice(0, 10) >= p.start && v.published_at.slice(0, 10) <= p.end);
  const end = youtubeSubscribersAt(data, p.end), start = youtubeSubscribersAt(data, prevDay(p.start));
  const organicViews = sumN(days.map(d => d.views));
  const paidViews = paid.length ? sumN(paid.map(r => r.video_views)) : null;
  const views = organicViews == null && paidViews == null ? null : (organicViews ?? 0) + (paidViews ?? 0);
  const minutes = sumN(days.map(d => d.minutes_watched));
  const weighted = days.filter(d => d.avg_view_duration_s != null && d.views != null && d.views > 0);
  const avgDuration = weighted.length ? weighted.reduce((s, d) => s + d.avg_view_duration_s! * d.views!, 0) / weighted.reduce((s, d) => s + d.views!, 0) : null;
  const likes = sumN(days.map(d => d.likes)), comments = sumN(days.map(d => d.comments)), shares = sumN(days.map(d => d.shares));
  const interactions = likes == null || comments == null || shares == null ? null : likes + comments + shares;
  const spend = paid.length ? paid.reduce((s, r) => s + r.cost, 0) : null;
  const paidImpressions = paid.length ? paid.reduce((s, r) => s + r.impressions, 0) : null;
  const net = days.length && days.every(d => d.subscribers_gained != null && d.subscribers_lost != null) ? days.reduce((s, d) => s + d.subscribers_gained! - d.subscribers_lost!, 0) : null;
  return {
    hasData: days.length > 0 || data.snapshots.length > 0,
    followers: end.value, estimated: end.estimated, newFollowers: net,
    followerGrowth: end.value != null && start.value != null ? end.value - start.value : null,
    followerGrowthPercent: end.value != null && start.value ? (end.value - start.value) / start.value * 100 : null,
    videos: videos.length, organicViews, paidViews, views, watchHours: minutes == null ? null : minutes / 60, avgDuration,
    paidImpressions, likes, comments, shares, interactions, engagementRate: ratio(interactions, views, 100),
    spend, cpv: ratio(spend, paidViews), cpm: ratio(spend, paidImpressions, 1000),
  };
}
export type YoutubeTotals = ReturnType<typeof youtubeTotals>;

/** Month-end subscribers from January of the period's end year to its end month; the unfinished month takes the value at the period end (never a future date), like the social tabs. */
export function youtubeAudienceMonths(data: YoutubeData, p: Period) {
  const out: { month: string; followers: number | null }[] = [];
  const end = new Date(`${p.end}T00:00:00Z`);
  // De janvier de l'année de fin de période jusqu'au mois de fin.
  for (let i = 0; i <= end.getUTCMonth(); i++) {
    const m = new Date(Date.UTC(end.getUTCFullYear(), i + 1, 0));
    const d = m.toISOString().slice(0, 10) > p.end ? p.end : m.toISOString().slice(0, 10);
    out.push({ month: m.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit', timeZone: 'UTC' }), followers: youtubeSubscribersAt(data, d).value });
  }
  return out;
}

/** Google Ads rows carry no video id, so no video can be linked to a campaign: every video is "Organique". */
export const youtubeVideoType = (_v: YtVideo) => 'Organique' as const;

type SocialLike = { followers: number | null; followerGrowth: number | null; followerGrowthPercent: number | null; posts: number | null; videos: number | null; videoViews: number | null; interactions: number | null; missing: Record<string, string[]> };
/**
 * "Tous réseaux" with YouTube organic added to subscribers, published posts/videos, video views and interactions only.
 * Budget and impressions are untouched (YouTube spend already sits in the Google Ads row; no organic impressions exist).
 */
export function addYoutubeToSocial<T extends SocialLike>(t: T, y: YoutubeTotals | null, unavailable = false): T {
  // YouTube not connected (no successful send yet): leave the totals untouched, never flag it as a missing network.
  // Connected but not readable right now (period loading, read failure): totals without YouTube, flagged partial.
  if (y == null) {
    if (!unavailable) return t;
    const missing = { ...t.missing };
    for (const key of ['followers', 'posts', 'videoViews', 'interactions']) missing[key] = [...(missing[key] ?? []), 'YouTube'];
    return { ...t, missing };
  }
  const missing = { ...t.missing };
  const add = (key: string, a: number | null, b: number | null | undefined) => {
    if (b == null) { missing[key] = [...(missing[key] ?? []), 'YouTube']; return a; }
    return a == null ? b : a + b;
  };
  const followers = add('followers', t.followers, y?.followers);
  const growth = y?.followerGrowth == null || t.followerGrowth == null ? t.followerGrowth : t.followerGrowth + y.followerGrowth;
  const startBase = followers != null && growth != null ? followers - growth : null;
  return { ...t, missing, followers, followerGrowth: growth,
    followerGrowthPercent: startBase ? growth! / startBase * 100 : t.followerGrowthPercent,
    posts: add('posts', t.posts, y?.hasData ? y.videos : null),
    videos: t.videos == null ? null : t.videos + (y?.videos ?? 0),
    videoViews: add('videoViews', t.videoViews, y?.organicViews),
    interactions: add('interactions', t.interactions, y?.interactions) };
}
