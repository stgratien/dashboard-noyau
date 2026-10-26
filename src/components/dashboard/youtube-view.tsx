import { useMemo, type ReactNode } from "react";
import { formatNumber, formatChangePercent, typographicMinus } from "@/lib/dashboard-format";
import { CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart, Bar } from "recharts";
import { youtubeTotals, youtubeAudienceMonths, youtubeVideoType, type YoutubeData } from "@/lib/youtube";
import { googleAdsStale } from "@/lib/google-ads";
import { type GoogleData, Kpi, Panel, SectionTitle, type ViewPeriods, axis, axisNumber, budget, delta, eur, fmt, pct, tip, gv } from "@/components/dashboard/common";

export function YoutubeView({
  data,
  google,
  loading,
  period,
  comparison,
}: ViewPeriods & { data: YoutubeData | undefined; google: GoogleData | undefined; loading: boolean }) {
  const g = google?.rows ?? [];
  const empty: YoutubeData = { days: [], videos: [], snapshots: [], lastSuccess: null };
  const yd = data ?? empty;
  const t = useMemo(() => youtubeTotals(yd, g, period), [yd, g, period]);
  const o = useMemo(() => youtubeTotals(yd, g, comparison), [yd, g, comparison]);
  const months = useMemo(() => youtubeAudienceMonths(yd, period), [yd, period]);
  const vids = useMemo(
    () =>
      yd.videos
        .filter((v) => v.published_at.slice(0, 10) >= period.start && v.published_at.slice(0, 10) <= period.end)
        .sort((a, b) => (b.views ?? 0) - (a.views ?? 0)),
    [yd, period],
  );
  if (loading) return <p className="text-sm text-muted-foreground">Chargement des données…</p>;
  const stale = googleAdsStale(yd.lastSuccess);
  const v = (x: string) => gv(t.hasData, stale, x);
  const hours = (h: number | null) => (h == null ? formatNumber(null) : `${formatNumber(Math.round(h))} h`);
  const mmss = (s: number | null) =>
    s == null ? formatNumber(null) : `${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;
  const growth =
    t.followerGrowth != null && t.followerGrowthPercent != null
      ? `${formatChangePercent(t.followerGrowthPercent)} (${t.followerGrowth >= 0 ? "+" : ""}${typographicMinus(t.followerGrowth.toLocaleString("fr-FR"))})`
      : undefined;
  const sec = (title: string, kids: ReactNode) => (
    <section data-export-block className="space-y-3">
      <SectionTitle title={title} className="border-b pb-1 text-lg font-medium text-foreground" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {kids}
      </div>
    </section>
  );
  return (
    <div className="space-y-8">
      {stale && (
        <p className="text-sm text-destructive">
          Source indisponible : aucune donnée YouTube reçue depuis plus de 48 h.
        </p>
      )}
      {sec(
        "Activité",
        <>
          <Kpi
            label="Abonnés"
            value={v(fmt(t.followers))}
            note={[growth, t.estimated ? "Valeur estimée" : undefined].filter(Boolean).join(" · ") || undefined}
          />
          <Kpi
            label="Nouveaux abonnés"
            value={v(fmt(t.newFollowers))}
            prev={fmt(o.newFollowers)}
            d={delta(t.newFollowers, o.newFollowers)}
          />
          <Kpi label="Vidéos publiées" value={v(fmt(t.videos))} prev={fmt(o.videos)} d={delta(t.videos, o.videos)} />
        </>,
      )}
      {sec(
        "Visibilité",
        <>
          <Kpi
            label="Vues"
            value={v(fmt(t.views))}
            prev={fmt(o.views)}
            d={delta(t.views, o.views)}
            note={t.paidViews != null ? `dont ${fmt(t.paidViews)} payantes` : undefined}
          />
          <Kpi
            label="Impressions"
            value={fmt(t.paidImpressions)}
            prev={fmt(o.paidImpressions)}
            d={delta(t.paidImpressions, o.paidImpressions)}
            note="payant uniquement"
          />
          <Kpi
            label="Durée de visionnage"
            value={v(hours(t.watchHours))}
            prev={hours(o.watchHours)}
            d={delta(t.watchHours, o.watchHours)}
          />
          <Kpi
            label="Durée moyenne de visionnage"
            value={v(mmss(t.avgDuration))}
            prev={mmss(o.avgDuration)}
            d={delta(t.avgDuration, o.avgDuration)}
          />
        </>,
      )}
      {sec(
        "Engagement",
        <>
          <Kpi
            label="Interactions"
            value={v(fmt(t.interactions))}
            prev={fmt(o.interactions)}
            d={delta(t.interactions, o.interactions)}
          />
          <Kpi
            label="Taux d'engagement"
            value={v(pct(t.engagementRate))}
            prev={pct(o.engagementRate)}
            pts={t.engagementRate != null && o.engagementRate != null ? t.engagementRate - o.engagementRate : undefined}
          />
        </>,
      )}
      {sec(
        "Média",
        <>
          <Kpi
            label="Budget"
            value={budget(t.spend)}
            prev={budget(o.spend)}
            d={delta(t.spend, o.spend)}
            note="campagnes vidéo Google Ads"
          />
          <Kpi label="CPV" value={eur(t.cpv, 2)} prev={eur(o.cpv, 2)} d={delta(t.cpv, o.cpv)} inverse />
          <Kpi label="CPM" value={eur(t.cpm, 2)} prev={eur(o.cpm, 2)} d={delta(t.cpm, o.cpm)} inverse />
        </>,
      )}
      <Panel title="Top vidéos" nav="Top vidéos">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3 font-medium">Vidéo</th>
                <th className="pr-3 font-medium">Date</th>
                <th className="pr-3 font-medium">Type</th>
                <th className="pr-3 text-right font-medium">Vues</th>
                <th className="pr-3 text-right font-medium">J'aime</th>
                <th className="text-right font-medium">Commentaires</th>
              </tr>
            </thead>
            <tbody>
              {vids.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-muted-foreground">
                    Aucune vidéo publiée sur la période
                  </td>
                </tr>
              ) : (
                vids.slice(0, 20).map((x) => (
                  <tr key={x.video_id} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <a
                        href={x.url ?? `https://www.youtube.com/watch?v=${x.video_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-3 hover:underline"
                      >
                        {x.thumbnail_url ? (
                          <img src={x.thumbnail_url} alt="" className="h-12 w-20 shrink-0 rounded object-cover" />
                        ) : (
                          <span className="h-12 w-20 shrink-0 rounded bg-muted" />
                        )}
                        <span className="line-clamp-2 font-medium">{x.title || x.video_id}</span>
                      </a>
                    </td>
                    <td className="whitespace-nowrap pr-3">
                      {new Date(x.published_at).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}
                    </td>
                    <td className="pr-3">
                      <span className="rounded bg-muted px-2 py-0.5 text-xs">{youtubeVideoType(x)}</span>
                    </td>
                    <td className="pr-3 text-right">{fmt(x.views)}</td>
                    <td className="pr-3 text-right">{fmt(x.likes)}</td>
                    <td className="text-right">{fmt(x.comments)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
      {/* Comme sur les onglets réseau : une partie de la page à part entière, titrée comme « Activité », et un encadré sans titre. */}
      <section data-export-block className="space-y-3">
        <SectionTitle title="Évolution de l’audience" className="border-b pb-1 text-lg font-medium text-foreground" />
      <Panel bare title="Évolution de l’audience">
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={months}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={axis} />
              <YAxis tick={axis} tickFormatter={axisNumber} />
              <Tooltip {...tip} />
              <Bar dataKey="followers" name="Abonnés" fill="var(--primary)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>
      </section>
    </div>
  );
}
