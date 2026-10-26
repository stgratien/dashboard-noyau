import { useMemo } from "react";
import { realAllNetworkTotals, realBlendedTotals, type RealTotals } from "@/lib/social-totals";
import { videosNote } from "@/lib/dashboard-format";
import { PLATFORMS, type PlatformId } from "@/lib/dashboard-data";
import { definition, type KpiKey } from "@/lib/kpi-definitions";
import { youtubeTotals, addYoutubeToSocial, type YoutubeData } from "@/lib/youtube";
import { type GoogleData, Kpi, type SocialData, type ViewPeriods, budget, coverageDetails, delta, eur, fmt, followerNote, pct, shown } from "@/components/dashboard/common";

export function TotalCards({
  t,
  o,
  large = false,
  tk = false,
  p = "all",
}: {
  t: RealTotals;
  o: RealTotals;
  large?: boolean;
  tk?: boolean;
  p?: PlatformId | "all";
}) {
  const D = (k: KpiKey) => definition(k, p);
  const details = (key: string, base?: string) => {
    return coverageDetails(t, key, base ?? D(key as KpiKey));
  };
  const change = (key: string, current: number | null, previous: number | null) => {
    // Compare like-for-like network coverage; never present a partial/full scope change as performance.
    return JSON.stringify(t.missing[key] ?? []) === JSON.stringify(o.missing[key] ?? [])
      ? delta(current, previous)
      : undefined;
  };
  const videoNote = undefined;
  return (
    <>
      <Kpi
        large={large}
        {...details("followers")}
        label="Abonnés"
        value={shown(t, fmt(t.followers))}
        note={[details("followers").note, followerNote(t)].filter(Boolean).join(" · ")}
      />
      <Kpi
        large={large}
        {...details("posts")}
        label={tk ? "Vidéos publiées" : "Posts publiés"}
        prev={shown(o, fmt(o.posts))}
        value={shown(t, fmt(t.posts))}
        d={change("posts", t.posts, o.posts)}
      />
      <Kpi
        large={large}
        {...details("videos", D("videosPublished"))}
        label="Vidéos publiées"
        prev={shown(o, fmt(o.videos))}
        value={shown(t, fmt(t.videos))}
        d={change("videos", t.videos, o.videos)}
      />
      <Kpi
        large={large}
        {...details("adsDelivered")}
        label="Annonces diffusées"
        prev={shown(o, fmt(o.adsDelivered))}
        value={shown(t, fmt(t.adsDelivered))}
        d={change("adsDelivered", t.adsDelivered, o.adsDelivered)}
      />
      <Kpi
        large={large}
        {...details("impressions", videoNote)}
        label="Impressions"
        prev={shown(o, fmt(o.impressions))}
        value={shown(t, fmt(t.impressions))}
        d={change("impressions", t.impressions, o.impressions)}
      />
      <Kpi
        large={large}
        {...details("impressionsPerPost")}
        label="Impressions moy. / post"
        prev={shown(o, fmt(o.impressionsPerPost))}
        value={shown(t, fmt(t.impressionsPerPost))}
        d={change("impressionsPerPost", t.impressionsPerPost, o.impressionsPerPost)}
      />
      <Kpi
        large={large}
        {...details("videoViews", videoNote)}
        note={[
          details("videoViews").note,
          videosNote(
            t,
            (t.missing["videos"] ?? []).map((id) => PLATFORMS.find((platform) => platform.id === id)?.name ?? id),
          ),
        ]
          .filter(Boolean)
          .join(" · ")}
        label="Vues de vidéo"
        prev={shown(o, fmt(o.videoViews))}
        value={shown(t, fmt(t.videoViews))}
        d={t.videos === 0 && t.videoViews === 0 ? undefined : change("videoViews", t.videoViews, o.videoViews)}
      />
      <Kpi
        large={large}
        {...details("interactions", videoNote)}
        label="Interactions"
        prev={shown(o, fmt(o.interactions))}
        value={shown(t, fmt(t.interactions))}
        d={change("interactions", t.interactions, o.interactions)}
      />
      <Kpi
        large={large}
        {...details("clicks")}
        label="Clics sur les liens"
        prev={shown(o, fmt(o.clicks))}
        value={shown(t, fmt(t.clicks))}
        d={change("clicks", t.clicks, o.clicks)}
      />
      <Kpi
        large={large}
        {...details("engagementRate")}
        label="Taux d'engagement"
        prev={shown(o, pct(o.engagementRate))}
        pts={t.engagementRate != null && o.engagementRate != null ? t.engagementRate - o.engagementRate : undefined}
        value={shown(t, pct(t.engagementRate))}
        d={change("engagementRate", t.engagementRate, o.engagementRate)}
      />
      <Kpi
        large={large}
        {...details("spend")}
        label="Budget"
        prev={shown(o, budget(o.spend))}
        value={shown(t, budget(t.spend))}
        d={change("spend", t.spend, o.spend)}
      />

      <Kpi
        large={large}
        {...details(tk ? "cpv" : "cpe")}
        label={tk ? "CPV moyen" : "CPE moyen"}
        prev={shown(o, eur(tk ? o.cpv : o.cpe, 2))}
        value={shown(t, eur(tk ? t.cpv : t.cpe, 2))}
        d={change(tk ? "cpv" : "cpe", tk ? t.cpv : t.cpe, tk ? o.cpv : o.cpe)}
        inverse
      />
      <Kpi
        large={large}
        {...details("cpm")}
        label="CPM moyen"
        prev={shown(o, eur(o.cpm, 2))}
        value={shown(t, eur(t.cpm, 2))}
        d={change("cpm", t.cpm, o.cpm)}
        inverse
      />
    </>
  );
}

export function Overview({
  data,
  google,
  youtube,
  youtubeUnavailable,
  period,
  comparison,
}: ViewPeriods & {
  data: SocialData;
  google: GoogleData | undefined;
  youtube: YoutubeData | undefined;
  youtubeUnavailable: boolean;
}) {
  const rows = useMemo(
    () =>
      PLATFORMS.map(({ id: p }) => ({
        p,
        current: realBlendedTotals(p, data.days, data.posts, period, data.statuses, data.ads, data.adCoverage),
        previous: realBlendedTotals(p, data.days, data.posts, comparison, data.statuses, data.ads, data.adCoverage),
      })),
    [data, period, comparison],
  );
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
  return (
    <div className="space-y-6">
      <section data-export-block aria-label="Tous réseaux" className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TotalCards large t={t} o={o} />
        </div>
      </section>
    </div>
  );
}
