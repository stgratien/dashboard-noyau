import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { PageAudienceSection } from "../components/dashboard/page-audience-section";
import { ReportRowLimit } from "../components/dashboard/common";
import type { PageAudienceData, PageAudienceDimension } from "../lib/page-audience";

// Configuration neutre avec les tailles d'entreprise activées.
vi.mock("@/client/config", async () => (await import("@/test/fixtures/neutral-client")).neutralClientModule({ features: { pageAudience: true } }));

const period = { start: "2026-04-01", end: "2026-06-30" };
const comparison = { start: "2025-04-01", end: "2025-06-30" };
const nb = (s: string | null | undefined) => (s ?? "").replace(/[  ]/g, " ");
const reading = (range: { start: string; end: string }, dimension: PageAudienceDimension, returned: number, total: number) => ({
  platform: "linkedin" as const, dimension, period_start: range.start, period_end: range.end,
  returned_count: returned, total_views: total, is_final: true, synced_at: "2026-11-03T08:00:00Z",
});
const value = (range: { start: string; end: string }, dimension: PageAudienceDimension, label: string, views: number) => ({
  platform: "linkedin" as const, dimension, period_start: range.start, period_end: range.end, label, views,
});
// Invented figures with the shape of a typical report slide: visitors then followers, the period and the one before, five sizes at most (four for the compared period).
const data: PageAudienceData = {
  failed: false,
  periods: [
    reading(period, "companySize", 5, 20000), reading(comparison, "companySize", 4, 20000),
    reading(period, "followersCompanySize", 5, 50000), reading(comparison, "followersCompanySize", 4, 40000),
  ],
  rows: [
    value(period, "companySize", "SIZE_10001_OR_MORE", 6000), value(period, "companySize", "SIZE_1001_TO_5000", 3100), value(period, "companySize", "SIZE_11_TO_50", 2400),
    value(period, "companySize", "SIZE_51_TO_200", 2000), value(period, "companySize", "SIZE_201_TO_500", 1400),
    value(comparison, "companySize", "SIZE_10001_OR_MORE", 4800), value(comparison, "companySize", "SIZE_1001_TO_5000", 2400),
    value(comparison, "companySize", "SIZE_51_TO_200", 1600), value(comparison, "companySize", "SIZE_11_TO_50", 1200),
    value(period, "followersCompanySize", "SIZE_10001_OR_MORE", 15000), value(period, "followersCompanySize", "SIZE_1001_TO_5000", 8250),
    value(period, "followersCompanySize", "SIZE_51_TO_200", 6000), value(period, "followersCompanySize", "SIZE_11_TO_50", 4000),
    value(period, "followersCompanySize", "SIZE_201_TO_500", 3000),
    value(comparison, "followersCompanySize", "SIZE_10001_OR_MORE", 11200), value(comparison, "followersCompanySize", "SIZE_1001_TO_5000", 6000),
    value(comparison, "followersCompanySize", "SIZE_51_TO_200", 4000), value(comparison, "followersCompanySize", "SIZE_11_TO_50", 3200),
  ],
};
const keys = (container: HTMLElement) => [...container.querySelectorAll("[data-report-image]")].map((el) => el.getAttribute("data-report-image"));
const panelOf = (container: HTMLElement, key: string) => container.querySelector(`[data-report-image="${key}"]`) as HTMLElement;
const lines = (panel: HTMLElement) => [...panel.querySelectorAll("li p")].map((p) => nb(p.textContent));

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-03T10:00:00Z")); });
afterEach(() => vi.useRealTimers());

