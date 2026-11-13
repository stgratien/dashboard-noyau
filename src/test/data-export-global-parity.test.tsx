import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Overview } from "../components/dashboard/overview";
import { budget, eur, fmt, pct, type SocialData } from "../components/dashboard/common";
import { buildGlobalExport } from "../lib/data-export-global";
import { formatChangePercent, formatPoints, labelForValue } from "../lib/dashboard-format";
import type { YoutubeData } from "../lib/youtube";
import { coverage, days, posts } from "./fixtures/young-account";
import { youtubeConnected } from "./fixtures/youtube-account";

// Garde-fou : l'export de Global doit dire ce que dit l'écran. Chaque carte de l'onglet Global (rendu réel) est comparée à sa ligne de « Chiffres clés » : même valeur affichée, même présence
// d'une valeur comparée (« vs X » ou « vs — »), même variation (mêmes règles de couverture, même format), pour quatre paires de périodes et trois états de YouTube.
vi.mock("@/client/config", async () => (await import("@/test/fixtures/neutral-client")).neutralClientModule({ features: { dataExport: true } }));

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-03T10:00:00Z")); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const data = {
  days, posts, ads: [], adCoverage: coverage, statuses: [], promotedPosts: [], paidAds: [], stories: [], storyPulls: [], storiesFailed: false, unusableStatMonths: [],
  audience: [], adLinking: { rule: 0, manual: 0, unlinked: 0 }, statGapsFailed: false,
  adAudience: { rows: [], periods: [], failed: false }, pageAudience: { rows: [], periods: [], failed: false },
} as unknown as SocialData;

/** Le même compte, sans aucune vue de vidéo à partir du 15 juin (la période affichée) : la carte « Vues de vidéo » n'a alors aucune variation (0 vidéo publiée, 0 vue) alors que la première quinzaine en a. */
const noVideoViews = {
  ...data,
  days: days.map((d) => (d.day >= "2025-06-15" ? { ...d, metrics: { ...d.metrics, videoViews: 0 } } : d)),
  // Les vues de vidéo de TikTok sont celles des vidéos publiées dans la période : leurs impressions aussi sont à zéro.
  posts: posts.map((x) => (x.platform === "tiktok" && x.published_at >= "2025-06-15" ? { ...x, metrics: { ...x.metrics, impressions: 0 } } : x)),
} as unknown as SocialData;

const PAIRS = [
  ["juin / mai", { start: "2025-06-01", end: "2025-06-30" }, { start: "2025-05-01", end: "2025-05-31" }],
  ["juin / février", { start: "2025-06-01", end: "2025-06-30" }, { start: "2025-02-01", end: "2025-02-28" }],
  ["février / mai", { start: "2025-02-01", end: "2025-02-28" }, { start: "2025-05-01", end: "2025-05-31" }],
  ["février / janvier", { start: "2025-02-01", end: "2025-02-28" }, { start: "2025-01-01", end: "2025-01-31" }],
] as const;
const STATES: [string, YoutubeData | undefined, boolean][] = [
  ["sans YouTube", undefined, false],
  ["YouTube connecté", youtubeConnected, false],
  ["YouTube connecté mais illisible", undefined, true],
];

type Card = { label: string; value: string; vs: string | null; change: string | null };
/** Les cartes de l'écran : étiquette, valeur, ligne « vs … » et variation entre parenthèses. */
function cardsOf(container: HTMLElement): Card[] {
  return [...container.querySelectorAll<HTMLElement>("[data-export-card]")].map((card) => {
    const paragraphs = [...card.querySelectorAll("p")];
    const vs = paragraphs.find((p) => (p.textContent ?? "").startsWith("vs "));
    return { label: paragraphs[0]?.textContent ?? "", value: paragraphs[1]?.textContent ?? "", vs: vs ? (vs.textContent ?? "") : null, change: vs?.querySelector("span.font-medium")?.textContent ?? null };
  });
}

/** Comment l'écran écrit la valeur d'une carte (les mêmes fonctions que l'onglet). */
const display = (indicator: string, value: number | null) =>
  indicator === "Budget" ? budget(value) : indicator === "CPE moyen" || indicator === "CPM moyen" ? eur(value, 2) : indicator === "Taux d'engagement" ? pct(value) : fmt(value);

