import type { GoogleData, SocialData } from "@/components/dashboard/common";
import { PLATFORMS, type PlatformId } from "@/lib/dashboard-data";
import type { Period } from "@/lib/dashboard-periods";
import { realAllNetworkTotals, realBlendedTotals, type RealTotals } from "@/lib/social-totals";
import { addYoutubeToSocial, youtubeTotals, type YoutubeData } from "@/lib/youtube";

/** Les totaux d'un réseau sur la période affichée et sur la période comparée. */
export type NetworkTotals = { p: PlatformId; current: RealTotals; previous: RealTotals };

/** Les totaux de chaque réseau (ordre des onglets) : l'onglet Global et son export partent des mêmes objets. */
export function networkTotals(data: SocialData, period: Period, comparison: Period): NetworkTotals[] {
  return PLATFORMS.map(({ id: p }) => ({
    p,
    current: realBlendedTotals(p, data.days, data.posts, period, data.statuses, data.ads, data.adCoverage),
    previous: realBlendedTotals(p, data.days, data.posts, comparison, data.statuses, data.ads, data.adCoverage),
  }));
}

/**
 * Le total « Tous réseaux » de la période affichée (`t`) et de la période comparée (`o`) : les réseaux additionnés, puis YouTube une fois connecté (abonnés, publications, vues de vidéo et
 * interactions seulement). `youtube` est ce que l'onglet Global reçoit, `youtubeUnavailable` signale un YouTube connecté mais illisible pour l'instant.
 */
export function globalTotals(
  rows: readonly NetworkTotals[],
  google: GoogleData | undefined,
  youtube: YoutubeData | undefined,
  youtubeUnavailable: boolean,
  period: Period,
  comparison: Period,
): { t: RealTotals; o: RealTotals } {
  const g = google?.rows ?? [];
  const t = addYoutubeToSocial(
    realAllNetworkTotals(rows.map((row) => row.current)),
    youtube?.lastSuccess ? youtubeTotals(youtube, g, period) : null,
    youtubeUnavailable,
  );
  const o = addYoutubeToSocial(
    realAllNetworkTotals(rows.map((row) => row.previous)),
    youtube?.lastSuccess ? youtubeTotals(youtube, g, comparison) : null,
    youtubeUnavailable,
  );
  return { t, o };
}
