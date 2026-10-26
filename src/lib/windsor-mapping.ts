import type { PlatformId } from "@/lib/dashboard-data";
import type { WindsorSource } from "@/lib/windsor-config";
import { SOURCE_PLATFORMS } from "@/core/client-config";
export type RawRow = Record<string, unknown>;
export type Metrics = Record<string, number | null>;
export const numberValue = (v: unknown): number | null => v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
const n = (row: RawRow, field: string) => numberValue(row[field]);
export const nullableSum = (values: (number | null | undefined)[]): number | null => values.some((v) => v == null) ? null : values.reduce<number>((a, v) => a + (v ?? 0), 0);
export { SOURCE_PLATFORMS };
export function paidMetrics(source: WindsorSource, row: RawRow): Metrics {
  const meta = source === "facebook";
  return {
    spend: n(row, "spend"), impressions: n(row, "impressions"),
    videoViews: n(row, meta ? "actions_video_view" : source === "tiktok" ? "play_duration_2s" : "video_views"),
    likes: n(row, meta ? "actions_post_reaction" : "likes"), comments: n(row, meta ? "actions_comment" : "comments"),
    shares: n(row, meta ? "actions_post" : "shares"),
    linkClicks: n(row, meta ? "outbound_clicks_outbound_click" : source === "linkedin" ? "landing_page_clicks" : "clicks"),
  };
}
export function organicMetrics(source: WindsorSource, row: RawRow): Metrics {
  if (source === "facebook_organic") return { followers: n(row, "page_follows"), newFollowers: n(row, "page_daily_follows_unique"), impressions: n(row, "page_impressions_organic"), videoViews: n(row, "page_video_views_organic") };
  if (source === "instagram") return { followers: n(row, "followers_count"), newFollowers: n(row, "follower_count_1d"), impressions: n(row, "views"), likes: n(row, "likes"), comments: n(row, "comments"), shares: n(row, "shares"), linkClicks: 0 };
  if (source === "tiktok_organic") return { followers: n(row, "total_followers_count"), newFollowers: n(row, "daily_total_followers"), impressions: n(row, "video_views"), videoViews: n(row, "video_views"), likes: n(row, "likes"), comments: n(row, "comments"), shares: n(row, "shares"), linkClicks: n(row, "bio_link_clicks") };
  return { followers: n(row, "organization_follower_count"), newFollowers: nullableSum([n(row, "followers_gain_organic"), n(row, "followers_gain_paid")]), impressions: n(row, "account_analytics_impression_count"), likes: n(row, "account_analytics_like_count"), comments: n(row, "account_analytics_comment_count"), shares: n(row, "account_analytics_share_count"), linkClicks: 0 };
}
// Windsor renvoie REELS (et non VIDEO/REEL) pour les reels Instagram ; LinkedIn et Facebook utilisent la même liste.
const VIDEO_TYPES = ["VIDEO", "REEL", "REELS"];
export const isVideoType = (type: string) => VIDEO_TYPES.includes(type.toUpperCase());
/** Formats de publication comptés comme vidéos dans les totaux. */
export const VIDEO_FORMATS = ["Vidéo", "Reel", "VIDEO", "Vidéo / Reel"];
const POST_FIELDS = {
  facebook_organic: ["post_id", "post_created_time", "post_message", "permalink_url", "full_picture", "post_impressions", "post_reactions_total", "post_comments_total", "post_activity_by_action_type_share"],
  instagram: ["media_id", "timestamp", "media_caption", "media_permalink", "media_url", "media_views", "media_like_count", "media_comments_count", "media_shares"],
  tiktok_organic: ["video_id", "video_create_datetime", "video_caption", "video_share_url", "video_thumbnail_url", "video_views_count", "video_likes", "video_comments", "video_shares"],
  linkedin_organic: ["share_id", "share_published_time", "share_text", "share_url", "share_image_url", "share_impression_count", "share_like_count", "share_comment_count", "share_count"],
} as const;
export function mapPost(source: WindsorSource, row: RawRow) {
  if (!(source in POST_FIELDS)) return null;
  const f = POST_FIELDS[source as keyof typeof POST_FIELDS];
  const id = String(row[f[0]] ?? "");
  const rawDate = row[f[1]];
  const date = new Date(typeof rawDate === "number" ? rawDate * 1000 : String(rawDate ?? ""));
  if (!id || !Number.isFinite(date.getTime())) return null;
  const type = String(row['media_type'] ?? row['share_post_type'] ?? row['post_type'] ?? "").toUpperCase();
  const permalink = String(row[f[3]] ?? "");
  // Facebook : Windsor renvoie photo / album / video_inline / video_direct_response ; vidéos et reels ont un permalien /videos/ ou /reel/.
  const facebookVideo = source === "facebook_organic" && (type.startsWith("VIDEO") || /\/(reel|videos)\//.test(permalink));
  const format = source === "tiktok_organic" || facebookVideo || isVideoType(type) ? "Vidéo" : ['CAROUSEL_ALBUM','ALBUM','CAROUSEL','MULTI_IMAGE','MULTIIMAGE'].includes(type) ? 'Carrousel / Album' : ['IMAGE','PHOTO'].includes(type) ? 'Photo' : ['DOCUMENT','PDF'].includes(type) ? 'Document' : type ? 'Autre' : 'Post';
  return {
    platform: SOURCE_PLATFORMS[source][0] ?? "facebook", post_id: id, published_at: date.toISOString(),
    title: String(row[f[2]] ?? "Publication"), format,
    // LinkedIn : share_image_url est vide pour les vidéos et articles, dont la couverture est dans share_thumbnail.
    permalink, remoteThumbnail: String(row['media_thumbnail_url'] || row[f[4]] || row['share_thumbnail'] || ""),
    // Toutes les adresses d'image fournies, dans l'ordre : la synchronisation essaie la suivante quand l'une ne se télécharge pas.
    remoteThumbnails: [...new Set([row['media_thumbnail_url'], row[f[4]], row['share_thumbnail']].map((v) => String(v ?? "")).filter(Boolean))],
    metrics: { impressions: n(row, f[5]), likes: n(row, f[6]), comments: n(row, f[7]), shares: n(row, f[8]),
      videoViews: source === "instagram" && isVideoType(type) ? n(row, "media_views") : source === "linkedin_organic" ? n(row, "share_video_views") : 0,
      linkClicks: source === "facebook_organic" ? n(row, "post_clicks_by_type_link_clicks") : 0 },
  };
}
/** Un découpage d'audience demandé à Windsor ; `extra` : champs à joindre pour que le connecteur accepte la requête. */
export type AudienceSpec = { dimension: string; label: string; value: string; unit: "count" | "percent"; extra?: string[] };
export const AUDIENCE_SPECS: Partial<Record<WindsorSource, AudienceSpec[]>> = {
  instagram: [{ dimension: "genderAge", label: "audience_gender_age_name", value: "audience_gender_age_size", unit: "count" }, { dimension: "country", label: "audience_country_name", value: "audience_country_size", unit: "count" }, { dimension: "city", label: "city", value: "audience_city_size", unit: "count" }],
  tiktok_organic: [{ dimension: "gender", label: "audience_genders_gender", value: "audience_genders_percentage", unit: "percent" }, { dimension: "age", label: "audience_ages_age", value: "audience_ages_percentage", unit: "percent" }, { dimension: "country", label: "audience_countries_country", value: "audience_countries_percentage", unit: "percent" }],
  linkedin_organic: [{ dimension: "industry", label: "industry_follower_type", value: "industry_follower_counts", unit: "count" }, { dimension: "function", label: "function_follower_type", value: "function_follower_counts", unit: "count" }, { dimension: "seniority", label: "seniority_follower_type", value: "seniority_follower_counts", unit: "count" }, { dimension: "country", label: "country_follower_name", value: "country_follower_counts", unit: "count" }],
  // Facebook : les champs « page_fans_* » n'existent que par jour (date) et avec « page_fans_likes ». Le sexe et l'âge ne sont pas fournis par ce compte.
  facebook_organic: [
    { dimension: "country", label: "page_fans_country_name", value: "page_fans_country_value", unit: "count", extra: ["date", "page_fans_likes"] },
    { dimension: "city", label: "page_fans_city_name", value: "page_fans_city_value", unit: "count", extra: ["date", "page_fans_likes"] },
  ],
};

/** Champs à demander à Windsor pour un découpage. */
export const audienceFields = (spec: AudienceSpec) => [...(spec.extra ?? []), spec.label, spec.value].join(",");

/**
 * Valeurs d'un découpage d'audience. Quand les lignes sont datées, seul le jour le plus récent qui contient des valeurs
 * est retenu : les jours se cumuleraient sinon (même ville comptée une fois par jour).
 */
export function audienceValues(spec: AudienceSpec, rows: RawRow[]): Map<string, number> {
  const dated = rows.filter((r) => r["date"] != null && String(r["date"]).length >= 10 && String(r[spec.label] ?? "").trim() && numberValue(r[spec.value]) != null);
  const latest = dated.reduce((m, r) => { const d = String(r["date"]).slice(0, 10); return d > m ? d : m; }, "");
  const values = new Map<string, number>();
  for (const row of rows) {
    if (latest && (row["date"] == null || String(row["date"]).slice(0, 10) !== latest)) continue;
    const label = String(row[spec.label] ?? "").trim(), value = numberValue(row[spec.value]);
    if (label && value != null) values.set(label, spec.unit === "percent" ? value * 100 : value);
  }
  return values;
}

/**
 * Publication visée par une annonce : plateforme de la PUBLICATION (pas du placement) et identifiant.
 * Meta : « source_instagram_media_id » est l'identifiant de la publication Instagram d'origine d'une annonce créée à partir d'elle ;
 * sinon l'identifiant de la publication de page (Facebook), quel que soit le placement. Sans l'un ni l'autre, repli sur le média de la copie publicitaire.
 */
export function postRefFromAd(source: WindsorSource, placement: string, row: RawRow): { platform: string; post_id: string } {
  const text = (v: unknown) => (v == null ? "" : String(v).trim());
  if (source === "facebook") {
    const instagram = text(row["source_instagram_media_id"]);
    if (instagram) return { platform: "instagram", post_id: instagram };
    const story = text(row["effective_object_story_id"]);
    if (story) return { platform: "facebook", post_id: story };
    return { platform: placement, post_id: placement === "instagram" ? text(row["effective_instagram_media__id"]) : "" };
  }
  const id = text(source === "tiktok" ? row["item_id"] : row["share_id"]);
  return { platform: placement, post_id: source === "linkedin" ? id.replace(/^urn:li:(share|ugcPost):/, "") : id };
}
/** Identifiant seul de la publication visée (compatibilité). */
export const postIdFromAd = (source: WindsorSource, placement: string, row: RawRow) => postRefFromAd(source, placement, row).post_id;


/**
 * Stories Instagram (connecteur « instagram » de Windsor). Instagram ne les fournit que pendant leurs 24 h de vie.
 * `story_views` remplace `story_impressions` (abandonné par Meta) ; la liste réduite sert si Windsor refuse un des autres champs.
 */
export const STORY_FIELDS = ["story_id", "story_timestamp", "story_views", "story_reach", "story_replies", "story_shares", "story_interactions"] as const;
export const STORY_CORE_FIELDS = ["story_id", "story_timestamp", "story_views"] as const;
export type MappedStory = {
  story_id: string; published_at: string;
  views: number | null; reach: number | null; replies: number | null; shares: number | null; interactions: number | null;
};
export function mapStory(row: RawRow): MappedStory | null {
  const id = String(row["story_id"] ?? "").trim();
  const rawDate = row["story_timestamp"];
  const date = new Date(typeof rawDate === "number" ? rawDate * 1000 : String(rawDate ?? ""));
  if (!id || !Number.isFinite(date.getTime())) return null;
  return {
    story_id: id, published_at: date.toISOString(),
    views: numberValue(row["story_views"]) ?? numberValue(row["story_impressions"]), reach: numberValue(row["story_reach"]),
    replies: numberValue(row["story_replies"]), shares: numberValue(row["story_shares"]), interactions: numberValue(row["story_interactions"]),
  };
}
/** Les chiffres d'une story ne font que croître jusqu'à son expiration : on garde la plus grande valeur vue, et un chiffre absent n'efface jamais un chiffre connu. */
export function mergeStory(old: Pick<MappedStory, "views" | "reach" | "replies" | "shares" | "interactions"> | undefined, next: MappedStory): MappedStory {
  const high = (a: number | null | undefined, b: number | null) => (a == null ? b : b == null ? a : Math.max(a, b));
  return {
    ...next,
    views: high(old?.views, next.views), reach: high(old?.reach, next.reach), replies: high(old?.replies, next.replies),
    shares: high(old?.shares, next.shares), interactions: high(old?.interactions, next.interactions),
  };
}
