import type { SocialDay } from './social-totals';
import { dayNumber } from './dashboard-periods';

export type ManualOrganicDay = { platform: string; day: string; organic_views: number | null; paid_views?: number | null; organic_impressions?: number | null; organic_video_views?: number | null; organic_likes: number | null; organic_comments: number | null; organic_shares: number | null; posts_published: number | null };
export const ORGANIC_ZERO_RUN_DAYS = 7;
const sources: Record<string, string> = { instagram: 'instagram', facebook: 'facebook_organic', linkedin: 'linkedin_organic' };
const accountFields = ['impressions', 'videoViews', 'likes', 'comments', 'shares'];

/**
 * Normalize provider account zero runs before merging trusted agency exports. TikTok uses video cohorts.
 * `manualFirst` (client.data.manualOrganicFirst, facebook and linkedin only): the manual history of those networks comes BEFORE the provider values for the days it covers;
 * by default it only fills the empty days. A blank manual field never replaces a provider value.
 */
export function mergeOrganicHistory(days: SocialDay[], manual: ManualOrganicDay[], manualFirst: readonly string[] = []): SocialDay[] {
  const result = days.map(d => ({ ...d, metrics: { ...d.metrics } }));
  for (const [platform, source] of Object.entries(sources)) {
    const rows = result.filter(d => d.platform === platform && d.source === source).sort((a,b) => a.day.localeCompare(b.day));
    let run: SocialDay[] = [];
    const flush = () => {
      if (run.length >= ORGANIC_ZERO_RUN_DAYS) for (const row of run) {
        row.metrics['accountOrganicUnavailable'] = 1;
        for (const field of accountFields) if (row.metrics[field] != null && (row.metrics[field] ?? 0) <= 0) row.metrics[field] = null;
      }
      run = [];
    };
    for (const row of rows) {
      const previous = run.at(-1);
      if (previous && dayNumber(row.day) - dayNumber(previous.day) !== 1) flush();
      const impressions = row.metrics['impressions'];
      if (impressions === 0) run.push(row); else flush();
    }
    flush();
  }
  const map = new Map(result.map(d => [`${d.platform}:${d.source}:${d.day}`, d]));
  for (const record of manual) {
    const source = sources[record.platform];
    if (!source) continue;
    const key = `${record.platform}:${source}:${record.day}`;
    const row = map.get(key) ?? { platform: record.platform, source, day: record.day, metrics: {}, followers_estimated: false };
    // Instagram exports one views column; LinkedIn/Facebook export impressions and video views separately. Clicks are never merged.
    const instagram = record.platform === 'instagram';
    // Instagram: when the file fills a day, impressions/views = organic + paid views of the file (Windsor account views already include paid).
    const igTotal = instagram && record.organic_views != null ? record.organic_views + (record.paid_views ?? 0) : null;
    if (instagram && igTotal != null && (row.metrics['impressions'] == null || (row.metrics['impressions'] ?? 0) <= 0)) row.metrics['instagramManualFill'] = 1;
    // Instagram videoViews come from the published-video cohort: the agency export has one views column for all formats.
    const fields = { impressions: instagram ? igTotal : record.organic_impressions ?? null, videoViews: instagram ? null : record.organic_video_views ?? null, likes: record.organic_likes, comments: record.organic_comments, shares: record.organic_shares };
    const first = manualFirst.includes(record.platform);
    for (const [field, value] of Object.entries(fields)) {
      if (value == null || !(first || row.metrics[field] == null || (row.metrics[field] ?? 0) <= 0)) continue;
      row.metrics[field] = value;
      // Facebook : le connecteur donne les totaux à vie des publications (promotion comprise), l'export les réactions organiques du jour : realBlendedTotals ajoute les actions Meta Ads aux seuls jours repris de l'export.
      if (record.platform === 'facebook' && (field === 'likes' || field === 'comments')) row.metrics[field === 'likes' ? 'manualLikes' : 'manualComments'] = 1;
    }
    if (record.posts_published != null) { row.metrics['manualPostsPublished'] = record.posts_published; row.metrics['postsAvailable'] = 1; }
    // Explicit manual zero values are known values, not provider-retention sentinels.
    row.metrics['manualOrganicHistory'] = 1;
    map.set(key, row);
  }
  return [...map.values()];
}