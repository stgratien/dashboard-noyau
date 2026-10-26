import { supabaseAdmin as db } from '@/integrations/supabase/client.server';
import type { GoogleAdsRow } from './google-ads';
/** Server-only read: google_ads_daily has no browser grants. */
export async function loadGoogleAds(range: { start: string; end: string }) {
  const rows: GoogleAdsRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await db.from('google_ads_daily').select('day,campaign_id,campaign_name,channel,impressions,clicks,cost,conversions,conversions_value,video_views').gte('day', range.start).lte('day', range.end).order('day').order('campaign_id').range(offset, offset + 999);
    if (r.error) throw new Error('Lecture Google Ads impossible');
    rows.push(...r.data.map(d => ({ ...d, impressions: Number(d.impressions), clicks: Number(d.clicks), cost: Number(d.cost), conversions: Number(d.conversions), conversions_value: Number(d.conversions_value), video_views: d.video_views == null ? null : Number(d.video_views) })));
    if (r.data.length < 1000) break;
  }
  const status = await db.from('social_sync_status').select('last_success_at').eq('source', 'google_ads').maybeSingle();
  return { rows, lastSuccess: status.data?.last_success_at ?? null };
}
