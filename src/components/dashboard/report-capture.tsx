import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { PLATFORMS, type PlatformId } from "@/lib/dashboard-data";
import type { Period } from "@/lib/dashboard-periods";
import { captureRenderedBlock, exportContainer, reportFontCss } from "@/lib/pdf-export";
import type { CaptureHooks } from "@/lib/google-report";
import { postStats, sortRows } from "@/lib/top-posts";
import { ComparisonLabel, PeriodLine, ReportRowLimit, type SocialData } from "@/components/dashboard/common";
import { PlatformView, TopPostCard } from "@/components/dashboard/platform-view";

/** Nombre de publications exportées en cartes pour la diapositive « Publications » de chaque réseau. */
export const REPORT_POST_CARDS = 6;
/** Lignes maximum des listes d'audience dans les images du rapport (lisibles sur une diapositive). */
export const REPORT_ROWS = 6;
/** Largeur de l'hôte hors écran : celle du contenu du dashboard (1400 px moins ses marges). */
const HOST_WIDTH = 1352;
/** Délai maximum d'attente d'une vignette, puis d'une capture : au-delà, l'image est ignorée et signalée. */
const IMAGE_TIMEOUT_MS = 8000;
const CAPTURE_TIMEOUT_MS = 20000;
/** Attente maximale, en tout, d'un onglet caché : html-to-image attend requestAnimationFrame, suspendu dans un onglet caché (chaque capture irait au bout des 20 s). */
const HIDDEN_WAIT_MS = 5 * 60_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Rend la main au bout de `ms` : un chargement ou un dessin qui ne finit jamais ne doit pas figer toute la génération du rapport. */
const within = <T,>(work: Promise<T>, ms: number, fallback: T) => Promise.race([work, sleep(ms).then(() => fallback)]);
const now = () => performance.now();

/** Attend que l'onglet soit visible (au plus `budget.left` ms en tout, puis on continue comme avant) ; s'arrête aussi quand `signal` est levé. */
async function whenVisible(budget: { left: number }, signal?: AbortSignal) {
  if (document.visibilityState !== "hidden" || budget.left <= 0 || signal?.aborted) return;
  const began = now();
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onChange);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const onChange = () => { if (document.visibilityState !== "hidden") done(); };
    const timer = setTimeout(done, budget.left);
    document.addEventListener("visibilitychange", onChange);
    signal?.addEventListener("abort", done);
  });
  budget.left -= now() - began;
}

/** Somme des règles CSS des feuilles lisibles de la page (une feuille d'une autre origine, comme Google Fonts, est illisible et ignorée). */
function cssRuleCount() {
  let total = 0;
  try {
    for (const sheet of Array.from(document.styleSheets)) {
      try { total += sheet.cssRules.length; } catch { /* feuille illisible */ }
    }
  } catch { /* feuilles indisponibles */ }
  return total;
}

/** Mesures de la capture : console.info seulement (jamais affichées ni envoyées), durées, nombres et octets, rien d'autre. */
function createCaptureStats() {
  const phases: Record<string, number> = {};
  const captureMs: number[] = [];
  const sizes: number[] = [];
  let phaseBegan = now();
  let hiddenMs = 0;
  let hiddenSince: number | null = document.visibilityState === "hidden" ? now() : null;
  const onVisibility = () => {
    if (document.visibilityState === "hidden") hiddenSince ??= now();
    else if (hiddenSince !== null) { hiddenMs += now() - hiddenSince; hiddenSince = null; }
  };
  document.addEventListener("visibilitychange", onVisibility);
  const rulesBefore = cssRuleCount();
  return {
    /** Ferme la phase en cours (rendu et attente, puis police) et ouvre la suivante. */
    phase: (name: string) => { const t = now(); phases[name] = Math.round(t - phaseBegan); phaseBegan = t; },
    capture: (ms: number, size: number | null) => { captureMs.push(Math.round(ms)); if (size !== null) sizes.push(size); },
    log: (captures: number) => {
      document.removeEventListener("visibilitychange", onVisibility);
      try {
        if (hiddenSince !== null) hiddenMs += now() - hiddenSince;
        console.info("[rapport] capture", {
          ...phases,
          captures,
          sumCaptureMs: captureMs.reduce((a, b) => a + b, 0),
          maxCaptureMs: Math.max(0, ...captureMs),
          // Une durée qui monte d'une capture à l'autre trahit le cumul des polices ; les règles CSS de la page le confirment.
          firstMs: captureMs.slice(0, 5),
          lastMs: captureMs.slice(-5),
          sumBytes: sizes.reduce((a, b) => a + b, 0),
          maxBytes: Math.max(0, ...sizes),
          hiddenMs: Math.round(hiddenMs),
          cssRulesBefore: rulesBefore,
          cssRulesAfter: cssRuleCount(),
        });
      } catch { /* journal indisponible */ }
    },
  };
}

/** Les publications de la période (et celles d'avant, promues pendant), classées par impressions : le tri par défaut du tableau Top publications. */
export function reportPosts(data: SocialData, p: PlatformId, period: Period) {
  const inPeriod = (day: string) => day >= period.start && day <= period.end;
  const rows = [
    ...data.posts.filter((x) => x.platform === p && inPeriod(x.published_at.slice(0, 10))).map(postStats),
    ...data.promotedPosts.filter((x) => x.platform === p && !inPeriod(x.published_at.slice(0, 10))).map(postStats),
  ];
  return sortRows(rows, "impressions", "desc").slice(0, REPORT_POST_CARDS);
}

