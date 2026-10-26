import { dayNumber, isoFromDay, lastDays, type Period, periodDays } from "@/lib/dashboard-periods";
import { client } from "@/lib/client";
import type { PlatformId } from "@/core/client-config";

// Vignettes de démonstration neutres (aucun actif propre à un client).
const placeholder = (width: number, height: number) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#d9e2ec"/></svg>`)}`;
const aircraftThumbnail = placeholder(320, 320);
const exhibitionThumbnail = placeholder(180, 320);

// Réseaux : Windsor.ai — Meta Ads, Facebook organique, Instagram, TikTok Ads,
// TikTok organique, LinkedIn Ads, LinkedIn organique (7 sources). Aucune connexion active.
export type { PlatformId };

const PLATFORM_META: Record<PlatformId, { name: string; color: string }> = {
  facebook: { name: "Facebook", color: "var(--facebook)" },
  instagram: { name: "Instagram", color: "var(--instagram)" },
  linkedin: { name: "LinkedIn", color: "var(--linkedin)" },
  tiktok: { name: "TikTok", color: "var(--tiktok)" },
};
/** Réseaux affichés pour ce client (src/client/config.ts), dans l'ordre des onglets. */
export const PLATFORMS: { id: PlatformId; name: string; color: string }[] = client.networks.map((id) => ({ id, ...PLATFORM_META[id] }));

// Pseudo-random déterministe (évite les écarts serveur/navigateur)
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

// Meta Ads : allocations exclusives par plateforme de diffusion, jamais le budget Meta
// complet dans chacun des deux réseaux. Ici 85 € Facebook + 110 € Instagram par jour.
const BASE: Record<PlatformId, {
  followers: number; reach: number; engagement: number; saves: number; shares: number; videoViews: number;
  spend: number; cpm: number; ctr: number; convRate: number; aov: number; frequency: number;
}> = {
  facebook: { followers: 48200, reach: 3200, engagement: 2.1, saves: 40, shares: 90, videoViews: 1800, spend: 85, cpm: 7.8, ctr: 1.3, convRate: 3.1, aov: 62, frequency: 2.4 },
  instagram: { followers: 72500, reach: 6400, engagement: 4.3, saves: 210, shares: 160, videoViews: 9800, spend: 110, cpm: 9.4, ctr: 1.1, convRate: 2.7, aov: 58, frequency: 2.1 },
  tiktok: { followers: 31800, reach: 15400, engagement: 6.8, saves: 380, shares: 520, videoViews: 24000, spend: 70, cpm: 5.2, ctr: 0.9, convRate: 1.9, aov: 45, frequency: 1.7 },
  linkedin: { followers: 12900, reach: 1900, engagement: 3.4, saves: 25, shares: 60, videoViews: 900, spend: 95, cpm: 32, ctr: 0.6, convRate: 6.5, aov: 140, frequency: 3.0 },
};

export type DayPoint = {
  date: string; reach: number; engagements: number; newFollowers: number; saves: number; shares: number; videoViews: number;
  spend: number; impressions: number; clicks: number; conversions: number; revenue: number;
  /** Organique : impressions, clics (liens, profil) */
  orgImpressions: number;
  /** Clics sur les liens (URL externe) : organiques et publicitaires — hors clics publication/profil */
  orgLinkClicks: number; paidLinkClicks: number;
  /** engagements = j'aime + commentaires + partages (sans sauvegardes). Paid : réactions + commentaires + partages sur les publicités, vues vidéo payantes */
  paidEngagements: number; paidVideoViews: number;
  likes: number; comments: number;
  paidLikes: number; paidComments: number; paidShares: number;
};

