import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { PlatformView } from "../components/dashboard/platform-view";
import { pct, type SocialData } from "../components/dashboard/common";
import { buildDataExport, type DataExport } from "../lib/data-export";
import { formatChangePercent, formatPoints, labelForValue } from "../lib/dashboard-format";
import { coverage, days, posts } from "./fixtures/young-account";

// Garde-fou : l'export doit dire ce que dit l'écran. Chaque carte de l'onglet réseau (rendu réel) est comparée à sa ligne de « Chiffres clés » : même présence d'une valeur
// comparée (« vs X » ou « vs — »), même variation (mêmes règles de couverture, même format), et les parts des interactions sont celles du tableau de l'écran.
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

const PAIRS = [
  ["juin / mai", { start: "2025-06-01", end: "2025-06-30" }, { start: "2025-05-01", end: "2025-05-31" }],
  ["juin / février", { start: "2025-06-01", end: "2025-06-30" }, { start: "2025-02-01", end: "2025-02-28" }],
  ["février / mai", { start: "2025-02-01", end: "2025-02-28" }, { start: "2025-05-01", end: "2025-05-31" }],
  ["février / janvier", { start: "2025-02-01", end: "2025-02-28" }, { start: "2025-01-01", end: "2025-01-31" }],
] as const;

type Card = { label: string; value: string; vs: string | null; change: string | null };
/** Les cartes de chiffres clés de l'écran : étiquette, valeur, ligne « vs … » et variation entre parenthèses. */
function cardsOf(container: HTMLElement): Card[] {
  return [...container.querySelectorAll<HTMLElement>("[data-export-card]")].flatMap((card) => {
    const paragraphs = [...card.querySelectorAll("p")];
    const label = paragraphs[0]?.textContent ?? "";
    // Les cartes de publications (Top posts, Flops) ont une autre forme : seules celles dont l'étiquette est en capitales sont des chiffres clés.
    if (!paragraphs[0]?.className.includes("uppercase")) return [];
    const vs = paragraphs.find((p) => (p.textContent ?? "").startsWith("vs "));
    const change = vs?.querySelector("span.font-medium")?.textContent ?? null;
    return [{ label, value: paragraphs[1]?.textContent ?? "", vs: vs ? (vs.textContent ?? "") : null, change }];
  });
}

describe("l'export dit ce que dit l'écran", () => {
  for (const p of ["linkedin", "instagram", "tiktok", "facebook"] as const) {
    for (const [name, period, comparison] of PAIRS) {
      it(`${p}, ${name} : valeur comparée et variation de chaque carte`, () => {
        const model: DataExport = buildDataExport({ data, p, period, comparison, now: new Date("2026-11-03T10:30:00Z") });
        const { container } = render(<PlatformView data={data} p={p} period={period} comparison={comparison} />);
        const cards = cardsOf(container);
        expect(cards.length).toBeGreaterThan(8);
        const figures = model.tables.find((t) => t.id === "keyFigures")!.rows.map((r) => r.values).filter((r) => !String(r["indicator"]).startsWith("Évolution des abonnés"));
        for (const row of figures) {
          const indicator = String(row["indicator"]);
          const card = cards.find((c) => labelForValue(indicator, c.value) === c.label);
          expect(card, `${p} ${name} : carte « ${indicator} » introuvable à l'écran`).toBeTruthy();
          if (!card) continue;
          const screenPrevious = card.vs != null && !card.vs.startsWith("vs —");
          expect(row["compared"] != null, `${p} ${name} « ${indicator} » : valeur comparée (écran : ${card.vs ?? "aucune"})`).toBe(screenPrevious);
          const change = row["change"] as number | null;
          const expectedChange = change == null ? null : `(${row["changeUnit"] === "points" ? formatPoints(change) : formatChangePercent(change)})`;
          expect(card.change, `${p} ${name} « ${indicator} » : variation`).toBe(expectedChange);
        }
      });
    }
  }

  it("donne aux interactions les parts du tableau de l'écran (indisponibles quand le total l'est)", () => {
    const noShares = days.map((d) => (d.platform === "instagram" ? { ...d, metrics: { ...d.metrics, shares: null } } : d));
    for (const source of [data, { ...data, days: noShares } as unknown as SocialData]) {
      const [, period, comparison] = PAIRS[0];
      const model = buildDataExport({ data: source, p: "instagram", period, comparison, now: new Date("2026-11-03T10:30:00Z") });
      const { container } = render(<PlatformView data={source} p="instagram" period={period} comparison={comparison} />);
      const table = [...container.querySelectorAll("table")].find((t) => t.textContent?.includes("Interaction") && t.textContent.includes("Volume"));
      const screen = [...(table?.querySelectorAll("tbody tr") ?? [])].map((tr) => (tr.querySelectorAll("td")[2]?.textContent ?? ""));
      const shares = model.tables.find((t) => t.id === "interactions")!.rows.map((r) => pct(r.values["share"] as number | null));
      expect(shares).toEqual(screen);
      cleanup();
    }
  });
});
