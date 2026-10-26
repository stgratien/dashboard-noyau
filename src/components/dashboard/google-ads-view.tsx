import { useMemo } from "react";
import { formatNumber, dayMonth } from "@/lib/dashboard-format";
import { CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, LineChart, Line } from "recharts";
import { type Period } from "@/lib/dashboard-periods";
import { googleAdsTotals, googleAdsSeries, googleAdsByChannel, googleAdsCampaigns, googleAdsStale } from "@/lib/google-ads";
import { BRAND_COLORS, type GoogleData, Kpi, Panel, SectionTitle, type ViewPeriods, axis, axisNumber, budget, delta, eur, fmt, pct, tip, tooltipNumber, gv, gd, axisEuro } from "@/components/dashboard/common";

export function useGoogleTotals(google: GoogleData | undefined, period: Period, comparison: Period) {
  return useMemo(() => {
    const rows = google?.rows ?? [];
    return {
      t: googleAdsTotals(rows, period),
      o: googleAdsTotals(rows, comparison),
      stale: googleAdsStale(google?.lastSuccess),
    };
  }, [google, period, comparison]);
}



export function GoogleAdsView({
  data,
  loading,
  period,
  comparison,
}: ViewPeriods & { data: GoogleData | undefined; loading: boolean }) {
  const { t, o, stale } = useGoogleTotals(data, period, comparison);
  const rows = data?.rows ?? [];
  const series = useMemo(() => googleAdsSeries(rows, period), [rows, period]);
  const channels = useMemo(() => googleAdsByChannel(rows, period), [rows, period]);
  const campaigns = useMemo(() => googleAdsCampaigns(rows, period), [rows, period]);
  if (loading) return <p className="text-sm text-muted-foreground">Chargement des données…</p>;
  const v = (x: string) => gv(t.hasData, stale, x),
    pv = (x: string) => gv(o.hasData, false, x);
  const d = (a: number | null, b: number | null) => gd(a, b, t.hasData, o.hasData);
  const colors = BRAND_COLORS;
  return (
    <div className="space-y-8">
      {stale && (
        <p className="text-sm text-destructive">
          Source indisponible : aucune donnée Google Ads reçue depuis plus de 48 h.
        </p>
      )}
      <section data-export-block className="space-y-3">
        <SectionTitle title="Média" className="border-b pb-1 text-lg font-medium text-foreground" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Kpi label="Budget" value={v(budget(t.spend))} prev={pv(budget(o.spend))} d={d(t.spend, o.spend)} />
          <Kpi label="CPC" value={v(eur(t.cpc, 2))} prev={pv(eur(o.cpc, 2))} d={d(t.cpc, o.cpc)} inverse />
          <Kpi label="CPM" value={v(eur(t.cpm, 2))} prev={pv(eur(o.cpm, 2))} d={d(t.cpm, o.cpm)} inverse />
        </div>
      </section>
      <section data-export-block className="space-y-3">
        <SectionTitle title="Performance" className="border-b pb-1 text-lg font-medium text-foreground" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Kpi
            label="Impressions"
            value={v(fmt(t.impressions))}
            prev={pv(fmt(o.impressions))}
            d={d(t.impressions, o.impressions)}
          />
          <Kpi label="Clics" value={v(fmt(t.clicks))} prev={pv(fmt(o.clicks))} d={d(t.clicks, o.clicks)} />
          <Kpi
            label="CTR"
            value={v(pct(t.ctr))}
            prev={pv(pct(o.ctr))}
            pts={t.ctr != null && o.ctr != null ? t.ctr - o.ctr : undefined}
          />
          <Kpi
            label="Conversions"
            value={v(fmt(t.conversions))}
            prev={pv(fmt(o.conversions))}
            d={d(t.conversions, o.conversions)}
          />
          <Kpi
            label="Coût par conversion"
            value={v(eur(t.costPerConversion, 2))}
            prev={pv(eur(o.costPerConversion, 2))}
            d={d(t.costPerConversion, o.costPerConversion)}
            inverse
          />
          <Kpi
            label="Vues vidéo"
            value={v(fmt(t.videoViews))}
            prev={pv(fmt(o.videoViews))}
            d={d(t.videoViews, o.videoViews)}
          />
        </div>
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={series.weekly ? "Budget et clics par semaine" : "Budget et clics par jour"} nav="Budget et clics">
          <div className="h-80">
            <ResponsiveContainer>
              <LineChart data={series.points}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={axis} tickFormatter={dayMonth} />
                <YAxis yAxisId="l" tick={axis} tickFormatter={axisEuro} />
                <YAxis yAxisId="r" orientation="right" tick={axis} tickFormatter={axisNumber} />
                <Tooltip
                  {...tip}
                  formatter={(v: unknown, name: unknown) =>
                    typeof v === "number" ? (name === "Budget" ? budget(v) : tooltipNumber(v)) : String(v)
                  }
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line yAxisId="l" dataKey="spend" name="Budget" stroke="var(--paid)" dot={false} />
                <Line yAxisId="r" dataKey="clicks" name="Clics" stroke="var(--primary)" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Répartition du budget par type de campagne" nav="Répartition du budget">
          {channels.length === 0 ? (
            <p className="text-sm text-muted-foreground">{formatNumber(null)}</p>
          ) : (
            <div className="grid items-center gap-4 md:grid-cols-2">
              <div className="h-72">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={channels}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={70}
                      outerRadius={110}
                      isAnimationActive={false}
                    >
                      {channels.map((c, i) => (
                        <Cell key={c.name} fill={colors[i % colors.length]} />
                      ))}
                    </Pie>
                    <Tooltip {...tip} formatter={(v: unknown) => (typeof v === "number" ? budget(v) : String(v))} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {channels.map((c, i) => (
                    <tr key={c.name} className="border-b">
                      <td className="py-2">
                        <span
                          className="mr-2 inline-block size-2.5 rounded-full"
                          style={{ background: colors[i % colors.length] }}
                        />
                        {c.name}
                      </td>
                      <td className="text-right">{budget(c.value)}</td>
                      <td className="text-right">{pct(t.spend ? (c.value / t.spend) * 100 : null)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
      <Panel title="Campagnes" nav="Campagnes">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3 font-medium">Campagne</th>
                <th className="pr-3 font-medium">Type</th>
                <th className="pr-3 text-right font-medium">Budget</th>
                <th className="pr-3 text-right font-medium">Impressions</th>
                <th className="pr-3 text-right font-medium">Clics</th>
                <th className="pr-3 text-right font-medium">CTR</th>
                <th className="pr-3 text-right font-medium">CPC</th>
                <th className="pr-3 text-right font-medium">Conversions</th>
                <th className="text-right font-medium">Coût / conv.</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-6 text-center text-muted-foreground">
                    {formatNumber(null)}
                  </td>
                </tr>
              ) : (
                campaigns.map((c) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{c.name || c.id}</td>
                    <td className="pr-3">
                      <span className="rounded bg-muted px-2 py-0.5 text-xs">{c.type}</span>
                    </td>
                    <td className="pr-3 text-right">{budget(c.spend)}</td>
                    <td className="pr-3 text-right">{fmt(c.impressions)}</td>
                    <td className="pr-3 text-right">{fmt(c.clicks)}</td>
                    <td className="pr-3 text-right">{pct(c.ctr)}</td>
                    <td className="pr-3 text-right">{eur(c.cpc, 2)}</td>
                    <td className="pr-3 text-right">{fmt(c.conversions)}</td>
                    <td className="text-right">{eur(c.costPerConversion, 2)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
