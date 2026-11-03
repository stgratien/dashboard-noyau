import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { PageAudienceSection } from "../components/dashboard/page-audience-section";
import { ReportRowLimit } from "../components/dashboard/common";
import { formatNumber } from "../lib/dashboard-format";
import type { PageAudienceData } from "../lib/page-audience";

// Configuration neutre avec les visiteurs de la page activés (la source LinkedIn page en fait partie).
vi.mock("@/client/config", async () => (await import("@/test/fixtures/neutral-client")).neutralClientModule({ features: { pageAudience: true } }));

const period = { start: "2026-07-01", end: "2026-09-30" };
const comparison = { start: "2024-07-01", end: "2024-09-30" };
const reading = (range: { start: string; end: string }, returned = 3, total = 1000) => ({
  platform: "linkedin" as const, dimension: "companySize" as const, period_start: range.start, period_end: range.end,
  returned_count: returned, total_views: total, is_final: false, synced_at: "2026-11-03T08:00:00Z",
});
const value = (range: { start: string; end: string }, label: string, views: number) => ({
  platform: "linkedin" as const, dimension: "companySize" as const, period_start: range.start, period_end: range.end, label, views,
});
const data: PageAudienceData = {
  failed: false,
  periods: [reading(period, 3, 1000), reading(comparison, 2, 400)],
  rows: [
    value(period, "SIZE_11_TO_50", 600), value(period, "SIZE_10001_OR_MORE", 300), value(period, "SIZE_1", 100),
    value(comparison, "SIZE_11_TO_50", 300), value(comparison, "SIZE_10001_OR_MORE", 100),
  ],
};
const keys = (container: HTMLElement) => [...container.querySelectorAll("[data-report-image]")].map((el) => el.getAttribute("data-report-image"));
const panelOf = (container: HTMLElement) => container.querySelector('[data-report-image="visitors-companySize"]') as HTMLElement;

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-03T10:00:00Z")); });
afterEach(() => vi.useRealTimers());

