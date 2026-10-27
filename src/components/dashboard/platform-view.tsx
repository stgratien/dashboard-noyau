import { Fragment, useContext, useState } from "react";
import { realBlendedTotals, type SocialPost } from "@/lib/social-totals";
import { formatPercent, videosNote } from "@/lib/dashboard-format";
import { CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, LineChart, Line } from "recharts";
import { type PlatformId } from "@/lib/dashboard-data";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PostLink } from "@/components/post-link";
import { cn } from "@/lib/utils";
import { yesterdayISO, type Period } from "@/lib/dashboard-periods";
import { AUDIENCE_VIEW_LABELS, audienceDefaultView, audienceSeries, audienceViews, type AudienceView } from "@/lib/social-followers";
import { storiesTotals, storyDelta, storyNote } from "@/lib/social-stories";
import { definition, type KpiKey } from "@/lib/kpi-definitions";
import { postStats, topPosts, flopPosts, formatOptions, sortRows, pageWindow, audienceBreakdowns, audiencePanels, formatLabel, paidAdStats, TABLE_PAGE_SIZE, type SortKey, type PostStats, type PostType } from "@/lib/top-posts";
import { BRAND_COLORS, BigSection, MissingVisual, Kpi, NAV_SCROLL, Panel, ReportRowLimit, navProps, navSlug, reportAttr, SectionTitle, type SocialData, type ViewPeriods, axis, axisNumber, budget, comparableDelta, coverageDetails, delta, eur, fmt, followerNote, nf, pct, shown, tip } from "@/components/dashboard/common";

export function InteractionLabel({
  x,
  y,
  cx,
  percent,
  value,
}: {
  x?: number;
  y?: number;
  cx?: number;
  percent?: number;
  value?: number;
}) {
  if (x === undefined || y === undefined || cx === undefined) return null;
  return (
    <text x={x} y={y} textAnchor={x > cx ? "start" : "end"} fill="var(--foreground)" fontSize={11}>
      <tspan x={x} dy="-0.2em">
        {nf.format(value ?? 0)}
      </tspan>
      <tspan x={x} dy="1.3em" fill="var(--muted-foreground)">
        {formatPercent((percent ?? 0) * 100)}
      </tspan>
    </text>
  );
}

export function formatCounts(posts: SocialPost[], p: PlatformId, period: Period) {
  const own = [
    ...new Map(
      posts
        .filter(
          (x) =>
            x.platform === p &&
            x.published_at.slice(0, 10) >= period.start &&
            x.published_at.slice(0, 10) <= period.end,
        )
        .map((x) => [x.post_id, x]),
    ).values(),
  ];
  return ["Photo", "Vidéo", "Carrousel / Album", ...(p === "linkedin" ? ["Document"] : []), "Autre", "Non disponible"]
    .map((format) => ({
      format: formatLabel(p, format),
      count: own.filter(
        (x) =>
          (p === "tiktok"
            ? "Vidéo"
            : x.format === "Reel"
              ? "Vidéo"
              : x.format === "Post"
                ? "Non disponible"
                : x.format) === format,
      ).length,
    }))
    .filter((x) => x.count > 0);
}

/** Publications par format : simplement les formats et leurs chiffres, sans graphique ni axes. */
export function FormatList({ counts }: { counts: { format: string; count: number }[] }) {
  if (counts.length === 0) return <p className="text-sm text-muted-foreground">Aucune publication sur la période</p>;
  return (
    <ul className="divide-y">
      {counts.map((x) => (
        <li key={x.format} className="flex items-baseline justify-between py-2">
          <span className="text-base">{x.format}</span>
          <span className="text-xl font-semibold tabular-nums">{x.count}</span>
        </li>
      ))}
    </ul>
  );
}

