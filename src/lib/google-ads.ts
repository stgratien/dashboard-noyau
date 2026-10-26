import { z } from 'zod';
import type { Period } from './dashboard-periods';

/** Google Ads ingestion contract (nightly Google Ads Script → /api/public/google-ads-ingest). */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d => { const t = new Date(`${d}T00:00:00Z`); return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d; }, 'Date invalide');
const count = z.number().finite().min(0);
export const GOOGLE_ADS_MAX_ROWS = 2000;
export const googleAdsPayload = z.object({
  account_id: z.string().trim().min(1).max(64),
  rows: z.array(z.object({
    date: isoDate, campaign_id: z.string().trim().min(1).max(64), campaign_name: z.string().max(500).default(''),
    channel: z.string().trim().min(1).max(64).regex(/^[A-Z_]+$/),
    impressions: count, clicks: count, cost: count, conversions: count, conversions_value: count,
    video_views: count.nullable().optional(),
  }).strict()).min(1).max(GOOGLE_ADS_MAX_ROWS),
}).strict();
export type GoogleAdsPayload = z.infer<typeof googleAdsPayload>;
export type GoogleAdsRow = { day: string; campaign_id: string; campaign_name: string; channel: string; impressions: number; clicks: number; cost: number; conversions: number; conversions_value: number; video_views: number | null };

/** Rows keyed by date + campaign; a repeated key in one call keeps the last value. */
export function toDbRows(p: GoogleAdsPayload, now = new Date().toISOString()) {
  const m = new Map<string, GoogleAdsRow & { account_id: string; synced_at: string }>();
  for (const r of p.rows) m.set(`${r.date}|${r.campaign_id}`, { day: r.date, campaign_id: r.campaign_id, account_id: p.account_id, campaign_name: r.campaign_name, channel: r.channel, impressions: r.impressions, clicks: r.clicks, cost: r.cost, conversions: r.conversions, conversions_value: r.conversions_value, video_views: r.video_views ?? null, synced_at: now });
  return [...m.values()];
}

export const GOOGLE_ADS_STALE_HOURS = 48;
export const googleAdsStale = (lastSuccess: string | null | undefined, now = Date.now()) => !lastSuccess || now - new Date(lastSuccess).getTime() > GOOGLE_ADS_STALE_HOURS * 3600_000;

export const CHANNEL_LABELS: Record<string, string> = { SEARCH: 'Search', PERFORMANCE_MAX: 'Performance Max', VIDEO: 'Vidéo', DISPLAY: 'Display', DEMAND_GEN: 'Demand Gen', SHOPPING: 'Shopping', DISCOVERY: 'Demand Gen', MULTI_CHANNEL: 'App', SMART: 'Smart', LOCAL: 'Local' };
export const channelLabel = (c: string) => CHANNEL_LABELS[c] ?? 'Autre';

const inPeriod = (rows: GoogleAdsRow[], p: Period) => rows.filter(r => r.day >= p.start && r.day <= p.end);
const ratio = (a: number, b: number, k = 1) => b > 0 ? a / b * k : null;
export function googleAdsTotals(all: GoogleAdsRow[], p: Period) {
  const rows = inPeriod(all, p);
  const sum = (k: 'impressions' | 'clicks' | 'cost' | 'conversions') => rows.reduce((s, r) => s + r[k], 0);
  const spend = sum('cost'), impressions = sum('impressions'), clicks = sum('clicks'), conversions = sum('conversions');
  const videoRows = rows.filter(r => r.video_views != null);
  return { hasData: rows.length > 0, spend, impressions, clicks, conversions,
    ctr: ratio(clicks, impressions, 100), cpc: ratio(spend, clicks), cpm: ratio(spend, impressions, 1000), costPerConversion: ratio(spend, conversions),
    videoViews: videoRows.length ? videoRows.reduce((s, r) => s + (r.video_views ?? 0), 0) : null };
}
export type GoogleAdsTotals = ReturnType<typeof googleAdsTotals>;

/** Daily series; weekly buckets (Monday start) when the period exceeds 90 days. */
export function googleAdsSeries(all: GoogleAdsRow[], p: Period) {
  const days = (Date.parse(`${p.end}T00:00:00Z`) - Date.parse(`${p.start}T00:00:00Z`)) / 86400000 + 1;
  const weekly = days > 90;
  const key = (d: string) => { if (!weekly) return d; const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() - (t.getUTCDay() + 6) % 7); return t.toISOString().slice(0, 10); };
  const m = new Map<string, { date: string; spend: number; clicks: number }>();
  for (const r of inPeriod(all, p)) { const k = key(r.day), o = m.get(k) ?? { date: k, spend: 0, clicks: 0 }; o.spend += r.cost; o.clicks += r.clicks; m.set(k, o); }
  return { weekly, points: [...m.values()].sort((a, b) => a.date.localeCompare(b.date)) };
}
export function googleAdsByChannel(all: GoogleAdsRow[], p: Period) {
  const m = new Map<string, number>();
  for (const r of inPeriod(all, p)) m.set(channelLabel(r.channel), (m.get(channelLabel(r.channel)) ?? 0) + r.cost);
  return [...m].map(([name, value]) => ({ name, value })).filter(x => x.value > 0).sort((a, b) => b.value - a.value);
}
/**
 * Budget YouTube du rapport (diapositive 51) : coût des campagnes dont le nom contient « YouTube » (casse ignorée), quel que soit leur type.
 * null = aucune ligne Google Ads sur la période (donnée absente, jamais un budget nul présumé) ; 0 = des campagnes, mais aucune « YouTube ».
 */
export const YOUTUBE_CAMPAIGN_NAME = /youtube/i;
export function youtubeCampaignSpend(all: GoogleAdsRow[], p: Period): number | null {
  const rows = inPeriod(all, p);
  return rows.length ? rows.filter(r => YOUTUBE_CAMPAIGN_NAME.test(r.campaign_name)).reduce((s, r) => s + r.cost, 0) : null;
}
export function googleAdsCampaigns(all: GoogleAdsRow[], p: Period) {
  const m = new Map<string, { id: string; name: string; type: string; spend: number; impressions: number; clicks: number; conversions: number; last: string }>();
  for (const r of inPeriod(all, p)) {
    const o = m.get(r.campaign_id) ?? { id: r.campaign_id, name: r.campaign_name, type: channelLabel(r.channel), spend: 0, impressions: 0, clicks: 0, conversions: 0, last: '' };
    o.spend += r.cost; o.impressions += r.impressions; o.clicks += r.clicks; o.conversions += r.conversions;
    if (r.day >= o.last) { o.last = r.day; o.name = r.campaign_name || o.name; o.type = channelLabel(r.channel); }
    m.set(r.campaign_id, o);
  }
  return [...m.values()].map(c => ({ ...c, ctr: ratio(c.clicks, c.impressions, 100), cpc: ratio(c.spend, c.clicks), costPerConversion: ratio(c.spend, c.conversions) })).sort((a, b) => b.spend - a.spend);
}
