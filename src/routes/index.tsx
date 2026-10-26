import { createFileRoute } from "@tanstack/react-router";
import { staleSyncLabel } from "@/lib/sync-staleness";
import { client } from "@/lib/client";
import { googleReportConfigured } from "@/lib/google-report-config";
import { Fragment, lazy, useEffect, useRef, useState, Suspense, type ComponentType, type CSSProperties } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { readSocialData } from "@/lib/social-data.functions";
import { type RealTotals } from "@/lib/social-totals";
import { Facebook, Instagram, LayoutGrid, Linkedin, Music2, Megaphone, Youtube, RefreshCw, Globe, Sun, Moon } from "lucide-react";
import { PLATFORMS, type PlatformId } from "@/lib/dashboard-data";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DashboardPeriodSelector } from "@/components/dashboard-period-selector";
import { comparisonFor, comparisonInSentence, lastDays, yesterdayISO, formatPeriod, type Period, type ComparisonMode } from "@/lib/dashboard-periods";
import { readGoogleAds } from "@/lib/google-ads.functions";
import { readYoutube } from "@/lib/youtube.functions";
import { ComparisonLabel, PeriodLine, budget, type Tab } from "@/components/dashboard/common";
import { PlatformView } from "@/components/dashboard/platform-view";
import { Overview } from "@/components/dashboard/overview";
import { TabBoundary } from "@/components/dashboard/tab-boundary";
import { useReportGenerator } from "@/components/dashboard/generate-report";
import { DashboardFooter } from "@/components/dashboard/footer";

// Les onglets rarement ouverts se chargent à la demande : le premier affichage n'embarque ni Google Ads, ni YouTube, ni Site web.
/** Importe un onglet à la demande ; si son fichier a disparu (nouvelle version publiée), recharge la page une seule fois. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyView<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load().catch((error) => {
      const key = "dashboard-chunk-reload";
      if (typeof window !== "undefined" && !sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, "1");
        window.location.reload();
        return new Promise<never>(() => undefined);
      }
      throw error;
    }),
  );
}
const GoogleAdsView = lazyView(() => import("@/components/dashboard/google-ads-view").then((m) => ({ default: m.GoogleAdsView })));
const YoutubeView = lazyView(() => import("@/components/dashboard/youtube-view").then((m) => ({ default: m.YoutubeView })));
const WebsiteView = lazyView(() => import("@/components/dashboard/website-view").then((m) => ({ default: m.WebsiteView })));

type NetworkRow = { p: PlatformId; current: RealTotals; previous: RealTotals };

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: client.brand.pageTitle },
      { name: "description", content: client.brand.pageDescription },
      { property: "og:title", content: client.brand.pageTitle },
      { property: "og:description", content: client.brand.pageDescription },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  // Essai du menu latéral : « ?menu=haut » rétablit les onglets en haut de page pour comparer.
  validateSearch: (search: Record<string, unknown>): { menu?: "haut" } => (search["menu"] === "haut" ? { menu: "haut" } : {}),
  component: Dashboard,
});

const ICONS: Record<Tab, typeof Facebook> = {
  overview: LayoutGrid,
  facebook: Facebook,
  instagram: Instagram,
  tiktok: Music2,
  linkedin: Linkedin,
  youtube: Youtube,
  google: Megaphone,
  web: Globe,
};

const tabLabel = (t: Tab) =>
  t === "overview" ? "Global" : t === "google" ? "Google Ads" : t === "youtube" ? "YouTube" : t === "web" ? "Google Analytics" : (PLATFORMS.find((p) => p.id === t)?.name ?? t);

/** Onglet d'ouverture : Global quand le client l'affiche (features.global), sinon son premier réseau. */
const FIRST_TAB: Tab = client.features.global ? "overview" : (PLATFORMS[0]?.id ?? "overview");

/** Onglets du dashboard : en ligne sous l'en-tête (petits écrans, ou « ?menu=haut »), en colonne à gauche sinon. */
type NavSection = { id: string; label: string };

/** Défile jusqu'à une partie de la page (sans animation si la personne l'a demandé au système). */
function scrollToSection(id: string) {
  const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(id)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
}