describe("PageAudienceSection", () => {
  it("shows the section title as a menu anchor and says in a note that these are page views by staff range, not unique visitors", () => {
    const { container } = render(<PageAudienceSection data={data} p="linkedin" period={period} comparison={comparison} />);
    expect(screen.getByRole("heading", { name: "Visiteurs de la page" }).getAttribute("data-nav")).toBe("Visiteurs de la page");
    const note = screen.getByText(/ce sont des pages vues, pas des visiteurs uniques/);
    expect(note.textContent).toMatch(/taille d’entreprise/);
    expect(note.closest("[data-export-hide]")).not.toBeNull();
    for (const panel of container.querySelectorAll("[data-report-image]")) expect(panel.querySelector('[role="note"]')).toBeNull();
  });

  it("shows one panel with French labels ranked by page views, the page views, the share, and the comparison with its change", () => {
    const { container } = render(<PageAudienceSection data={data} p="linkedin" period={period} comparison={comparison} />);
    const panel = panelOf(container);
    expect(panel).toBeTruthy();
    expect(within(panel).getByText("Tailles d’entreprise des visiteurs (top 10)")).toBeTruthy();
    // Column legends: the unit is said (page views), in the report image too.
    expect(within(panel).getByText("Pages vues", { selector: "span.w-\\[5\\.5rem\\]" })).toBeTruthy();
    expect(within(panel).getByText("Part", { selector: "span.w-\\[5\\.5rem\\]" })).toBeTruthy();
    const items = [...panel.querySelectorAll("li")];
    expect(items.map((li) => li.querySelector("span")?.textContent?.replace(/[  ]/g, " "))).toEqual(["11-50 employés", "+ de 10 000 employés", "1 employé"]);
    const first = items[0]!;
    expect(first.textContent).toContain(formatNumber(600));
    // 600 of 1 000 page views: 60 % ; the compared value (300 page views) gives +100 %.
    expect(first.textContent).toContain("60%");
    expect(first.textContent).toContain(`vs ${formatNumber(300)}`);
    expect(first.textContent).toContain("(+100%)");
    expect(first.querySelector(".text-success")).not.toBeNull();
    // 300 against 100: +200 %, the share goes from 25 % to 30 % (+5 points).
    expect(items[1]?.textContent).toContain("(+200%)");
    expect(items[1]?.textContent).toContain("(+5,0pt)");
  });

  it("colours a drop in destructive and leaves a value missing from the comparison at « — », never zero", () => {
    const fell: PageAudienceData = {
      failed: false, periods: [reading(period, 2, 1000), reading(comparison, 1, 1000)],
      rows: [value(period, "SIZE_11_TO_50", 200), value(period, "SIZE_1", 100), value(comparison, "SIZE_11_TO_50", 800)],
    };
    const { container } = render(<PageAudienceSection data={fell} p="linkedin" period={period} comparison={comparison} />);
    const items = [...panelOf(container).querySelectorAll("li")];
    expect(items[0]?.textContent).toContain("(−75%)");
    expect(items[0]?.querySelector(".text-destructive")).not.toBeNull();
    const missing = items[1]!;
    expect(missing.textContent).toContain("vs —");
    expect(missing.textContent).not.toMatch(/vs 0\b/);
    expect(missing.querySelector(".text-success, .text-destructive")).toBeNull();
  });

  it("tags the panel once for the report, with the key visitors-companySize", () => {
    const { container } = render(<PageAudienceSection data={data} p="linkedin" period={period} comparison={comparison} />);
    expect(keys(container)).toEqual(["visitors-companySize"]);
  });

  it("explains how to see it, and draws no panel, for a period that is not a closed quarter or edition", () => {
    const { container } = render(<PageAudienceSection data={data} p="linkedin" period={{ start: "2026-10-04", end: "2026-11-02" }} comparison={{ start: "2026-09-04", end: "2026-10-03" }} />);
    expect(screen.getByText(/Les visiteurs par taille d’entreprise se relèvent par trimestre ou par édition terminés/)).toBeTruthy();
    expect(keys(container)).toEqual([]);
  });

  it("says a closed quarter is not read yet, and a failed read is unavailable (never an absence)", () => {
    const { rerender } = render(<PageAudienceSection data={{ rows: [], periods: [], failed: false }} p="linkedin" period={period} comparison={comparison} />);
    expect(screen.getByText(/ne sont pas encore relevés/)).toBeTruthy();
    rerender(<PageAudienceSection data={{ rows: [], periods: [], failed: true }} p="linkedin" period={period} comparison={comparison} />);
    expect(screen.getByText(/momentanément indisponibles/)).toBeTruthy();
    expect(screen.queryByText(/ne sont pas encore relevés/)).toBeNull();
  });

  it("says « Aucune visite » for a reading that returned nothing, and nothing else is drawn as data", () => {
    const empty: PageAudienceData = { failed: false, periods: [reading(period, 0, 0)], rows: [] };
    const { container } = render(<PageAudienceSection data={empty} p="linkedin" period={period} comparison={comparison} />);
    expect(within(panelOf(container)).getByText("Aucune visite sur la période")).toBeTruthy();
    expect(panelOf(container).querySelectorAll("li")).toHaveLength(0);
  });

  it("says inside the panel, so also in the report image, that the compared period has no reading, and shows no « vs » line then", () => {
    const only = { ...data, periods: [reading(period)], rows: [value(period, "SIZE_11_TO_50", 600)] };
    const { container } = render(<PageAudienceSection data={only} p="linkedin" period={period} comparison={comparison} />);
    const panel = panelOf(container);
    expect(within(panel).getByText("Comparaison non disponible : la période comparée n’est pas relevée.")).toBeTruthy();
    expect(panel.closest("[data-export-hide]")).toBeNull();
    expect(panel.querySelector("[data-export-hide]")).toBeNull();
    expect(panel.textContent).not.toMatch(/vs /);
    expect(screen.getByText(/La période comparée n’a pas de visiteurs de la page relevés/)).toBeTruthy();
    // With a reading for the compared period the sentence is not there.
    const both = render(<PageAudienceSection data={data} p="linkedin" period={period} comparison={comparison} />);
    expect(within(panelOf(both.container)).queryByText(/Comparaison non disponible/)).toBeNull();
  });

  it("shows at most 10 values and says how many the network returned", () => {
    const many = Array.from({ length: 14 }, (_, i) => value(period, `Range ${i}`, 1000 - i));
    const rich: PageAudienceData = { failed: false, periods: [reading(period, 14, 14000)], rows: many };
    const { container } = render(<PageAudienceSection data={rich} p="linkedin" period={period} comparison={comparison} />);
    expect(panelOf(container).querySelectorAll("li")).toHaveLength(10);
    expect(within(panelOf(container)).getByText(/10 valeurs les plus vues sur/)).toBeTruthy();
  });

  it("renders nothing for a network whose page does not provide it", () => {
    const { container } = render(<PageAudienceSection data={data} p="facebook" period={period} comparison={comparison} />);
    expect(container.innerHTML).toBe("");
  });

  it("for the report, keeps the legend, has no window class (lg:/sm:) in the captured block, and does not tag an empty panel", () => {
    const { container } = render(
      <ReportRowLimit.Provider value={6}>
        <PageAudienceSection data={data} p="linkedin" period={period} comparison={comparison} />
      </ReportRowLimit.Provider>,
    );
    const panel = panelOf(container);
    expect(panel.querySelectorAll("li")).toHaveLength(3);
    // L'image du rapport garde la légende des colonnes (rien d'autre ne les nomme) et ne dépend d'aucune classe de fenêtre, qui varierait avec la fenêtre de capture.
    expect(within(panel).getByText("Pages vues", { selector: "span.w-\\[5\\.5rem\\]" })).toBeTruthy();
    expect(panel.innerHTML).not.toMatch(/(?:^|[\s"])(?:sm|md|lg|xl):/);
    expect(container.querySelector(".grid")?.className).toContain("grid-cols-2");
    expect(container.querySelector(".grid")?.className).not.toMatch(/(?:sm|md|lg|xl):/);
    expect(keys(container)).toEqual(["visitors-companySize"]);
    const empty = render(
      <ReportRowLimit.Provider value={6}>
        <PageAudienceSection data={{ failed: false, periods: [reading(period, 0, 0)], rows: [] }} p="linkedin" period={period} comparison={comparison} />
      </ReportRowLimit.Provider>,
    );
    expect(keys(empty.container)).toEqual([]);
  });

  it("keeps the responsive classes on screen only (phones get a caption in each cell, desktop a column header)", () => {
    const { container } = render(<PageAudienceSection data={data} p="linkedin" period={period} comparison={comparison} />);
    expect(panelOf(container).innerHTML).toMatch(/sm:flex/);
  });
});
