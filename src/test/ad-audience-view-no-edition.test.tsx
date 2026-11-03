import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdAudienceSection } from "../components/dashboard/ad-audience-section";
import type { AdAudienceData } from "../lib/ad-audience";

// Configuration neutre sans aucune édition (comme un client sans événement), avec l'audience sponsorisée activée.
vi.mock("@/client/config", async () =>
  (await import("@/test/fixtures/neutral-client")).neutralClientModule({ features: { adAudience: true }, events: { groupLabel: "Éditions", editions: [] } }));

const period = { start: "2026-07-01", end: "2026-09-30" };
const comparison = { start: "2024-07-01", end: "2024-09-30" };
const reading = (range: { start: string; end: string }) => ({
  platform: "linkedin" as const, dimension: "function" as const, period_start: range.start, period_end: range.end,
  returned_count: 1, total_impressions: 100, total_clicks: 1, is_final: true, synced_at: "2026-11-03T08:00:00Z",
});
const only: AdAudienceData = {
  failed: false, periods: [reading(period)],
  rows: [{ platform: "linkedin", dimension: "function", period_start: period.start, period_end: period.end, label: "Engineering", impressions: 100, clicks: 1 }],
};

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-03T10:00:00Z")); });
afterEach(() => vi.useRealTimers());

describe("AdAudienceSection for a client without editions", () => {
  it("only speaks of quarters in the hint, never of editions", () => {
    render(<AdAudienceSection data={{ rows: [], periods: [], failed: false }} p="linkedin" period={{ start: "2026-10-04", end: "2026-11-02" }} comparison={{ start: "2026-09-04", end: "2026-10-03" }} />);
    expect(screen.getByText(/se relève par trimestre terminé/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/édition/);
  });

  it("only speaks of quarters in the note about the compared period", () => {
    render(<AdAudienceSection data={only} p="linkedin" period={period} comparison={comparison} />);
    expect(screen.getByText(/les relevés se font par trimestre terminé/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/édition/);
  });
});
