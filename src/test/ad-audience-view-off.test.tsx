import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { AdAudienceSection } from "../components/dashboard/ad-audience-section";

// Configuration neutre, l'audience sponsorisée n'est pas activée (valeur par défaut) : la section n'existe pas, même avec des données.
vi.mock("@/client/config", async () => (await import("@/test/fixtures/neutral-client")).neutralClientModule());

describe("AdAudienceSection without the feature", () => {
  it("renders nothing, even when readings are provided", () => {
    const period = { start: "2026-07-01", end: "2026-09-30" };
    const data = {
      failed: false,
      periods: [{ platform: "linkedin" as const, dimension: "function" as const, period_start: period.start, period_end: period.end, returned_count: 1, total_impressions: 10, total_clicks: 1, is_final: false, synced_at: "2026-11-03T08:00:00Z" }],
      rows: [{ platform: "linkedin" as const, dimension: "function" as const, period_start: period.start, period_end: period.end, label: "Engineering", impressions: 10, clicks: 1 }],
    };
    const { container } = render(<AdAudienceSection data={data} p="linkedin" period={period} comparison={{ start: "2024-07-01", end: "2024-09-30" }} />);
    expect(container.innerHTML).toBe("");
  });
});