const PLATFORM_SEED: Record<PlatformId, number> = { facebook: 11, instagram: 23, linkedin: 37, tiktok: 53 };
const REFERENCE_DAY = dayNumber("2026-10-08");
const dates = (period: Period) => Array.from({ length: Math.max(0, periodDays(period)) }, (_, i) => dayNumber(period.start) + i);
const label = (day: number) => new Date(`${isoFromDay(day)}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", timeZone: "UTC" });

/** Démo déterministe par jour calendaire : toute plage passée ou future a des chiffres stables. */
export function getSeries(p: PlatformId, period: Period): DayPoint[] {
  const b = BASE[p];
  return dates(period).map((day) => {
    const r = rng(PLATFORM_SEED[p] * 100_003 + day);
    const k = 0.75 + r() * 0.5;
    const reach = Math.round(b.reach * k);
    const spend = +(b.spend * (0.8 + r() * 0.4)).toFixed(2);
    const impressions = Math.round((spend / b.cpm) * 1000);
    const clicks = Math.round(impressions * (b.ctr / 100) * (0.85 + r() * 0.3));
    const conversions = Math.round(clicks * (b.convRate / 100) * (0.7 + r() * 0.6));
    const engagements = Math.round(reach * (b.engagement / 100) * (0.8 + r() * 0.4));
    const shares = Math.min(engagements, Math.round(b.shares * k));
    const comments = Math.round((engagements - shares) * 0.12);
    const paidEngagements = Math.round(impressions * 0.009 * (0.8 + r() * 0.4));
    const paidLikes = Math.round(paidEngagements * 0.8);
    const paidComments = Math.round(paidEngagements * 0.08);
    return {
      date: label(day),
      reach,
      engagements, likes: engagements - shares - comments, comments,
      newFollowers: Math.round(b.followers * 0.0012 * k),
      saves: Math.round(b.saves * k),
      shares,
      videoViews: Math.round(b.videoViews * k),
      spend, impressions, clicks, conversions,
      revenue: Math.round(conversions * b.aov),
      orgImpressions: Math.round(reach * (1.35 + r() * 0.2)),
      orgLinkClicks: Math.round(reach * 0.008 * (0.8 + r() * 0.4)),
      paidLinkClicks: Math.round(clicks * 0.7),
      paidEngagements, paidLikes, paidComments, paidShares: paidEngagements - paidLikes - paidComments,
      paidVideoViews: Math.round(impressions * 0.18 * (0.8 + r() * 0.4)),
    };
  });
}

const FORMATS: Record<PlatformId, string[]> = {
  facebook: ["Post", "Vidéo", "Carrousel", "Live"],
  instagram: ["Reel", "Carrousel", "Story", "Post"],
  tiktok: ["Vidéo", "Vidéo", "Duo", "Live"],
  linkedin: ["Post", "Document", "Vidéo", "Article"],
};
const TITLES = ["À la une cette semaine", "Dans les coulisses", "Rencontre avec les équipes", "Au cœur de l’action", "Les nouveautés du moment", "Une journée particulière", "Retour en images", "À ne pas manquer"];

export function getPosts(p: PlatformId, period: Period = lastDays(30, "2026-10-08")) {
  const days = Math.max(1, periodDays(period));
  const r = rng(PLATFORM_SEED[p] * 31 + dayNumber(period.start) * 17 + days);
  const b = BASE[p];
  return TITLES.map((title, i) => {
    const reach = Math.round(b.reach * (1.5 + r() * 4));
    const eng = Math.round(reach * (b.engagement / 100) * (0.6 + r() * 1));
    const impressions = Math.round(reach * (1.2 + r() * 0.4));
    const format = FORMATS[p][i % 4] ?? "Post";
    const vertical = p === "tiktok" || format === "Reel" || format === "Story";
    return {
      id: i, title, format, vertical, impressions,
      thumbnail_url: vertical ? exhibitionThumbnail : aircraftThumbnail,
      permalink: `/publications/${p}/${i}`,
      date: new Date(`${isoFromDay(dayNumber(period.end) - Math.floor(i * (days - 1) / 7))}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }),
      reach, likes: Math.round(eng * 0.75), comments: Math.round(eng * 0.08),
      shares: Math.round(eng * 0.1),
      rate: ((Math.round(eng * 0.75) + Math.round(eng * 0.08) + Math.round(eng * 0.1)) / impressions) * 100,
    };
  }).sort((a, b) => b.impressions - a.impressions);
}