/** Les quatre réseaux rendus tels qu'à l'écran, dans un hôte hors écran à jeton clair ; chaque bloc marqué data-report-image est capturé. */
function CaptureTree({ data, period, comparison, networks }: { data: SocialData; period: Period; comparison: Period; networks: PlatformId[] }) {
  return (
    <ComparisonLabel.Provider value="">
      <PeriodLine.Provider value="">
        <ReportRowLimit.Provider value={REPORT_ROWS}>
          {networks.map((p) => (
            <div key={p} data-report-net={p} className="space-y-8">
              <PlatformView data={data} p={p} period={period} comparison={comparison} />
              <div data-report-posts style={{ width: 440 }} className="space-y-3">
                {reportPosts(data, p, period).map((post, i) => (
                  <TopPostCard key={post.id} title="Publication" heading={`Publication ${i + 1}`} post={post} kind="visibility" reportKey={`post-${i + 1}`} />
                ))}
              </div>
            </div>
          ))}
        </ReportRowLimit.Provider>
      </PeriodLine.Provider>
    </ComparisonLabel.Provider>
  );
}

/** Attend que les graphiques (SVG) et les vignettes des blocs capturés soient prêts : une mise en page hors écran se mesure en plusieurs images. */
async function settle(host: HTMLElement) {
  await document.fonts.ready;
  for (let i = 0; i < 20; i++) {
    const charts = host.querySelectorAll(".recharts-responsive-container");
    const drawn = host.querySelectorAll(".recharts-responsive-container svg.recharts-surface");
    if (charts.length === drawn.length) break;
    await sleep(150);
  }
  // Hors écran, le navigateur ne charge jamais une image « lazy » : on force le chargement de celles des blocs capturés, avec un délai maximum.
  // Les vignettes du tableau des publications et des Flops ne sont jamais capturées (leur taille est fixée dans la page) : on ne les attend pas.
  await Promise.all(
    [...host.querySelectorAll<HTMLImageElement>("[data-report-image] img")].map((image) => {
      image.loading = "eager";
      return within(image.decode().catch(() => undefined), IMAGE_TIMEOUT_MS, undefined);
    }),
  );
  await sleep(400);
}

export type CapturedImages = Record<string, Blob>;

/**
 * Images du rapport : `<réseau>.<bloc>` → PNG (« linkedin.formats », « facebook.audience-country », « tiktok.post-1 »…).
 * Un bloc absent (panneau vide, moins de six publications) n'a pas d'image ; un bloc qui échoue est ignoré et listé dans `failed`.
 * `onImage` reçoit chaque PNG dès qu'il est prêt ; `signal` arrête la capture au prochain bloc (les images déjà prises sont rendues).
 */
export async function captureReportImages({ data, period, comparison, networks = PLATFORMS.map((x) => x.id), onProgress, onImage, signal }: {
  data: SocialData; period: Period; comparison: Period; networks?: PlatformId[]; onProgress?: (done: number, total: number) => void;
} & CaptureHooks): Promise<{ images: CapturedImages; failed: string[] }> {
  const images: CapturedImages = {};
  const failed: string[] = [];
  if (signal?.aborted) return { images, failed };
  const hiddenWait = { left: HIDDEN_WAIT_MS };
  const host = exportContainer(HOST_WIDTH);
  const root = createRoot(host);
  const stats = createCaptureStats();
  let done = 0;
  try {
    flushSync(() => root.render(<CaptureTree data={data} period={period} comparison={comparison} networks={networks} />));
    await whenVisible(hiddenWait, signal);
    await settle(host);
    stats.phase("settleMs");
    if (signal?.aborted) return { images, failed };
    const targets = [...host.querySelectorAll<HTMLElement>("[data-report-net]")].flatMap((net) =>
      [...net.querySelectorAll<HTMLElement>("[data-report-image]")].map((el) => ({ tag: `${net.dataset["reportNet"]}.${el.dataset["reportImage"]}`, el })),
    );
    // Polices web : calculées une fois pour tout l'hôte (voir reportFontCss) ; sans résultat, chaque capture les calcule elle-même, comme avant.
    const fontEmbedCSS = await reportFontCss(host);
    stats.phase("fontCssMs");
    for (const { tag, el } of targets) {
      if (signal?.aborted) break;
      await whenVisible(hiddenWait, signal);
      if (signal?.aborted) break;
      const began = now();
      let size: number | null = null;
      try {
        const blob = await within<Blob | null>(captureRenderedBlock(el, fontEmbedCSS), CAPTURE_TIMEOUT_MS, null);
        if (blob) {
          images[tag] = blob;
          size = blob.size;
          try { onImage?.(tag, blob); } catch { /* l'envoi ne doit pas faire échouer la capture */ }
        } else failed.push(tag);
      } catch { failed.push(tag); }
      stats.capture(now() - began, size);
      onProgress?.(++done, targets.length);
      await sleep(0);
    }
    return { images, failed };
  } finally {
    root.unmount();
    host.remove();
    stats.log(done);
  }
}