describe("l'export de Global dit ce que dit l'écran", () => {
  it("dit « Source indisponible » comme l'écran quand une source est en erreur et que la période n'a aucune donnée", () => {
    const failing = { ...data, statuses: [{ source: "linkedin_organic", state: "error", last_success_at: null }] } as unknown as SocialData;
    const period = { start: "2020-01-01", end: "2020-01-31" }, comparison = { start: "2025-05-01", end: "2025-05-31" };
    const model = buildGlobalExport({ data: failing, google: undefined, youtube: undefined, youtubeUnavailable: false, period, comparison, now: new Date("2026-11-03T10:30:00Z") });
    const { container } = render(<Overview data={failing} google={undefined} youtube={undefined} youtubeUnavailable={false} period={period} comparison={comparison} />);
    const cards = cardsOf(container);
    const empty = model.tables.find((t) => t.id === "keyFigures")!.rows.map((r) => r.values).filter((r) => r["period"] == null && !String(r["indicator"]).startsWith("Évolution des abonnés"));
    expect(empty.length).toBeGreaterThan(5);
    for (const row of empty) {
      const card = cards.find((c) => c.label === labelForValue(String(row["indicator"]), c.value));
      expect(card?.value, String(row["indicator"])).toBe("Source indisponible");
      expect(String(row["remark"]), String(row["indicator"])).toMatch(/^Source indisponible/);
    }
  });

  it("dit « Valeur estimée » comme l'écran quand les abonnés de la fin de période sont estimés", () => {
    const estimated = { ...data, days: days.map((d) => (d.day >= "2025-06-01" ? { ...d, followers_estimated: true } : d)) } as unknown as SocialData;
    const [, period, comparison] = PAIRS[0];
    const model = buildGlobalExport({ data: estimated, google: undefined, youtube: undefined, youtubeUnavailable: false, period, comparison, now: new Date("2026-11-03T10:30:00Z") });
    const { container } = render(<Overview data={estimated} google={undefined} youtube={undefined} youtubeUnavailable={false} period={period} comparison={comparison} />);
    const followers = model.tables.find((t) => t.id === "keyFigures")!.rows.find((r) => r.values["indicator"] === "Abonnés")!.values;
    expect(String(followers["remark"])).toContain("Valeur estimée");
    expect(cardsOf(container).find((c) => c.label === "Abonnés")).toBeTruthy();
    expect(container.textContent).toContain("Valeur estimée");
  });

  it("sans vue de vidéo ni vidéo publiée, la carte « Vues de vidéo » n'a aucune variation, ni à l'écran ni dans l'export", () => {
    const period = { start: "2025-06-15", end: "2025-06-30" }, comparison = { start: "2025-06-01", end: "2025-06-14" };
    const model = buildGlobalExport({ data: noVideoViews, google: undefined, youtube: undefined, youtubeUnavailable: false, period, comparison, now: new Date("2026-11-03T10:30:00Z") });
    const row = model.tables.find((t) => t.id === "keyFigures")!.rows.find((r) => r.values["indicator"] === "Vues de vidéo")!.values;
    expect(row["period"]).toBe(0);
    expect(row["change"]).toBeNull();
    const { container } = render(<Overview data={noVideoViews} google={undefined} youtube={undefined} youtubeUnavailable={false} period={period} comparison={comparison} />);
    const card = cardsOf(container).find((c) => c.label === labelForValue("Vues de vidéo", c.value));
    expect(card?.value).toBe("0");
    expect(card?.change).toBeNull();
  });

  for (const [state, youtube, youtubeUnavailable] of STATES) {
    for (const [name, period, comparison] of PAIRS) {
      it(`${state}, ${name} : valeur, valeur comparée et variation de chaque carte`, () => {
        const model = buildGlobalExport({ data, google: undefined, youtube, youtubeUnavailable, period, comparison, now: new Date("2026-11-03T10:30:00Z") });
        const { container } = render(<Overview data={data} google={undefined} youtube={youtube} youtubeUnavailable={youtubeUnavailable} period={period} comparison={comparison} />);
        const cards = cardsOf(container);
        const figures = model.tables.find((t) => t.id === "keyFigures")!.rows.map((r) => r.values).filter((r) => !String(r["indicator"]).startsWith("Évolution des abonnés"));
        // Chaque carte de l'écran a sa ligne dans l'export, et inversement.
        expect(cards.length).toBe(figures.length);
        for (const row of figures) {
          const indicator = String(row["indicator"]);
          const card = cards.find((c) => c.label === labelForValue(indicator, c.value));
          expect(card, `${state} ${name} : carte « ${indicator} » introuvable à l'écran`).toBeTruthy();
          if (!card) continue;
          expect(card.value, `${indicator} : valeur`).toBe(display(indicator, row["period"] as number | null));
          const screenPrevious = card.vs != null && !card.vs.startsWith("vs —");
          expect(row["compared"] != null, `${indicator} : valeur comparée (écran : ${card.vs ?? "aucune"})`).toBe(screenPrevious);
          if (screenPrevious) expect(card.vs, `${indicator} : valeur comparée affichée`).toContain(display(indicator, row["compared"] as number | null));
          const change = row["change"] as number | null;
          const expectedChange = change == null ? null : `(${row["changeUnit"] === "points" ? formatPoints(change) : formatChangePercent(change)})`;
          expect(card.change, `${indicator} : variation`).toBe(expectedChange);
        }
      });
    }
  }
});