const POST_RATE: Record<PlatformId, number> = { facebook: 0.8, instagram: 1.1, tiktok: 0.6, linkedin: 0.5 };
export const postsPublished = (p: PlatformId, period: Period) =>
  dates(period).reduce((total, day) => total + (rng(PLATFORM_SEED[p] * 7_919 + day)() < POST_RATE[p] ? 1 : 0), 0);

export const followersAt = (p: PlatformId, day: string) =>
  Math.max(0, Math.round(BASE[p].followers * (1 + 0.0012 * (dayNumber(day) - REFERENCE_DAY))));

/* ============================================================
 * Métriques "blended" (organique + paid), comme les fusions Looker Studio.
 * Pour brancher les vraies données, il suffit de fournir les mêmes champs
 * DayPoint depuis la source (Windsor.ai) : l'affichage n'a pas à changer.
 * ============================================================ */

/** Impressions totales = impressions organiques + impressions payantes */
export const blendedImpressions = (d: Pick<DayPoint, "orgImpressions" | "impressions">) =>
  d.orgImpressions + d.impressions;

/** Interactions totales = (j'aime + commentaires + partages organiques) + (réactions + commentaires + partages sur les publicités). Les sauvegardes ne sont PAS comptées. */
export const blendedInteractions = (d: Pick<DayPoint, "engagements" | "paidEngagements">) =>
  d.engagements + d.paidEngagements;

/** Vues de vidéo totales = vues organiques + vues payantes */
export const blendedVideoViews = (d: Pick<DayPoint, "videoViews" | "paidVideoViews">) =>
  d.videoViews + d.paidVideoViews;

/** Clics sur les liens = clics sur les liens organiques + clics sur les liens des publicités (URL externe uniquement, hors clics publication/profil) */
export const blendedClicks = (d: Pick<DayPoint, "orgLinkClicks" | "paidLinkClicks">) => d.orgLinkClicks + d.paidLinkClicks;

/** Agrège une série en KPIs blended pour une période. */
export function blendedTotals(p: PlatformId, s: DayPoint[], period: Period) {
  const sum = (fn: (d: DayPoint) => number) => s.reduce((a, d) => a + fn(d), 0);
  const impressions = sum(blendedImpressions);
  const interactions = sum(blendedInteractions);
  const posts = postsPublished(p, period);
  const newFollowers = sum((d) => d.newFollowers);
  const spend = sum((d) => d.spend);
  const paidImpressions = sum((d) => d.impressions);
  const paidClicks = sum((d) => d.paidLinkClicks);
  const interactionBreakdown = [
    { name: "J’aime", v: sum((d) => d.likes + d.paidLikes) },
    { name: "Commentaires", v: sum((d) => d.comments + d.paidComments) },
    { name: "Partages", v: sum((d) => d.shares + d.paidShares) },
  ];
  return {
    followers: followersAt(p, period.end),
    posts,
    newFollowers,
    impressions,
    impressionsPerPost: posts ? impressions / posts : 0,
    videoViews: sum(blendedVideoViews),
    interactions, interactionBreakdown,
    engagementRate: impressions ? (interactions / impressions) * 100 : 0,
    clicks: sum(blendedClicks),
    spend,
    cpm: paidImpressions ? (spend / paidImpressions) * 1000 : 0,
    cpc: paidClicks ? spend / paidClicks : 0,
  };
}

export type BlendedTotals = ReturnType<typeof blendedTotals>;
export const allNetworkTotals = (totals: BlendedTotals[]) => ({
  impressions: totals.reduce((a, t) => a + t.impressions, 0),
  interactions: totals.reduce((a, t) => a + t.interactions, 0),
  followers: totals.reduce((a, t) => a + t.followers, 0),
  spend: totals.reduce((a, t) => a + t.spend, 0),
});
