import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AdAudienceSection } from "../components/dashboard/ad-audience-section";
import { ReportRowLimit } from "../components/dashboard/common";
import { formatNumber } from "../lib/dashboard-format";
import type { AdAudienceData } from "../lib/ad-audience";

// Configuration neutre avec l'audience sponsorisée activée (la source LinkedIn en fait partie).
vi.mock("@/client/config", async () => (await import("@/test/fixtures/neutral-client")).neutralClientModule({ features: { adAudience: true } }));

const period = { start: "2026-07-01", end: "2026-09-30" };
const comparison = { start: "2024-07-01", end: "2024-09-30" };
const reading = (dimension: string, range: { start: string; end: string }, returned = 2) => ({
  platform: "linkedin" as const, dimension: dimension as "function", period_start: range.start, period_end: range.end,
  returned_count: returned, total_impressions: 1500, total_clicks: 30, is_final: false, synced_at: "2026-11-03T08:00:00Z",
});
const value = (dimension: string, range: { start: string; end: string }, label: string, impressions: number, clicks: number | null) => ({
  platform: "linkedin" as const, dimension: dimension as "function", period_start: range.start, period_end: range.end, label, impressions, clicks,
});
const data: AdAudienceData = {
  failed: false,
  periods: [reading("function", period), reading("function", comparison), reading("title", period, 0)],
  rows: [
    value("function", period, "Engineering", 4000, 80), value("function", period, "Marketing", 1000, null),
    value("function", comparison, "Engineering", 2000, 20),
  ],
};
const keys = (container: HTMLElement) => [...container.querySelectorAll("[data-report-image]")].map((el) => el.getAttribute("data-report-image"));

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-03T10:00:00Z")); });
afterEach(() => vi.useRealTimers());