/** « Évolution de l’audience » : les dates du sélecteur, au pas Semaine, Mois ou Année selon les boutons proposés pour la période (voir audienceViews) ; la vue par défaut sert aussi à l'image du rapport. */
export function AudienceEvolution({ days, p, period }: { days: SocialData["days"]; p: PlatformId; period: Period }) {
  const forReport = useContext(ReportRowLimit) !== undefined;
  const [choice, setChoice] = useState<{ key: string; view: AudienceView } | null>(null);
  const views = audienceViews(period);
  // Le choix ne vaut que pour la période affichée : à chaque changement de dates, la vue par défaut revient ; une vue absente n'est jamais sélectionnée.
  const key = `${period.start}/${period.end}`;
  const step = choice && choice.key === key && views.includes(choice.view) ? choice.view : audienceDefaultView(period);
  const audience = audienceSeries(days, p, period, undefined, step);
  const hasAudience = audience.some((x) => x.followers != null);
  const estimated = audience.some((x) => x.estimated);
  // Les points estimés (valeur reconstituée) sont tracés en creux, par une seconde ligne qui ne porte que ces points.
  const points = audience.map((x) => ({ ...x, estimatedFollowers: x.estimated ? x.followers : null }));
  return (
    // Une partie de la page à part entière, comme « Coûts média » : son titre porte les filtres, le graphique est dans un encadré sans titre.
    <section data-export-block className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b pb-1">
        <SectionTitle title="Évolution de l’audience" className="text-lg font-medium text-foreground" />
        {/* Un seul pas possible (périodes de moins de deux mois) : rien à choisir, aucun filtre. */}
        {views.length > 1 && (
          <div data-export-hide className="flex flex-wrap items-center gap-1" role="group" aria-label="Vue de l’évolution de l’audience">
            <span className="mr-1 text-xs text-muted-foreground">Aperçu&nbsp;:</span>
            {views.map((v) => (
              <Button
                key={v}
                size="sm"
                variant={step === v ? "default" : "outline"}
                aria-pressed={step === v}
                onClick={() => setChoice({ key, view: v })}
                className="h-7 px-3 text-xs"
              >
                {AUDIENCE_VIEW_LABELS[v]}
              </Button>
            ))}
          </div>
        )}
      </div>
    {/* Rapport : un graphique sans aucune valeur n'est pas capturé (son emplacement est retiré), comme les autres panneaux vides. */}
    <Panel
      bare
      title="Évolution de l’audience"
      info={definition("chartAudience", p)}
      {...(!forReport || hasAudience ? { reportKey: "audienceChart" } : {})}
    >
      {!hasAudience ? (
        <p className="text-sm text-muted-foreground">Donnée non disponible</p>
      ) : (
        <>
          <div className="h-80">
            <ResponsiveContainer>
              <LineChart data={points} margin={{ top: 5, right: 24, bottom: 5, left: 5 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={axis} minTickGap={24} />
                <YAxis tick={axis} tickFormatter={axisNumber} domain={["auto", "auto"]} />
                <Tooltip {...tip} labelFormatter={(_, items) => items?.[0]?.payload?.full ?? ""} />
                <Line dataKey="followers" name="Abonnés" stroke="var(--primary)" dot={audience.length <= 31} connectNulls={false} isAnimationActive={false} />
                {estimated && (
                  <Line dataKey="estimatedFollowers" name="Valeur estimée" stroke="none" dot={{ r: 4, fill: "var(--card)", stroke: "var(--primary)", strokeWidth: 2 }} activeDot={false} connectNulls={false} isAnimationActive={false} />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
          {estimated && <p className="mt-2 text-xs text-muted-foreground">Les points creux sont des valeurs estimées.</p>}
        </>
      )}
    </Panel>
    </section>
  );
}

export function PlatformView({ data, p, period, comparison }: ViewPeriods & { p: PlatformId; data: SocialData }) {
  const t = realBlendedTotals(p, data.days, data.posts, period, data.statuses, data.ads, data.adCoverage),
    o = realBlendedTotals(p, data.days, data.posts, comparison, data.statuses, data.ads, data.adCoverage);
  const [typeFilter, setTypeFilter] = useState<PostType | "Tous">("Tous");
  const [formatFilter, setFormatFilter] = useState("Tous");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "impressions", dir: "desc" });
  const [page, setPage] = useState(0);
  // Rendu hors écran pour le rapport : la mise en page suit l'hôte de 1352 px, pas la largeur de la fenêtre (les classes lg:/sm: sont des requêtes de fenêtre).
  const forReport = useContext(ReportRowLimit) !== undefined;
  const inPeriodPosts = data.posts
    .filter(
      (x) =>
        x.platform === p && x.published_at.slice(0, 10) >= period.start && x.published_at.slice(0, 10) <= period.end,
    )
    .map(postStats);
  // Publications d'avant la période, promues pendant celle-ci (liées nativement ou par le nom de l'annonce).
  const promotedPosts = data.promotedPosts
    .filter(
      (x) =>
        x.platform === p && !(x.published_at.slice(0, 10) >= period.start && x.published_at.slice(0, 10) <= period.end),
    )
    .map(postStats);
  const tableRows = [
    ...inPeriodPosts,
    ...promotedPosts,
    ...data.paidAds.filter((a) => a.platform === p).map(paidAdStats),
  ];
  // Les formats proposés sont ceux du tableau ; un format qui n'existe plus sur la période affichée revient à « Tous ».
  const formats = formatOptions(tableRows);
  const activeFormat = formats.includes(formatFilter) ? formatFilter : "Tous";
  const filteredRows = sortRows(
    tableRows.filter((x) => (typeFilter === "Tous" || x.type === typeFilter) && (activeFormat === "Tous" || x.format === activeFormat)),
    sort.key,
    sort.dir,
  );
  // Dix lignes par page ; la page suit les filtres et le tri (retour à la première) et ne dépasse jamais la dernière quand la période change.
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / TABLE_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const posts = filteredRows.slice(currentPage * TABLE_PAGE_SIZE, (currentPage + 1) * TABLE_PAGE_SIZE);
  const goToPage = (next: number) => {
    setPage(next);
    // Le tableau est haut : si son titre est sorti de l'écran, on le ramène en vue pour lire la page qui s'affiche depuis son début.
    const title = document.getElementById(navSlug("Performance des publications"));
    if (title && title.getBoundingClientRect().top < 0) title.scrollIntoView({ block: "start" });
  };
  // Un premier clic classe les chiffres du plus grand au plus petit, les textes de A à Z ; un second clic inverse.
  const sortBy = (key: SortKey) => {
    setPage(0);
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "desc" ? "asc" : "desc" }
        : { key, dir: key === "type" || key === "format" ? "asc" : "desc" },
    );
  };
  const tk = p === "tiktok";
  const D = (k: KpiKey) => definition(k, p);
  // Stories (Instagram uniquement, jamais ajoutées au Global : les impressions du compte les comprennent déjà).
  const st = storiesTotals(data.stories, data.storyPulls, period, { failed: data.storiesFailed }),
    so = storiesTotals(data.stories, data.storyPulls, comparison, { failed: data.storiesFailed });
  const best = topPosts(inPeriodPosts, promotedPosts);
  const flops = flopPosts(inPeriodPosts);

  return (
    <div className="space-y-8">
      <BigSection title="Activité" four={!tk}>
        <Kpi tooltip={D("followers")} note={followerNote(t)} label="Abonnés" value={shown(t, fmt(t.followers))} />
        <Kpi
          tooltip={D("newFollowers")}
          note={
            p === "linkedin" && t.newFollowers == null && period.end >= yesterdayISO()
              ? "LinkedIn publie ces gains avec 2 jours de retard"
              : undefined
          }
          label={tk ? "Nouveaux abonnés (variation nette)" : "Nouveaux abonnés"}
          prev={shown(
            o,
            o.newFollowers == null ? fmt(null) : `${o.newFollowers >= 0 ? "+" : ""}${fmt(o.newFollowers)}`,
          )}
          value={shown(
            t,
            t.newFollowers == null ? fmt(null) : `${t.newFollowers >= 0 ? "+" : ""}${fmt(t.newFollowers)}`,
          )}
          d={t.newFollowersProvisional ? undefined : delta(t.newFollowers, o.newFollowers)}
        />
        <Kpi
          tooltip={D("posts")}
          label={tk ? "Vidéos publiées" : "Publications"}
          prev={shown(o, nf.format(o.posts))}
          value={shown(t, nf.format(t.posts))}
          d={delta(t.posts, o.posts)}
        />
        {!tk && (
          <Kpi
            tooltip={D("videosPublished")}
            label="Vidéos publiées"
            prev={shown(o, fmt(o.videos))}
            value={shown(t, fmt(t.videos))}
            d={delta(t.videos, o.videos)}
          />
        )}
      </BigSection>
      <BigSection title="Visibilité">
        <Kpi
          {...coverageDetails(t, "impressions", D("impressions"))}
          label="Impressions totales"
          prev={shown(o, fmt(o.impressions))}
          value={shown(t, fmt(t.impressions))}
          d={comparableDelta(t, o, "impressions")}
        />
        <Kpi
          {...coverageDetails(t, "impressionsPerPost", D("impressionsPerPost"))}
          label="Impressions moy. / post"
          prev={shown(o, fmt(o.impressionsPerPost))}
          value={shown(t, fmt(t.impressionsPerPost))}
          d={comparableDelta(t, o, "impressionsPerPost")}
        />
        <Kpi
          {...coverageDetails(t, "videoViews", D("videoViews"))}
          note={[
            coverageDetails(t, "videoViews").note,
            videosNote(t),
          ]
            .filter(Boolean)
            .join(" · ")}
          label="Vues de vidéo"
          prev={shown(o, fmt(o.videoViews))}
          value={shown(t, fmt(t.videoViews))}
          d={t.videos === 0 && t.videoViews === 0 ? undefined : comparableDelta(t, o, "videoViews")}
        />
      </BigSection>
      <BigSection title="Engagement">
        <Kpi
          {...coverageDetails(t, "interactions", D("interactions"))}
          label="Interactions totales"
          prev={shown(o, fmt(o.interactions))}
          value={shown(t, fmt(t.interactions))}
          d={comparableDelta(t, o, "interactions")}
        />
        <Kpi
          {...coverageDetails(t, "engagementRate", D("engagementRate"))}
          label="Taux d'engagement (sur impressions)"
          prev={shown(o, pct(o.engagementRate))}
          pts={t.engagementRate != null && o.engagementRate != null ? t.engagementRate - o.engagementRate : undefined}
          value={shown(t, pct(t.engagementRate))}
          d={comparableDelta(t, o, "engagementRate")}
        />
        <Kpi
          tooltip={D("clicks")}
          note={
            p === "linkedin"
              ? "Publicité uniquement : LinkedIn ne distingue pas les clics sur liens en organique."
              : p === "instagram"
                ? "Publicité uniquement."
                : undefined
          }
          label="Clics sur les liens"
          prev={shown(o, fmt(o.clicks))}
          value={shown(t, fmt(t.clicks))}
          d={delta(t.clicks, o.clicks)}
        />
      </BigSection>
      {p === "instagram" && (
        <BigSection title="Stories" four>
          <Kpi
            tooltip={D("stories")}
            note={storyNote(st, "count", true)}
            label="Stories publiées"
            prev={fmt(so.count)}
            value={fmt(st.count)}
            d={storyDelta(st, so, "count")}
          />
          <Kpi
            tooltip={D("storyViews")}
            note={storyNote(st, "views")}
            label="Impressions des stories"
            prev={fmt(so.views)}
            value={fmt(st.views)}
            d={storyDelta(st, so, "views")}
          />
          <Kpi
            tooltip={D("storyViewsPerStory")}
            note={storyNote(st, "viewsPerStory")}
            label="Impressions moy. / story"
            prev={fmt(so.viewsPerStory)}
            value={fmt(st.viewsPerStory)}
            d={storyDelta(st, so, "viewsPerStory")}
          />
          <Kpi
            tooltip={D("storyInteractions")}
            note={storyNote(st, "interactions")}
            label="Interactions des stories"
            prev={fmt(so.interactions)}
            value={fmt(st.interactions)}
            d={storyDelta(st, so, "interactions")}
          />
        </BigSection>
      )}
      <BigSection title="Média">
        <Kpi
          tooltip={D("spend")}
          label="Budget dépensé"
          prev={shown(o, budget(o.spend))}
          value={shown(t, budget(t.spend))}
          d={delta(t.spend, o.spend)}
        />
        <Kpi
          label="Annonces diffusées"
          prev={shown(o, fmt(o.adsDelivered))}
          value={shown(t, fmt(t.adsDelivered))}
          d={delta(t.adsDelivered, o.adsDelivered)}
          tooltip={D("adsDelivered")}
        />
      </BigSection>
      <BigSection title="Coûts média">
        <Kpi
          tooltip={D("cpm")}
          label="CPM"
          prev={shown(o, eur(o.cpm, 2))}
          value={shown(t, eur(t.cpm, 2))}
          d={delta(t.cpm, o.cpm)}
          inverse
        />
        <Kpi
          tooltip={D("cpc")}
          label="CPC"
          prev={shown(o, eur(o.cpc, 2))}
          value={shown(t, eur(t.cpc, 2))}
          d={delta(t.cpc, o.cpc)}
          inverse
        />
        {tk ? (
          <Kpi
            label="CPV (coût par vue)"
            prev={shown(o, eur(o.cpv, 2))}
            value={shown(t, eur(t.cpv, 2))}
            d={delta(t.cpv, o.cpv)}
            inverse
            tooltip={D("cpv")}
          />
        ) : (
          <Kpi
            {...coverageDetails(t, "cpe", D("cpe"))}
            label="CPE (coût par engagement)"
            prev={shown(o, eur(o.cpe, 2))}
            value={shown(t, eur(t.cpe, 2))}
            d={comparableDelta(t, o, "cpe")}
            inverse
          />
        )}
      </BigSection>
      <AudienceEvolution days={data.days} p={p} period={period} />
      <section data-export-block className="space-y-3">
        <SectionTitle title="Formats et interactions" className="border-b pb-1 text-lg font-medium text-foreground" />
        <div className={cn("grid gap-6", forReport ? "grid-cols-2" : "lg:grid-cols-2")}>
          <Panel title="Publications par format" info={D("chartFormats")} reportKey="formats">
            <FormatList counts={formatCounts(data.posts, p, period)} />
          </Panel>
          <Panel title="Répartition des interactions" info={D("chartInteractions")} reportKey="interactions">
            <div className={cn("grid items-center gap-4", forReport ? "grid-cols-2" : "sm:grid-cols-2")}>
              <div className="h-52">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={t.interactionBreakdown.filter((x) => x.v != null)}
                      dataKey="v"
                      nameKey="name"
                      innerRadius={55}
                      outerRadius={85}
                      isAnimationActive={false}
                    >
                      {t.interactionBreakdown
                        .filter((x) => x.v != null)
                        .map((x) => (
                          <Cell key={x.name} fill={BRAND_COLORS[t.interactionBreakdown.indexOf(x) % BRAND_COLORS.length]} />
                        ))}
                    </Pie>
                    <Tooltip {...tip} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2">Interaction</th>
                    <th className="text-right">Volume</th>
                    <th className="text-right">%</th>
                  </tr>
                </thead>
                <tbody>
                  {t.interactionBreakdown.map((x, i) => (
                    <tr key={x.name} className="border-b">
                      <td className="py-2.5">
                        <span
                          className="mr-2 inline-block size-2.5 rounded-full"
                          style={{ background: BRAND_COLORS[i % BRAND_COLORS.length] }}
                        />
                        {x.name}
                      </td>
                      <td className="text-right">{fmt(x.v)}</td>
                      <td className="text-right">
                        {pct(x.v == null || !t.interactions ? null : (x.v / t.interactions) * 100)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </section>
      <TopPostCards best={best} p={p} hasPosts={inPeriodPosts.length + promotedPosts.length > 0} />
      <FlopCards flops={flops} p={p} hasPosts={inPeriodPosts.length > 0} />
      <section data-export-block className="space-y-3">
      <SectionTitle title="Performance des publications" className="border-b pb-1 text-lg font-medium text-foreground" />
      <Panel bare title="Performance des publications" info={D("topPosts")}>
        <div data-export-hide className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filtrer par type">
            <span className="mr-1 text-xs text-muted-foreground">Type&nbsp;:</span>
            {(["Tous", "Organique", "Paid"] as const).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={typeFilter === f ? "default" : "outline"}
                aria-pressed={typeFilter === f}
                onClick={() => {
                  setTypeFilter(f);
                  setPage(0);
                }}
                className="h-7 px-3 text-xs"
              >
                {f}
              </Button>
            ))}
          </div>
          {formats.length > 1 && (
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filtrer par format">
              <span className="mr-1 text-xs text-muted-foreground">Format&nbsp;:</span>
              {["Tous", ...formats].map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={activeFormat === f ? "default" : "outline"}
                  aria-pressed={activeFormat === f}
                  onClick={() => {
                    setFormatFilter(f);
                    setPage(0);
                  }}
                  className="h-7 px-3 text-xs"
                >
                  {f}
                </Button>
              ))}
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3 font-medium">Publication</th>
                <SortTh k="type" label="Type" sort={sort} onSort={sortBy} />
                <SortTh k="format" label="Format" sort={sort} onSort={sortBy} />
                <SortTh k="ts" label="Date" sort={sort} onSort={sortBy} />
                <SortTh k="impressions" label={tk ? "Vues" : "Impressions"} right sort={sort} onSort={sortBy} />
                <SortTh k="likes" label="J'aime" right sort={sort} onSort={sortBy} />
                <SortTh k="comments" label="Comm." right sort={sort} onSort={sortBy} />
                <SortTh k="shares" label="Partages" right sort={sort} onSort={sortBy} />
                <SortTh k="rate" label="Taux d’engagement" right sort={sort} onSort={sortBy} />
                <SortTh k="spend" label="Budget" right sort={sort} onSort={sortBy} />
                <SortTh k="cpe" label="CPE" right last sort={sort} onSort={sortBy} />
              </tr>
            </thead>
            <tbody>
              {posts.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-6 text-center text-muted-foreground">
                    {tableRows.length > 0 ? "Aucune publication pour ces filtres" : "Donnée non disponible"}
                  </td>
                </tr>
              ) : (
                posts.map((x) => (
                  <tr key={x.id} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="py-3 pr-3">
                      <div className="flex min-w-64 items-center gap-3">
                        <PostLink
                          href={x.permalink}
                          label={`Voir ${x.title}`}
                          className="shrink-0 rounded-md focus-visible:outline focus-visible:outline-ring"
                        >
                          {x.thumbnail_url ? (
                            <img
                              src={x.thumbnail_url}
                              alt={x.title}
                              loading="lazy"
                              width={80}
                              height={x.vertical ? 120 : 80}
                              className={cn("w-20 rounded-md object-cover", x.vertical ? "h-[120px]" : "h-20")}
                            />
                          ) : (
                            <MissingVisual format={x.format} className="h-20 w-20" />
                          )}
                        </PostLink>
                        <div className="min-w-0">
                          <PostLink
                            href={x.permalink}
                            title={x.title}
                            className="line-clamp-3 max-w-72 font-medium"
                            linkClassName="hover:text-primary hover:underline"
                          >
                            {x.title}
                          </PostLink>
                          {x.type === "Paid" && x.organic ? (
                            <p className="text-xs text-muted-foreground">+ organique</p>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="pr-3">
                      <TypeBadge type={x.type} />
                    </td>
                    <td className="pr-3">
                      <span className="rounded bg-muted px-2 py-0.5 text-xs">{x.format}</span>
                    </td>
                    <td className="pr-3 text-muted-foreground">{x.date}</td>
                    <td className="pr-3 text-right">{x.impressions == null ? "—" : nf.format(x.impressions)}</td>
                    <td className="pr-3 text-right">{nf.format(x.likes)}</td>
                    <td className="pr-3 text-right">{nf.format(x.comments)}</td>
                    <td className="pr-3 text-right">{nf.format(x.shares)}</td>
                    <td className="pr-3 text-right font-medium">{pct(x.rate)}</td>
                    <td className="pr-3 text-right">{x.spend == null ? "" : budget(x.spend)}</td>
                    <td className="text-right">{x.cpe == null ? "" : eur(x.cpe, 2)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filteredRows.length > TABLE_PAGE_SIZE && (
          <nav data-export-hide aria-label="Pages des publications" className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p role="status" className="text-xs text-muted-foreground">
              Publications {currentPage * TABLE_PAGE_SIZE + 1}–{currentPage * TABLE_PAGE_SIZE + posts.length} sur {filteredRows.length}
            </p>
            <div className="flex flex-wrap items-center gap-1">
              <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={currentPage === 0} onClick={() => goToPage(currentPage - 1)}>
                <ChevronLeft className="size-3.5" />
                Précédent
              </Button>
              {pageWindow(currentPage + 1, pageCount).map((n, i) =>
                n === "…" ? (
                  <span key={`gap-${i}`} aria-hidden className="px-1 text-xs text-muted-foreground">
                    …
                  </span>
                ) : (
                  <Button
                    key={n}
                    size="sm"
                    variant={n === currentPage + 1 ? "default" : "outline"}
                    aria-label={`Page ${n}`}
                    aria-current={n === currentPage + 1 ? "page" : undefined}
                    className="h-7 min-w-7 px-2 text-xs"
                    onClick={() => goToPage(n - 1)}
                  >
                    {n}
                  </Button>
                ),
              )}
              <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={currentPage >= pageCount - 1} onClick={() => goToPage(currentPage + 1)}>
                Suivant
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </nav>
        )}
      </Panel>
      </section>
      <AudienceSection rows={data.audience} p={p} />
    </div>
  );
}

/** En-tête de colonne triable : un bouton, avec l'état de tri pour les lecteurs d'écran. */
export function SortTh({
  k,
  label,
  sort,
  onSort,
  right = false,
  last = false,
}: {
  k: SortKey;
  label: string;
  sort: { key: SortKey; dir: "asc" | "desc" };
  onSort: (key: SortKey) => void;
  right?: boolean;
  last?: boolean;
}) {
  const active = sort.key === k;
  return (
    <th
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn("font-medium", !last && "pr-3", right && "text-right")}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn("inline-flex items-center gap-0.5 whitespace-nowrap hover:text-foreground", active && "text-foreground")}
      >
        {label}
        <span aria-hidden className="w-2 text-[10px]">
          {active ? (sort.dir === "asc" ? "▲" : "▼") : ""}
        </span>
      </button>
    </th>
  );
}

/** Pastilles de type aux couleurs de la palette du client : bleu (couleur primaire) pour l'organique, couleur d'accent de la marque pour le paid (texte du thème, lisible en clair et en sombre). */
export const TYPE_STYLE: Record<PostType, string> = {
  Organique: "bg-primary/15 text-foreground border-primary",
  Paid: "bg-brand-accent/15 text-foreground border-brand-accent",
};

export function TypeBadge({ type }: { type: PostType }) {
  return (
    <span className={cn("whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", TYPE_STYLE[type])}>
      {type}
    </span>
  );
}

/** Chiffres d'une carte Top post : celui qui classe la carte passe en tête (volume d'interactions pour l'engagement, CPM pour le CPM), les autres gardent leur ordre. */
function topPostFigures(post: PostStats, kind: "visibility" | "engagement" | "cpm") {
  const figures = [
    { key: "impressions", label: "Impressions / vues", value: fmt(post.impressions) },
    { key: "interactions", label: "Interactions", value: fmt(post.interactions) },
    { key: "rate", label: "Taux d’eng.", value: pct(post.rate) },
    { key: "spend", label: "Budget média", value: post.spend == null ? "—" : budget(post.spend) },
    { key: "cpm", label: "CPM", value: post.cpm == null ? "—" : eur(post.cpm, 2) },
  ];
  const first = kind === "engagement" ? "interactions" : kind === "cpm" ? "cpm" : "impressions";
  return [...figures.filter((f) => f.key === first), ...figures.filter((f) => f.key !== first)];
}

export function TopPostCard({
  title,
  post,
  kind,
  emptyNote,
  heading,
  reportKey,
}: {
  title: string;
  info?: string;
  post: PostStats | null;
  kind: "visibility" | "engagement" | "cpm";
  emptyNote?: string;
  /** Remplace le titre de la carte (cartes de publications du rapport : « Publication 1 »…). */
  heading?: string;
  reportKey?: string;
}) {
  // Rendu pour le rapport : les vignettes se chargent tout de suite (hors écran, le chargement différé ne partirait jamais).
  const forReport = useContext(ReportRowLimit) !== undefined;
  return (
    <div data-export-card {...reportAttr(reportKey)} className="min-w-0 rounded-lg border bg-card p-4">
      <div className="mb-3">
        <p className="text-xs font-medium uppercase text-muted-foreground">{heading ?? title}</p>
      </div>
      {!post ? (
        <p className="text-base text-muted-foreground">
          {emptyNote ?? (kind === "cpm" ? "Aucune publication du compte avec au moins 5 € de budget sur la période" : "Donnée non disponible")}
        </p>
      ) : (
        <div className="flex gap-3">
          <PostLink href={post.permalink} label={`Voir ${post.title}`} className="shrink-0">
            {post.thumbnail_url ? (
              <img
                src={post.thumbnail_url}
                alt={post.title}
                loading={forReport ? "eager" : "lazy"}
                className={cn("w-24 rounded-md object-cover", post.vertical ? "h-36" : "h-24")}
              />
            ) : (
              <MissingVisual format={post.format} className="h-24 w-24" />
            )}
          </PostLink>
          <div className="min-w-0 flex-1 space-y-1 text-sm">
            <PostLink
              href={post.permalink}
              className="line-clamp-2 font-medium"
              linkClassName="hover:text-primary hover:underline"
            >
              {post.title}
            </PostLink>
            <p className="text-xs text-muted-foreground">
              {post.date} · {post.format}
            </p>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
              {topPostFigures(post, kind).map((f) => (
                <Fragment key={f.key}>
                  <dt className="text-muted-foreground">{f.label}</dt>
                  <dd className="text-right font-medium">{f.value}</dd>
                </Fragment>
              ))}
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}

export function TopPostCards({ best, p, hasPosts }: { best: ReturnType<typeof topPosts>; p: PlatformId; hasPosts: boolean }) {
  const none = hasPosts ? {} : { emptyNote: "Aucune publication sur la période" };
  const forReport = useContext(ReportRowLimit) !== undefined;
  return (
    <section data-export-block className="space-y-3">
      <SectionTitle title="Top posts" className="border-b pb-1 text-lg font-medium text-foreground" />
      <div className={cn("grid gap-3", forReport ? "grid-cols-3" : "grid-cols-1 lg:grid-cols-3")}>
        <TopPostCard
          title="Visibilité"
          info={definition("topVisibility", p)}
          post={best.visibility}
          kind="visibility"
          reportKey="topPost-visibility"
          {...none}
        />
        <TopPostCard
          title="Engagement"
          info={definition("topEngagement", p)}
          post={best.engagement}
          kind="engagement"
          reportKey="topPost-engagement"
          {...none}
        />
        <TopPostCard title="CPM" info={definition("topCpm", p)} post={best.cpm} kind="cpm" reportKey="topPost-cpm" />
      </div>
    </section>
  );
}

const FLOP_EMPTY = "Pas assez de publications comparables sur la période (3 jours minimum après publication, chiffres connus)";

/** Une carte « Flops » : les publications de la période les moins performantes sur un critère, de la plus faible à la moins faible. */
export function FlopCard({
  title,
  rows,
  kind,
  p,
  emptyNote,
}: {
  title: string;
  info?: string;
  rows: PostStats[];
  kind: "visibility" | "engagement";
  p: PlatformId;
  emptyNote: string;
}) {
  const forReport = useContext(ReportRowLimit) !== undefined;
  const views = p === "tiktok" ? "vues" : "impressions";
  return (
    <div data-export-card className="min-w-0 rounded-lg border bg-card p-4">
      <div className="mb-3">
        <p className="text-xs font-medium uppercase text-muted-foreground">{title}</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-base text-muted-foreground">{emptyNote}</p>
      ) : (
        <ol className="space-y-3">
          {rows.map((post, i) => (
            <li key={post.id} className="flex gap-3">
              <span className="w-4 shrink-0 pt-0.5 text-xs font-medium text-muted-foreground">{i + 1}</span>
              <PostLink href={post.permalink} label={`Voir ${post.title}`} className="shrink-0">
                {post.thumbnail_url ? (
                  <img
                    src={post.thumbnail_url}
                    alt={post.title}
                    loading={forReport ? "eager" : "lazy"}
                    className="h-16 w-16 rounded-md object-cover"
                  />
                ) : (
                  <MissingVisual format={post.format} className="h-16 w-16" />
                )}
              </PostLink>
              <div className="min-w-0 flex-1 space-y-0.5 text-sm">
                <PostLink href={post.permalink} className="line-clamp-2 font-medium" linkClassName="hover:text-primary hover:underline">
                  {post.title}
                </PostLink>
                <p className="text-xs text-muted-foreground">
                  {post.date} · {post.format}
                  {post.type === "Paid" ? " · Paid" : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  <span className="text-sm font-semibold tabular-nums text-foreground">
                    {kind === "visibility" ? fmt(post.impressions) : pct(post.rate)}
                  </span>{" "}
                  {kind === "visibility"
                    ? [views, post.rate == null ? null : `${pct(post.rate)} d’eng.`].filter(Boolean).join(" · ")
                    : `d’eng. · ${fmt(post.interactions)} interactions · ${fmt(post.impressions)} ${views}`}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function FlopCards({ flops, p, hasPosts }: { flops: ReturnType<typeof flopPosts>; p: PlatformId; hasPosts: boolean }) {
  const none = hasPosts ? FLOP_EMPTY : "Aucune publication sur la période";
  const forReport = useContext(ReportRowLimit) !== undefined;
  return (
    <section data-export-block className="space-y-3">
      <SectionTitle title="Flop posts" className="border-b pb-1 text-lg font-medium text-foreground" />
      <div className={cn("grid gap-3", forReport ? "grid-cols-2" : "grid-cols-1 lg:grid-cols-2")}>
        <FlopCard title="Visibilité" info={definition("flopVisibility", p)} rows={flops.visibility.rows} kind="visibility" p={p} emptyNote={none} />
        <FlopCard title="Engagement" info={definition("flopEngagement", p)} rows={flops.engagement.rows} kind="engagement" p={p} emptyNote={none} />
      </div>
    </section>
  );
}

export function Bars({
  title,
  info,
  items: allItems,
  unit = "count",
  reportKey,
  complete = false,
}: {
  title: string;
  info: string;
  items: { label: string; value: number; percent: number }[];
  unit?: "count" | "percent";
  reportKey?: string;
  /** Répartition entière (sexe, âge) : jamais raccourcie dans le rapport. */
  complete?: boolean;
}) {
  // Rendu pour le rapport : les classements sont raccourcis pour rester lisibles sur une diapositive, et leur titre le dit (« top 6 »).
  const limit = useContext(ReportRowLimit);
  const cut = limit !== undefined && !complete && allItems.length > limit;
  const items = cut ? allItems.slice(0, limit) : allItems;
  const heading = cut ? title.replace(/top \d+/, `top ${limit}`) : title;
  // Un panneau vide n'est pas capturé : une image « Donnée non disponible » n'a rien à faire dans le rapport (son emplacement est retiré).
  return (
    <Panel title={heading} info={info} {...(reportKey && (limit === undefined || items.length > 0) ? { reportKey } : {})}>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Donnée non disponible</p>
      ) : (
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.label} className="text-sm">
              <div className="flex justify-between gap-2">
                <span className="truncate">{i.label}</span>
                <span className="shrink-0 font-medium">
                  {unit === "percent" ? pct(i.percent) : `${fmt(i.value)} · ${pct(i.percent)}`}
                </span>
              </div>
              <div className="mt-1 h-2 rounded bg-muted">
                <div className="h-2 rounded bg-primary" style={{ width: `${Math.min(100, i.percent)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function AudienceSection({ rows, p }: { rows: SocialData["audience"]; p: PlatformId }) {
  const a = audienceBreakdowns(
    rows.map((r) => ({ ...r, value: Number(r.value) })),
    p,
  );
  const unit = rows.find((r) => r.platform === p)?.unit === "percent" ? "percent" : "count";
  const empty = !rows.some((r) => r.platform === p);
  const forReport = useContext(ReportRowLimit) !== undefined;
  return (
    <section className="space-y-3">
      <h2 data-export-block {...navProps("Abonnés")} className={cn("border-b pb-1 text-lg font-medium", NAV_SCROLL)}>
        Abonnés
      </h2>
      {empty ? (
        <p data-export-block className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          Donnée non disponible
        </p>
      ) : (
        <div className={cn("grid gap-6", forReport ? "grid-cols-2" : "grid-cols-1 lg:grid-cols-2")}>
          {audiencePanels(p, a).map((x) => (
            // Sexe et tranches d'âge sont des répartitions complètes (la somme fait 100 %) : jamais raccourcies dans le rapport.
            <Bars key={x.key} title={x.title} info={definition(x.info, p)} items={x.items} reportKey={`audience-${x.key}`} complete={x.key === "gender" || x.key === "age"} {...(x.withUnit ? { unit } : {})} />
          ))}
        </div>
      )}
    </section>
  );
}
