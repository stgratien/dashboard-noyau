import type { AdCoverage, SocialDay, SocialPost } from "../../lib/social-totals";
import { dayNumber, isoFromDay } from "../../lib/dashboard-periods";
import type { PlatformId } from "../../core/client-config";

/**
 * Jeu de données synthétique, sans donnée d'aucun client : un compte jeune dont les sources ne démarrent pas toutes le même jour.
 * Facebook n'a son organique (et ses clics sur les liens) qu'à partir du 10/03/2025, LinkedIn du 05/05/2025 (des zéros du fournisseur avant), TikTok n'a ses clics sur les liens
 * et ses abonnés qu'à partir du 01/04/2025 ; Instagram est complet depuis le 01/01/2025 ; le payant existe depuis le 01/01/2025 partout. Les périodes de février 2025 sont donc partielles,
 * celles de juin 2025 complètes.
 */
export const PLATFORM_IDS: PlatformId[] = ["facebook", "instagram", "linkedin", "tiktok"];
export const range = (start: string, end: string) =>
  Array.from({ length: dayNumber(end) - dayNumber(start) + 1 }, (_, i) =>
    isoFromDay(dayNumber(start) + i),
  );
export const SOURCES: Record<PlatformId, [string, string]> = {
  facebook: ["facebook_organic", "facebook"],
  instagram: ["instagram", "facebook"],
  linkedin: ["linkedin_organic", "linkedin"],
  tiktok: ["tiktok_organic", "tiktok"],
};
export const row = (
  platform: string,
  source: string,
  day: string,
  metrics: SocialDay["metrics"],
): SocialDay => ({
  platform,
  source,
  day,
  followers_estimated: false,
  metrics,
});
export const organicRows = (
  p: PlatformId,
  start: string,
  end: string,
  extra: SocialDay["metrics"] = {},
) =>
  range(start, end).map((day) =>
    row(p, SOURCES[p][0], day, {
      followers: 1000,
      impressions: 500,
      videoViews: 50,
      likes: 10,
      comments: 2,
      shares: 1,
      postsAvailable: 1,
      ...extra,
    }),
  );
export const paidRows = (p: PlatformId, start: string, end: string) =>
  range(start, end).map((day) =>
    row(p, SOURCES[p][1], day, {
      spend: 5,
      impressions: 400,
      videoViews: 20,
      likes: 3,
      comments: 1,
      shares: 1,
      linkClicks: 4,
    }),
  );
export const post = (
  platform: string,
  id: string,
  day: string,
  extra: Partial<SocialPost> = {},
): SocialPost => ({
  platform,
  post_id: id,
  published_at: `${day}T10:00:00Z`,
  title: id,
  format: "Photo",
  permalink: "",
  thumbnail_path: null,
  metrics: { impressions: 300, likes: 5, comments: 1, shares: 1 },
  ...extra,
});
export const days: SocialDay[] = [
  ...organicRows("facebook", "2025-03-10", "2025-08-31", { linkClicks: 2 }),
  ...organicRows("instagram", "2025-01-01", "2025-08-31", { linkClicks: 0 }),
  ...range("2025-01-01", "2025-05-04").map((day) =>
    row("linkedin", "linkedin_organic", day, {
      impressions: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      postsAvailable: 1,
    }),
  ),
  ...organicRows("linkedin", "2025-05-05", "2025-08-31", { linkClicks: 0 }),
  ...range("2025-01-01", "2025-03-31").map((day) =>
    row("tiktok", "tiktok_organic", day, {
      impressions: 300,
      videoViews: 300,
      likes: 20,
      comments: 2,
      shares: 1,
      postsAvailable: 1,
    }),
  ),
  ...organicRows("tiktok", "2025-04-01", "2025-08-31", { linkClicks: 3 }),
  ...PLATFORM_IDS.flatMap((p) => paidRows(p, "2025-01-01", "2025-08-31")),
];
export const posts: SocialPost[] = PLATFORM_IDS.flatMap((id) =>
  range("2025-01-01", "2025-08-31")
    .filter((_, i) => i % 7 === 0)
    .map((day) => post(id, `${id}-${day}`, day)),
);
export const coverage: AdCoverage[] = range("2025-01-01", "2025-08-31").flatMap((day) =>
  ["facebook", "linkedin", "tiktok"].map((source) => ({ source, day })),
);