describe("AdAudienceSection", () => {
  it("shows the title, the figures with the click rate and the comparison, and says what is unavailable or not delivered", () => {
    const { container } = render(<AdAudienceSection data={data} p="linkedin" period={period} comparison={comparison} />);
    expect(screen.getByRole("heading", { name: "Audience sponsorisée" }).getAttribute("data-nav")).toBe("Audience sponsorisée");
    const functionPanel = container.querySelector('[data-report-image="adAudience-function"]') as HTMLElement;
    expect(functionPanel).toBeTruthy();
    expect(within(functionPanel).getByText("Engineering")).toBeTruthy();
    expect(within(functionPanel).getByText(formatNumber(4000))).toBeTruthy();
    // 80 clics sur 4 000 impressions : 2 % ; la valeur comparée (2 000 impressions) donne +100 %.
    expect(within(functionPanel).getAllByText(/2,0%/).length).toBeGreaterThan(0);
    expect(functionPanel.textContent).toContain("(+100%)");
    // Un clic inconnu et une valeur absente de la comparaison restent « — », jamais 0.
    const marketing = within(functionPanel).getByText("Marketing").closest("li") as HTMLElement;
    expect(marketing.textContent).toContain("—");
    expect(marketing.textContent).not.toMatch(/vs 0\b/);
    // Les découpages non relevés disent « Donnée non disponible » ; celui que le réseau a renvoyé vide, « Aucune diffusion ».
    expect(screen.getAllByText("Donnée non disponible").length).toBe(4);
    expect(screen.getByText("Aucune diffusion sur la période")).toBeTruthy();
  });

  it("tags every panel once for the report, with distinct keys, and keeps the explanations out of the exports", () => {
    const { container } = render(<AdAudienceSection data={data} p="linkedin" period={period} comparison={comparison} />);
    const tagged = keys(container);
    expect(new Set(tagged).size).toBe(tagged.length);
    expect(tagged).toEqual(["adAudience-function", "adAudience-title", "adAudience-industry", "adAudience-company", "adAudience-seniority", "adAudience-region"]);
    const notes = [...container.querySelectorAll('[role="note"]')];
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) expect(note.closest("[data-export-hide]")).not.toBeNull();
    for (const panel of container.querySelectorAll("[data-report-image]")) expect(panel.querySelector('[role="note"]')).toBeNull();
  });

  it("explains how to see it, and draws no panel, for a period that is not a closed quarter or edition", () => {
    const { container } = render(<AdAudienceSection data={data} p="linkedin" period={{ start: "2026-10-04", end: "2026-11-02" }} comparison={{ start: "2026-09-04", end: "2026-10-03" }} />);
    expect(screen.getByText(/se relève par trimestre ou par édition terminés/)).toBeTruthy();
    expect(keys(container)).toEqual([]);
  });

  it("says a closed quarter is not read yet, and a failed read is unavailable (never an absence)", () => {
    const { rerender } = render(<AdAudienceSection data={{ rows: [], periods: [], failed: false }} p="linkedin" period={period} comparison={comparison} />);
    expect(screen.getByText(/n’est pas encore relevée/)).toBeTruthy();
    rerender(<AdAudienceSection data={{ rows: [], periods: [], failed: true }} p="linkedin" period={period} comparison={comparison} />);
    expect(screen.getByText(/momentanément indisponible/)).toBeTruthy();
    expect(screen.queryByText(/n’est pas encore relevée/)).toBeNull();
  });

  it("says when the compared period has no reading, and shows no « vs » line then", () => {
    const only = { ...data, periods: [reading("function", period)], rows: [value("function", period, "Engineering", 4000, 80)] };
    const { container } = render(<AdAudienceSection data={only} p="linkedin" period={period} comparison={comparison} />);
    expect(screen.getByText(/La période comparée n’a pas d’audience sponsorisée relevée/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/vs /);
  });

  it("shows the first 10 values on screen, with a button for all the stored ones, and keeps panels at their own height", () => {
    const many = Array.from({ length: 14 }, (_, i) => value("company", period, `Company ${i}`, 1000 - i, 1));
    const rich: AdAudienceData = { failed: false, periods: [reading("company", period, 209)], rows: many };
    const { container } = render(<AdAudienceSection data={rich} p="linkedin" period={period} comparison={comparison} />);
    const panel = container.querySelector('[data-report-image="adAudience-company"]') as HTMLElement;
    expect(panel.querySelectorAll("li")).toHaveLength(10);
    const button = within(panel).getByRole("button", { name: "Afficher les 14 valeurs" });
    expect(button.closest("[data-export-hide]")).not.toBeNull();
    // The count line speaks of the stored values (14 of 209), not of the 10 on screen.
    expect(within(panel).getByText(/14 valeurs les plus diffusées sur/)).toBeTruthy();
    fireEvent.click(button);
    expect(panel.querySelectorAll("li")).toHaveLength(14);
    fireEvent.click(within(panel).getByRole("button", { name: "Réduire" }));
    expect(panel.querySelectorAll("li")).toHaveLength(10);
    // Panels are as tall as their own content: no empty frame stretched to the tallest neighbour.
    expect(container.querySelector(".grid")?.className).toContain("items-start");
    // No button for a panel that fits.
    const small = render(<AdAudienceSection data={data} p="linkedin" period={period} comparison={comparison} />);
    expect(within(small.container).queryByRole("button")).toBeNull();
  });

  it("says inside the panel, so also in the report image, that the compared period has no reading", () => {
    const only = { ...data, periods: [reading("function", period)], rows: [value("function", period, "Engineering", 4000, 80)] };
    const { container } = render(<AdAudienceSection data={only} p="linkedin" period={period} comparison={comparison} />);
    const panel = container.querySelector('[data-report-image="adAudience-function"]') as HTMLElement;
    expect(within(panel).getByText(/Comparaison non disponible/)).toBeTruthy();
    expect(panel.closest("[data-export-hide]")).toBeNull();
    expect(panel.querySelector("[data-export-hide]")).toBeNull();
    // With a reading for the compared period the sentence is not there.
    const both = render(<AdAudienceSection data={data} p="linkedin" period={period} comparison={comparison} />);
    const withBoth = both.container.querySelector('[data-report-image="adAudience-function"]') as HTMLElement;
    expect(within(withBoth).queryByText(/Comparaison non disponible/)).toBeNull();
  });

  it("renders nothing for a network whose ads do not provide it", () => {
    const { container } = render(<AdAudienceSection data={data} p="facebook" period={period} comparison={comparison} />);
    expect(container.innerHTML).toBe("");
  });

  it("cuts the rankings for the report to a top 10 whose title says so, and does not tag an empty panel", () => {
    const many = Array.from({ length: 14 }, (_, i) => value("company", period, `Company ${i}`, 1000 - i, 1));
    const rich: AdAudienceData = { failed: false, periods: [reading("company", period, 14), reading("title", period, 0)], rows: many };
    const { container } = render(
      <ReportRowLimit.Provider value={6}>
        <AdAudienceSection data={rich} p="linkedin" period={period} comparison={comparison} />
      </ReportRowLimit.Provider>,
    );
    const panel = container.querySelector('[data-report-image="adAudience-company"]') as HTMLElement;
    expect(panel.querySelectorAll("li")).toHaveLength(10);
    expect(within(panel).getByText("Entreprises touchées (top 10)")).toBeTruthy();
    expect(keys(container)).toEqual(["adAudience-company"]);
    // L'image du rapport garde la légende des colonnes (rien d'autre ne les nomme) et ne dépend d'aucune classe de fenêtre (lg:/sm:), qui varierait avec la fenêtre de capture.
    expect(within(panel).getByText("Taux de clic")).toBeTruthy();
    expect(within(panel).getByText("Impressions")).toBeTruthy();
    expect(panel.innerHTML).not.toMatch(/(?:^|[\s"])(?:sm|md|lg|xl):/);
  });

  it("keeps the responsive classes on screen only (phones get a caption in each cell, desktop a column header)", () => {
    const { container } = render(<AdAudienceSection data={data} p="linkedin" period={period} comparison={comparison} />);
    const panel = container.querySelector('[data-report-image="adAudience-function"]') as HTMLElement;
    expect(panel.innerHTML).toMatch(/sm:flex/);
  });
});
