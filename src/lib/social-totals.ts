import type { PlatformId } from "./dashboard-data";
import { PLATFORM_SOURCES } from "../core/client-config";
import { dayNumber, isoFromDay, periodDays, todayISO, type Period } from "./dashboard-periods";
import { nullableSum, VIDEO_FORMATS, type Metrics } from "./windsor-mapping";
import { followerChange } from "./social-followers";

export type SocialDay = {
  platform: string;
  source: string;
  day: string;
  metrics: Metrics;
  followers_estimated: boolean;
};
export type SocialPost = {
  platform: string;
  post_id: string;
  published_at: string;
  title: string;
  format: string;
  permalink: string;
  thumbnail_path: string | null;
  metrics: Metrics;
  thumbnail_url?: string;
  sponsored?: { spend: number; impressions: number };
  /** Annonce rapprochée automatiquement de cette publication (date et titre du nom d'annonce). */
  adLink?: 'rule' | 'manual';
};
export type SocialStatus = { source: string; state: string; last_success_at: string | null };
export type SocialAd = { source: string; platform: string; ad_id: string; day: string; impressions: number };
export type AdCoverage = { source: string; day: string };
const sources: Record<PlatformId, [string, string]> = PLATFORM_SOURCES;
const divide = (a: number | null, b: number | null, multiplier = 1) =>
  a == null || b == null || b === 0 ? null : (a / b) * multiplier;

