import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageAudienceSection } from "../components/dashboard/page-audience-section";
import type { PageAudienceData } from "../lib/page-audience";

// Configuration neutre sans aucune édition (comme un client sans événement), avec les visiteurs de la page activés.
vi.mock("@/client/config", async () =>
  (await import("@/test/fixtures/neutral-client")).neutralClientModule({ features: { pageAudience: true }, events: { groupLabel: "Éditions", editions: [] } }));

const period = { start: "2026-07-01", end: "2026-09-30" };
const comparison = { start: "2024-07-01", end: "2024-09-30" };
const only: PageAudienceData = {
  failed: false,
  periods: [{ platform: "linkedin", dimension: "companySize", period_start: period.start, period_end: period.end, returned_count: 1, total_views: 100, is_final: true, synced_at: "2026-11-03T08:00:00Z" }],
  rows: [{ platform: "linkedin", dimension: "companySize", period_start: period.start, period_end: period.end, label: "SIZE_11_TO_50", views: 100 }],
};

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-03T10:00:00Z")); });
afterEach(() => vi.useRealTimers());

describe("PageAudienceSection for a client without editions", () => {
  it("only speaks of quarters in the hint, never of editions", () => {
    render(<PageAudienceSection data={{ rows: [], periods: [], failed: false }} p="linkedin" period={{ start: "2026-10-04", end: "2026-11-02" }} comparison={{ start: "2026-09-04", end: "2026-10-03" }} />);
    expect(screen.getByText(/se relèvent par trimestre terminé/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/édition/);
  });

  it("only speaks of quarters in the note about the compared period", () => {
    render(<PageAudienceSection data={only} p="linkedin" period={period} comparison={comparison} />);
    expect(screen.getByText(/les relevés se font par trimestre terminé/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/édition/);
  });
});