function TabNav({ tabs, tab, onSelect, vertical, sectionsByTab = {} }: { tabs: Tab[]; tab: Tab; onSelect: (t: Tab) => void; vertical: boolean; sectionsByTab?: Partial<Record<Tab, NavSection[]>> }) {
  return (
    <>
      {tabs.map((t) => {
        const Icon = ICONS[t];
        return (
          <Fragment key={t}>
          <Button
            variant="ghost"
            onClick={() => onSelect(t)}
            aria-current={tab === t ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 whitespace-nowrap text-sm font-medium transition-colors",
              vertical ? "h-auto w-full justify-start rounded-md px-3 py-2" : "h-auto rounded-none border-b-2 px-4 py-2.5",
              tab === t
                ? vertical ? "bg-muted text-primary" : "border-brand-accent text-primary"
                : vertical ? "text-muted-foreground hover:text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {tabLabel(t)}
          </Button>
          {/* Sous-menu : les parties de la page affichée, en ancres. Il se déroule à l'ouverture et se replie quand on change d'onglet (hauteur animée) ;
              la liste de l'onglet quitté reste en mémoire le temps de se refermer, et `inert` la retire du clavier et des lecteurs d'écran. */}
          {vertical && (tab === t || (sectionsByTab[t]?.length ?? 0) > 0) && (() => {
            const items = sectionsByTab[t] ?? [];
            const open = tab === t && items.length > 0;
            return (
              <div
                inert={!open}
                className={cn(
                  "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
                  open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                )}
              >
                <div className="min-h-0 overflow-hidden">
                  <ul aria-label={`Parties de ${tabLabel(t)}`} className="ml-5 space-y-0.5 border-l py-0.5 pl-2 pr-1">
                    {items.map((s) => (
                      <li key={s.id}>
                        <a
                          href={`#${s.id}`}
                          onClick={(event) => {
                            event.preventDefault();
                            scrollToSection(s.id);
                          }}
                          className="block rounded-sm px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {s.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })()}
          </Fragment>
        );
      })}
    </>
  );
}

function Dashboard() {
  const { menu } = Route.useSearch();
  const sideMenu = menu !== "haut";
  const [tab, setTab] = useState<Tab>(FIRST_TAB);
  // Le menu latéral reste collé sous l'en-tête, dont la hauteur varie (alerte de synchronisation, retours à la ligne).
  const headerRef = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  // Parties de la page affichée (titres marqués data-nav) : le menu de gauche les lit dans la page, il n'en tient pas de liste à part.
  const [sectionsByTab, setSectionsByTab] = useState<Partial<Record<Tab, NavSection[]>>>({});
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => setHeaderHeight(el.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const main = document.getElementById("dashboard-export");
    if (!main) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const seen = new Set<string>();
      const items: NavSection[] = [];
      for (const el of main.querySelectorAll<HTMLElement>("[data-nav]")) {
        const label = el.dataset["nav"] ?? "";
        // Un onglet quitté pendant le chargement du suivant reste monté, masqué : ses parties ne sont pas celles de l'onglet affiché.
        if (el.id && label && !seen.has(el.id) && el.getClientRects().length > 0) {
          seen.add(el.id);
          items.push({ id: el.id, label });
        }
      }
      setSectionsByTab((previous) => {
        const known = previous[tab] ?? [];
        // Pendant un rechargement des données la page est vide un instant : on garde la liste pour que le menu ne saute pas.
        if (items.length === 0 && known.length > 0) return previous;
        const same = known.length === items.length && known.every((x, i) => x.id === items[i]?.id);
        return same ? previous : { ...previous, [tab]: items };
      });
    };
    // Les onglets chargés à la demande (YouTube, Google Ads) n'ont leurs parties qu'une fois affichés : on relit à chaque changement de la page.
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(read);
    });
    observer.observe(main, { childList: true, subtree: true });
    read();
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [tab]);
  // Ouverture : les 30 derniers jours complets, jusqu'à hier à Paris (plus de date figée ni de recalcul après affichage).
  const [period, setPeriod] = useState<Period>(() => lastDays(30, yesterdayISO()));
  const [mode, setMode] = useState<ComparisonMode>("previous");
  // « Période personnalisée » ou raccourci d'édition (période nommée) : ses dates restent celles choisies quand la période affichée change.
  const [customComparison, setCustomComparison] = useState<Period | undefined>(undefined);
  const comparison = comparisonFor(period, mode, customComparison);
  const read = useServerFn(readSocialData);
  // « Actualiser » relit les données sans passer par le cache serveur de 2 minutes ; un changement de période l'utilise.
  const forceFresh = useRef(false);
  const social = useQuery({
    queryKey: ["social", period, comparison.period],
    queryFn: () => {
      const fresh = forceFresh.current;
      forceFresh.current = false;
      return read({ data: { period, comparison: comparison.period, ...(fresh ? { fresh: true } : {}) } });
    },
  });
  // Le reporting se lance depuis le cœur du pied de page de l'onglet Global (plus de bouton dans l'en-tête).
  const report = useReportGenerator({
    period,
    comparison: comparison.period,
    enabled: tab === "overview" && googleReportConfigured(),
    // Les images sont celles du dashboard pour la période et la comparaison choisies, rendues hors écran avec les mêmes données.
    captureImages: social.data
      ? async (hooks) => (await import("@/components/dashboard/report-capture")).captureReportImages({ data: social.data, period, comparison: comparison.period, ...hooks })
      : undefined,
  });
  const readGoogle = useServerFn(readGoogleAds);
  const gRange = {
    start: period.start < comparison.period.start ? period.start : comparison.period.start,
    end: period.end > comparison.period.end ? period.end : comparison.period.end,
  };
  const google = useQuery({ queryKey: ["google-ads", gRange], queryFn: () => readGoogle({ data: gRange }), enabled: client.features.googleAds });
  const readYt = useServerFn(readYoutube);
  // keepPreviousData : l'onglet YouTube ne disparaît pas pendant le chargement d'une nouvelle période.
  const youtube = useQuery({
    queryKey: ["youtube", gRange],
    queryFn: () => readYt({ data: gRange }),
    placeholderData: keepPreviousData,
    enabled: client.features.youtube,
  });
  // YouTube sert à « Tous réseaux » une fois connecté : tant que sa période charge ou si sa lecture échoue, Global le signale « partiel ».
  const youtubeSeen = useRef(false);
  if (youtube.data?.lastSuccess) youtubeSeen.current = true;
  const youtubeUnavailable = youtubeSeen.current && (youtube.isPlaceholderData || youtube.isError);
  const lastSync = social.data?.statuses
    .map((s) => s.last_success_at)
    .filter(Boolean)
    .sort()
    .at(-1);
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => setNowMs(Date.now()), [social.data]);
  const staleLabel =
    nowMs && social.data
      ? staleSyncLabel(
          social.data.statuses.filter((s) => (client.sources as string[]).includes(s.source)).map((s) => s.last_success_at),
          nowMs,
        )
      : null;
  const periodLine = mode === "custom" && customComparison && !customComparison.name
    ? `${period.name ?? formatPeriod(period)} · vs période personnalisée : ${formatPeriod(comparison.period)}`
    : period.name
    ? `${period.name} · vs ${comparisonInSentence(comparison.description)}`
    : `${formatPeriod(period)} · ${comparison.description} : ${formatPeriod(comparison.period)}`;
  const changePeriod = (next: Period) => {
    setPeriod(next);
    // Une édition choisie en comparaison ne peut pas être comparée à elle-même : si la période affichée devient cette édition, retour à la période précédente.
    if (mode === "custom" && customComparison?.name && customComparison.start === next.start && customComparison.end === next.end) setMode("previous");
  };

  const tabs = [...(client.features.global ? ["overview"] : []), ...PLATFORMS.map((p) => p.id),...(youtube.data?.lastSuccess ? ["youtube"] : []), ...(client.features.googleAds ? ["google"] : [])] as Tab[];

  return (
    <ComparisonLabel.Provider value={comparison.label}>
      <PeriodLine.Provider value={periodLine}>
        <div className="flex min-h-screen flex-col bg-background text-foreground" style={headerHeight ? ({ "--header-h": `${headerHeight}px` } as CSSProperties) : undefined}>
          <header ref={headerRef} className="sticky top-0 z-10 border-b bg-card">
            <div className="mx-auto flex min-h-[88px] max-w-[1400px] flex-wrap items-center gap-3 px-6 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  aria-label={`${client.brand.shortName} : retour à l’onglet ${tabLabel(FIRST_TAB)}`}
                  onClick={() => {
                    setTab(FIRST_TAB);
                    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
                  }}
                  className="brand-logo-wrap inline-flex shrink-0 cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <img src={client.brand.logo.url} alt="" className="h-9 w-auto object-contain" />
                </button>
                <div className="min-w-0">
                  <h1 className="text-base font-medium leading-tight">Dashboard de performances social media et web</h1>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {lastSync
                      ? `Données mises à jour le ${new Date(lastSync).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(" ", " à ")}`
                      : "Synchronisation en cours"}
                  </p>
                  {staleLabel && (
                    <p role="status" className="mt-1 text-xs font-medium text-destructive">
                      {staleLabel}
                    </p>
                  )}
                </div>
              </div>
              <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
                <DashboardPeriodSelector
                  period={period}
                  comparison={comparison.period}
                  mode={mode}
                  onPeriodChange={changePeriod}
                  onModeChange={setMode}
                  onCustomComparison={(next) => {
                    setCustomComparison(next);
                    setMode("custom");
                  }}
                />
                {/* Sur téléphone, la lune rejoint le bouton de période (ligne 1) ; la comparaison et « Actualiser » passent ligne 2. */}
                <Button
                  variant="outline"
                  className="shadow-none max-sm:order-2"
                  onClick={() => {
                    forceFresh.current = true;
                    void social.refetch();
                    if (client.features.googleAds) void google.refetch();
                    if (client.features.youtube) void youtube.refetch();
                  }}
                >
                  <RefreshCw className="h-4 w-4" />
                  Actualiser
                </Button>
                <ThemeToggle />
              </div>
            </div>
            <nav aria-label="Onglets" className={cn("mx-auto flex max-w-[1400px] gap-1 overflow-x-auto px-6", sideMenu && "lg:hidden")}>
              <TabNav tabs={tabs} tab={tab} onSelect={setTab} vertical={false} />
            </nav>
          </header>

          <div className="mx-auto flex w-full max-w-[1400px] flex-1 items-start gap-6 px-6">
          {sideMenu && (
            <aside
              data-export-hide
              className="sticky top-24 -mx-1 hidden w-44 shrink-0 overflow-y-auto px-1 py-6 lg:block"
              style={headerHeight ? { top: headerHeight + 8, maxHeight: `calc(100vh - ${headerHeight + 8}px)` } : undefined}
            >
              <nav aria-label="Onglets" className="flex flex-col gap-1">
                <TabNav tabs={tabs} tab={tab} onSelect={setTab} vertical sectionsByTab={sectionsByTab} />
              </nav>
            </aside>
          )}
          {/* Colonne de contenu : le pied de page se centre sur elle, sans compter le menu de gauche. */}
          <div className="flex min-w-0 flex-1 flex-col self-stretch">
          <main id="dashboard-export" className="w-full min-w-0 flex-1 space-y-6 py-6">
            <p className="text-xs text-muted-foreground">{periodLine}</p>
            {tab === "web" ? (
              <TabBoundary resetKey={tab}><Suspense fallback={<p className="text-sm text-muted-foreground">Chargement…</p>}><WebsiteView /></Suspense></TabBoundary>
            ) : tab === "youtube" ? (
              <TabBoundary resetKey={tab}><Suspense fallback={<p className="text-sm text-muted-foreground">Chargement…</p>}>
<YoutubeView
                data={youtube.data}
                google={google.data}
                loading={youtube.isLoading || youtube.isPlaceholderData}
                period={period}
                comparison={comparison.period}
              />
</Suspense></TabBoundary>
            ) : tab === "google" ? (
              <TabBoundary resetKey={tab}><Suspense fallback={<p className="text-sm text-muted-foreground">Chargement…</p>}>
<GoogleAdsView
                data={google.data}
                loading={google.isLoading}
                period={period}
                comparison={comparison.period}
              />
</Suspense></TabBoundary>
            ) : social.isLoading ? (
              <p className="text-sm text-muted-foreground">Chargement des données…</p>
            ) : !social.data ? (
              <p className="text-sm text-destructive">Source indisponible</p>
            ) : tab === "overview" ? (
              <Overview
                google={google.data}
                youtube={youtube.isPlaceholderData ? undefined : youtube.data}
                youtubeUnavailable={youtubeUnavailable}
                data={social.data}
                period={period}
                comparison={comparison.period}
              />
            ) : (
              <PlatformView key={tab} data={social.data} p={tab} period={period} comparison={comparison.period} />
            )}
          </main>
          <DashboardFooter className="px-0" onGenerate={tab === "overview" && googleReportConfigured() ? report.generate : undefined} generating={report.running || !social.data || social.isFetching} />
          </div>
          </div>
          {report.dialog}
        </div>
      </PeriodLine.Provider>
    </ComparisonLabel.Provider>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("dashboard-theme", next ? "dark" : "light");
  };
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="shadow-none max-sm:order-1"
      onClick={toggle}
      aria-label={dark ? "Passer en thème clair" : "Passer en thème sombre"}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