describe("PageAudienceSection", () => {
  it("shows the section title as a menu anchor, with a note on where the figures come from", () => {
    render(<PageAudienceSection data={data} p="linkedin" period={period} comparison={comparison} />);
    expect(screen.getByRole("heading", { name: "Tailles d’entreprise" }).getAttribute("data-nav")).toBe("Tailles d’entreprise");
    const note = screen.getByText(/Chiffres relevés dans les statistiques de la page du réseau/);
    expect(note.textContent).toMatch(/les cinq tailles les plus nombreuses/i);
    expect(note.closest("[data-export-hide]")).not.toBeNull();
  });

  it("has four blocks: visitors then followers, the period on the left, the compared one on the right, five sizes at most", () => {
    const { container } = render(<PageAudienceSection data={data} p="linkedin" period={period} comparison={comparison} />);
    const visitors = panelOf(container, "visitors-companySize");
    const followers = panelOf(container, "followers-companySize");
    expect([...visitors.querySelectorAll("h3")].map((h) => h.textContent)).toEqual(["Visiteurs T2 2026", "Visiteurs T2 2025"]);
    expect([...followers.querySelectorAll("h3")].map((h) => h.textContent)).toEqual(["Abonnés T2 2026", "Abonnés T2 2025"]);
    expect(lines(visitors)).toEqual([
      "+ de 10 000 employés · 6 000 (30%)", "1001-5 000 employés · 3 100 (15,5%)", "11-50 employés · 2 400 (12%)", "51-200 employés · 2 000 (10%)", "201-500 employés · 1 400 (7%)",
      "+ de 10 000 employés · 4 800 (24%)", "1001-5 000 employés · 2 400 (12%)", "51-200 employés · 1 600 (8%)", "11-50 employés · 1 200 (6%)",
    ]);
    expect(lines(followers)).toEqual([
      "+ de 10 000 employés · 15 000 (30%)", "1001-5 000 employés · 8 250 (16,5%)", "51-200 employés · 6 000 (12%)", "11-50 employés · 4 000 (8%)", "201-500 employés · 3 000 (6%)",
      "+ de 10 000 employés · 11 200 (28%)", "1001-5 000 employés · 6 000 (15%)", "51-200 employés · 4 000 (10%)", "11-50 employés · 3 200 (8%)",
    ]);
  });

  it("draws the bars in proportion to the share, on one scale for both columns", () => {
    const { container } = render(<PageAudienceSection data={data} p="linkedin" period={period} comparison={comparison} />);
    const widths = [...panelOf(container, "visitors-companySize").querySelectorAll("li .bg-primary")].map((bar) => parseFloat((bar as HTMLElement).style.width));
    // 30 % is the biggest share of both columns: a full bar; 24 % (the compared period's first size) is 80 % of it.
    expect(widths[0]).toBeCloseTo(100, 5);
    expect(widths[5]).toBeCloseTo(80, 5);
  });

  it("shows « — » for the share of a partial list whose total is unknown, never an inflated share", () => {
    const partial: PageAudienceData = { failed: false, periods: [{ ...reading(period, "companySize", 9, 0), total_views: null }], rows: [value(period, "companySize", "SIZE_11_TO_50", 100)] };
    const { container } = render(<PageAudienceSection data={partial} p="linkedin" period={period} comparison={comparison} />);
    expect(lines(panelOf(container, "visitors-companySize"))).toEqual(["11-50 employés · 100 (—)"]);
  });

  it("says a column is not available instead of drawing zeros, and says in the section that the compared period is not read", () => {
    const only: PageAudienceData = { failed: false, periods: [reading(period, "companySize", 1, 100)], rows: [value(period, "companySize", "SIZE_11_TO_50", 100)] };
    const { container } = render(<PageAudienceSection data={only} p="linkedin" period={period} comparison={comparison} />);
    const visitors = panelOf(container, "visitors-companySize");
    expect(within(visitors).getByText("Visiteurs T2 2025")).toBeTruthy();
    expect(within(visitors).getByText("Donnée non disponible")).toBeTruthy();
    expect(visitors.querySelectorAll("li")).toHaveLength(1);
    expect(screen.getByText(/La période comparée n’a pas de tailles d’entreprise relevées/)).toBeTruthy();
  });

  it("tags the panels for the report with their keys, a panel without figures for the period not being tagged", () => {
    const { container } = render(<PageAudienceSection data={data} p="linkedin" period={period} comparison={comparison} />);
    expect(keys(container)).toEqual(["visitors-companySize", "followers-companySize"]);
    // On screen a panel stays (it says « Donnée non disponible »), in the report an empty panel has no image and its slot is removed.
    const visitorsOnly: PageAudienceData = { failed: false, periods: [reading(period, "companySize", 1, 100)], rows: [value(period, "companySize", "SIZE_1", 100)] };
    const report = render(
      <ReportRowLimit.Provider value={6}>
        <PageAudienceSection data={visitorsOnly} p="linkedin" period={period} comparison={comparison} />
      </ReportRowLimit.Provider>,
    );
    expect(keys(report.container)).toEqual(["visitors-companySize"]);
    const screenOnly = render(<PageAudienceSection data={visitorsOnly} p="linkedin" period={period} comparison={comparison} />);
    expect(keys(screenOnly.container)).toEqual(["visitors-companySize", "followers-companySize"]);
  });

  it("explains how to see it, and draws no panel, for a period that is not a closed quarter or edition", () => {
    const { container } = render(<PageAudienceSection data={data} p="linkedin" period={{ start: "2026-10-04", end: "2026-11-02" }} comparison={{ start: "2026-09-04", end: "2026-10-03" }} />);
    expect(screen.getByText(/se relèvent par trimestre ou par édition terminés/)).toBeTruthy();
    expect(keys(container)).toEqual([]);
  });

  it("says a closed quarter is not read yet, and a failed read is unavailable (never an absence)", () => {
    const { rerender } = render(<PageAudienceSection data={{ rows: [], periods: [], failed: false }} p="linkedin" period={period} comparison={comparison} />);
    expect(screen.getByText(/ne sont pas encore relevées/)).toBeTruthy();
    rerender(<PageAudienceSection data={{ rows: [], periods: [], failed: true }} p="linkedin" period={period} comparison={comparison} />);
    expect(screen.getByText(/momentanément indisponibles/)).toBeTruthy();
    expect(screen.queryByText(/ne sont pas encore relevées/)).toBeNull();
  });

  it("renders nothing for a network whose page does not provide it", () => {
    const { container } = render(<PageAudienceSection data={data} p="facebook" period={period} comparison={comparison} />);
    expect(container.innerHTML).toBe("");
  });

  it("for the report, has two fixed columns and no window class (lg:/sm:/md:) in the captured blocks", () => {
    const { container } = render(
      <ReportRowLimit.Provider value={6}>
        <PageAudienceSection data={data} p="linkedin" period={period} comparison={comparison} />
      </ReportRowLimit.Provider>,
    );
    for (const key of ["visitors-companySize", "followers-companySize"]) {
      const panel = panelOf(container, key);
      expect(panel.querySelector(".grid")?.className).toContain("grid-cols-2");
      expect(panel.innerHTML).not.toMatch(/(?:^|[\s"])(?:sm|md|lg|xl):/);
    }
  });

  it("stacks the two columns on a phone on screen only", () => {
    const { container } = render(<PageAudienceSection data={data} p="linkedin" period={period} comparison={comparison} />);
    expect(panelOf(container, "visitors-companySize").querySelector(".grid")?.className).toMatch(/grid-cols-1 md:grid-cols-2/);
  });

  it("names an edition of the client by its name when the compared period is one", () => {
    // The neutral configuration of the test has editions: the heading takes the edition's name (as the report does), not its dates.
    const edition = { start: "2025-09-15", end: "2025-09-21" };
    const editionData: PageAudienceData = { ...data, periods: [...data.periods, reading(edition, "companySize", 1, 10)], rows: [...data.rows, value(edition, "companySize", "SIZE_1", 10)] };
    const { container } = render(<PageAudienceSection data={editionData} p="linkedin" period={period} comparison={edition} />);
    const heading = [...panelOf(container, "visitors-companySize").querySelectorAll("h3")][1]?.textContent ?? "";
    expect(heading).toBe("Visiteurs Edition 2025");
  });

  it("names a compared period that is not a quarter by its dates", () => {
    const custom = { start: "2025-04-10", end: "2025-05-20" };
    const customData: PageAudienceData = { ...data, periods: [...data.periods, reading(custom, "companySize", 1, 10)], rows: [...data.rows, value(custom, "companySize", "SIZE_1", 10)] };
    const { container } = render(<PageAudienceSection data={customData} p="linkedin" period={period} comparison={custom} />);
    const heading = [...panelOf(container, "visitors-companySize").querySelectorAll("h3")][1]?.textContent ?? "";
    expect(heading.startsWith("Visiteurs ")).toBe(true);
    expect(heading).toMatch(/2025/);
  });
});