/** One real blended aggregator used by both Global and platform tabs. Missing days remain null, never demo or zero. */
export function realBlendedTotals(
  p: PlatformId,
  days: SocialDay[],
  publications: SocialPost[],
  period: Period,
  statuses: SocialStatus[],
  ads: SocialAd[] = [],
  coverage: AdCoverage[] = [],
) {
  const [organic, paid] = sources[p];
  const own = [
    ...new Map(
      days
        .filter((d) => d.platform === p && d.day >= period.start && d.day <= period.end)
        .map((d) => [`${d.source}:${d.day}`, d]),
    ).values(),
  ];
  // Today and days after a source's last successful sync are not yet complete: exclude them instead of nulling the period.
  const yesterday = isoFromDay(dayNumber(todayISO()) - 1);
  const endFor = (source: string) => {
    const last = statuses.find((s) => s.source === source)?.last_success_at;
    const synced = last ? isoFromDay(dayNumber(last.slice(0, 10)) - 1) : yesterday;
    return [period.end, yesterday, synced].sort()[0] ?? period.end;
  };
  const expectedDays = (source: string) => {
    const end = endFor(source);
    return end < period.start ? 0 : periodDays({ start: period.start, end });
  };
  const sum = (source: string, field: string) => {
    const end = endFor(source);
    const rows = own.filter((d) => d.source === source && d.day <= end);
    const expected = expectedDays(source);
    if (expected === 0 || rows.length !== expected) return null;
    return nullableSum(rows.map((d) => d.metrics[field]));
  };
  // Nouveaux abonnés. LinkedIn publie ces gains avec environ 2 jours de retard : les trois derniers jours (hier compris), sans valeur, ne bloquent plus la somme,
  // qui est alors provisoire. Tout jour plus ancien sans valeur (période sans historique) garde la donnée indisponible.
  const newFollowersGains = (): { value: number | null; provisional: boolean } => {
    if (p !== "linkedin") return { value: sum(organic, "newFollowers"), provisional: false };
    const end = endFor(organic);
    const rows = own.filter((d) => d.source === organic && d.day <= end);
    if (expectedDays(organic) === 0 || rows.length !== expectedDays(organic)) return { value: null, provisional: false };
    const lateFrom = isoFromDay(dayNumber(yesterday) - 3);
    if (rows.some((d) => d.day <= lateFrom && d.metrics["newFollowers"] == null)) return { value: null, provisional: false };
    const known = rows.map((d) => d.metrics["newFollowers"]).filter((v): v is number => v != null);
    return {
      value: known.length ? known.reduce((a, b) => a + b, 0) : null,
      provisional: rows.some((d) => d.day > lateFrom && d.metrics["newFollowers"] == null),
    };
  };
  const gains = newFollowersGains();
  const cohort = [
    ...new Map(
      publications
        .filter(
          (post) =>
            post.platform === p &&
            post.published_at.slice(0, 10) >= period.start &&
            post.published_at.slice(0, 10) <= period.end,
        )
        .map((post) => [post.post_id, post]),
    ).values(),
  ];
  // Vidéos de la cohorte, avec ou sans nombre de vues connu (un reel récent peut n'en avoir pas encore).
  const videoCohort = cohort.filter((post) => VIDEO_FORMATS.includes(post.format));
  const videosWithViews = videoCohort.filter((post) => post.metrics["impressions"] != null);
  const organicRows = own.filter((d) => d.source === organic);
  const accountUnavailable =
    p !== "tiktok" &&
    organicRows.length > 0 &&
    organicRows.every(
      (d) =>
        d.metrics["manualOrganicHistory"] !== 1 &&
        (d.metrics["impressions"] === 0 || d.metrics["accountOrganicUnavailable"] === 1),
    );
  const organicSum = (field: string) =>
    accountUnavailable && ["impressions", "likes", "comments", "shares"].includes(field)
      ? null
      : p === "tiktok" && ["impressions", "videoViews", "likes", "comments", "shares"].includes(field)
        ? sum(organic, "postsAvailable") == null
          ? null
          : nullableSum(cohort.map((post) => post.metrics[field === "videoViews" ? "impressions" : field]))
        : p === "instagram" && field === "videoViews"
          ? // Vues des reels et vidéos par date de publication, comme TikTok : le total du compte ne distingue pas les formats.
            sum(organic, "postsAvailable") == null
            ? null
            : videoCohort.length > 0 && videosWithViews.length === 0
              ? null
              : videosWithViews.reduce((a, post) => a + (post.metrics["impressions"] ?? 0), 0)
          : sum(organic, field);
  const missing: Record<string, string[]> = {};
  // Instagram account metrics from Windsor already include paid delivery; Meta Ads paid actions are only added on agency-history days.
  const igManualDays =
    p === "instagram"
      ? new Set(
          own
            .filter((d) => d.source === organic && d.metrics["instagramManualFill"] === 1 && d.day <= endFor(organic))
            .map((d) => d.day),
        )
      : new Set<string>();
  const igPaidOnManual = (field: string): number | null => {
    if (!["likes", "comments", "shares"].includes(field) || igManualDays.size === 0) return 0;
    const rows = own.filter((d) => d.source === paid && igManualDays.has(d.day));
    return rows.length !== igManualDays.size ? null : nullableSum(rows.map((d) => d.metrics[field]));
  };
  const blended = (field: string) => {
    const a = organicSum(field),
      b =
        p === "instagram" && ["impressions", "videoViews", "likes", "comments", "shares"].includes(field)
          ? igPaidOnManual(field)
          : sum(paid, field);
    if (a == null || b == null)
      missing[field] = [a == null ? `${p}:organic` : "", b == null ? `${p}:paid` : ""].filter(Boolean);
    // Instagram : le payant est déjà dans les chiffres du compte ; sans organique il n'y a rien à afficher (jamais « 0 »).
    if (p === "instagram" && a == null) return null;
    return a == null ? b : b == null ? a : a + b;
  };
  const impressions = blended("impressions");
  // Instagram : les vues connues sont additionnées ; les vidéos sans chiffre rendent le total partiel (jamais un zéro inventé).
  if (p === "instagram" && videosWithViews.length > 0 && videosWithViews.length < videoCohort.length)
    missing["videoViews"] = [`instagram:videos:${videoCohort.length - videosWithViews.length}`];
  const likes = blended("likes"),
    comments = blended("comments"),
    shares = blended("shares");
  const interactions = nullableSum([likes, comments, shares]);
  missing["interactions"] = [...new Set(["likes", "comments", "shares"].flatMap((key) => missing[key] ?? []))];
  missing["impressionsPerPost"] = missing["impressions"] ?? [];
  missing["engagementRate"] = [...new Set([...(missing["impressions"] ?? []), ...(missing["interactions"] ?? [])])];
  // Le CPE divise le budget par les interactions totales : il est partiel quand elles le sont.
  missing["cpe"] = missing["interactions"] ?? [];
  const manualPosts = sum(organic, "manualPostsPublished");
  const posts = manualPosts ?? (sum(organic, "postsAvailable") == null ? null : cohort.length);
  const last = days
    .filter((d) => d.platform === p && d.source === organic && d.day <= period.end && d.metrics["followers"] != null)
    .sort((a, b) => b.day.localeCompare(a.day))[0];
  const spend = sum(paid, "spend");
  const paidEnd = endFor(paid);
  const adCovered =
    expectedDays(paid) > 0 &&
    new Set(coverage.filter((c) => c.source === paid && c.day >= period.start && c.day <= paidEnd).map((c) => c.day))
      .size === expectedDays(paid);
  const adKeys = adCovered
    ? [
        ...new Set(
          ads
            .filter(
              (a) =>
                a.platform === p && a.source === paid && a.day >= period.start && a.day <= paidEnd && a.impressions > 0,
            )
            .map((a) => `${a.source}:${a.ad_id}`),
        ),
      ]
    : null;
  return {
    platform: p as string,
    missing,
    organicImpressions: organicSum("impressions"),
    organicInteractions: nullableSum([organicSum("likes"), organicSum("comments"), organicSum("shares")]),
    adKeys,
    adsDelivered: adKeys?.length ?? null,
    paidImpressions: sum(paid, "impressions"),
    followerGrowth: followerChange(days, p, period).value,
    followerGrowthPercent: followerChange(days, p, period).percent,
    videos:
      posts == null || cohort.some((post) => post.format === "Post")
        ? null
        : cohort.filter((post) => VIDEO_FORMATS.includes(post.format)).length,
    // CPE : budget (payant) ÷ interactions totales (organique + payant : j'aime + commentaires + partages), comme la carte « Interactions totales ».
    // Sans dépense (jours payants remplis à zéro), il n'y a pas de CPE : jamais « 0,00 € ».
    cpe: divide(spend, interactions) || null,
    cpv: divide(spend, sum(paid, "videoViews")),
    followers: last?.metrics["followers"] ?? null,
    estimated: last?.followers_estimated ?? false,
    posts,
    // D'où vient le nombre de publications : export de l'agence ou publications synchronisées ; deux bases différentes ne se comparent pas.
    postsBasis: (manualPosts != null ? "agency" : "cloud") as string,
    newFollowers: gains.value,
    newFollowersProvisional: gains.provisional,
    impressions,
    impressionsPerPost: divide(impressions, posts),
    // Instagram : cohorte de vidéos publiées uniquement (le payant du compte est déjà compris dans ses vues, sans détail par format).
    videoViews: p === "instagram" ? organicSum("videoViews") : blended("videoViews"),
    interactions,
    interactionBreakdown: [
      { name: "J’aime", v: likes },
      { name: "Commentaires", v: comments },
      { name: "Partages", v: shares },
    ],
    engagementRate: divide(interactions, impressions, 100),
    clicks: p === "instagram" || p === "linkedin" ? sum(paid, "linkClicks") : blended("linkClicks"),
    spend,
    cpm: divide(spend, sum(paid, "impressions"), 1000),
    cpc: divide(spend, sum(paid, "linkClicks")),
    sourceUnavailable: statuses.some((s) => (s.source === organic || s.source === paid) && s.state === "error"),
  };
}
export type RealTotals = ReturnType<typeof realBlendedTotals>;
export function realAllNetworkTotals(totals: RealTotals[]): RealTotals {
  const missing: Record<string, string[]> = {};
  /** Un réseau sans valeur n'est cité seul que si aucun détail (« organique », « payant ») n'explique déjà l'absence. */
  const bare = (t: RealTotals, keys: (keyof RealTotals & string)[]) =>
    keys.some((k) => t[k] == null && !t.missing[k]?.length) ? [t.platform] : [];
  const sum = (
    key:
      | "followers"
      | "posts"
      | "impressions"
      | "videoViews"
      | "interactions"
      | "spend"
      | "clicks"
      | "paidImpressions"
      | "videos"
      | "followerGrowth",
  ) => {
    missing[key] = [
      ...new Set(totals.flatMap((t) => [...bare(t, [key]), ...(t.missing[key] ?? [])])),
    ];
    const values = totals.map((t) => t[key]).filter((n): n is number => n != null);
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  };
  const impressions = sum("impressions"),
    posts = sum("posts");
  missing["adsDelivered"] = totals.filter((t) => t.adKeys === null).map((t) => t.platform);
  missing["impressionsPerPost"] = [
    ...new Set(
      totals.flatMap((t) => [
        ...bare(t, ["impressions", "posts"]),
        ...(t.missing["impressionsPerPost"] ?? []),
      ]),
    ),
  ];
  const paired = totals.filter((t) => t.impressions != null && t.posts != null);
  const average = paired.length
    ? divide(
        paired.reduce((a, t) => a + (t.impressions ?? 0), 0),
        paired.reduce((a, t) => a + (t.posts ?? 0), 0),
      )
    : null;
  const adKeys = totals.every((t) => t.adKeys === null) ? null : [...new Set(totals.flatMap((t) => t.adKeys ?? []))];
  const ratio = (
    a: "spend" | "interactions",
    b: "interactions" | "paidImpressions" | "impressions",
    key: string,
    m = 1,
  ) => {
    const available = totals.filter((t) => t[a] != null && t[b] != null);
    missing[key] = [
      ...new Set(
        totals.flatMap((t) => [
          ...bare(t, [a, b]),
          ...(t.missing[a] ?? []),
          ...(t.missing[b] ?? []),
        ]),
      ),
    ];
    return available.length
      ? divide(
          available.reduce((s, t) => s + (t[a] ?? 0), 0),
          available.reduce((s, t) => s + (t[b] ?? 0), 0),
          m,
        )
      : null;
  };
  const growth = sum("followerGrowth");
  const growthRows = totals.filter((t) => t.followers != null && t.followerGrowth != null);
  const baseline = growthRows.reduce((s, t) => s + (t.followers ?? 0) - (t.followerGrowth ?? 0), 0);
  const growthComparable = growthRows.reduce((s, t) => s + (t.followerGrowth ?? 0), 0);
  return {
    platform: "all",
    missing,
    organicImpressions: null,
    organicInteractions: null,
    adKeys,
    adsDelivered: adKeys?.length ?? null,
    cpe: ratio("spend", "interactions", "cpe") || null,
    cpv: null,
    paidImpressions: sum("paidImpressions"),
    videos: sum("videos"),
    followerGrowth: growth,
    followerGrowthPercent: growthRows.length && baseline ? (growthComparable / baseline) * 100 : null,
    followers: sum("followers"),
    posts,
    postsBasis: [...new Set(totals.map((t) => t.postsBasis))].sort().join("+"),
    impressions,
    impressionsPerPost: average,
    videoViews: sum("videoViews"),
    interactions: sum("interactions"),
    spend: sum("spend"),
    estimated: totals.some((t) => t.estimated),
    sourceUnavailable: totals.some((t) => t.sourceUnavailable),
    newFollowers: null,
    newFollowersProvisional: false,
    interactionBreakdown: [],
    engagementRate: ratio("interactions", "impressions", "engagementRate", 100),
    clicks: sum("clicks"),
    cpm: ratio("spend", "paidImpressions", "cpm", 1000),
    cpc: null,
  };
}

export const coveredDays = (period: Period) =>
  Array.from({ length: periodDays(period) }, (_, i) => isoFromDay(dayNumber(period.start) + i));
