import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SocialData } from "../components/dashboard/common";
import { PlatformView } from "../components/dashboard/platform-view";
import type { PageAudienceData } from "../lib/page-audience";
import { coverage, days, posts } from "./fixtures/young-account";

// Configuration neutre avec l'audience sponsorisée et les visiteurs de la page activés.
vi.mock("@/client/config", async () => (await import("@/test/fixtures/neutral-client")).neutralClientModule({ features: { adAudience: true, pageAudience: true } }));

// jsdom n'a pas ResizeObserver, que les graphiques (recharts) demandent à l'affichage d'un onglet réseau.
beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-03T10:00:00Z")); });
afterEach(() => vi.useRealTimers());

const period = { start: "2026-07-01", end: "2026-09-30" };
const comparison = { start: "2025-07-01", end: "2025-09-30" };
const pageAudience: PageAudienceData = {
  failed: false,
  periods: [{ platform: "linkedin", dimension: "companySize", period_start: period.start, period_end: period.end, returned_count: 1, total_views: 100, is_final: false, synced_at: "2026-11-03T08:00:00Z" }],
  rows: [{ platform: "linkedin", dimension: "companySize", period_start: period.start, period_end: period.end, label: "SIZE_11_TO_50", views: 100 }],
};
const dataFor = (extra: Partial<Record<"pageAudience", PageAudienceData>> = {}) =>
  ({
    days, posts, ads: [], adCoverage: coverage, statuses: [], promotedPosts: [], paidAds: [], stories: [], storyPulls: [], storiesFailed: false, unusableStatMonths: [],
    audience: [], adLinking: { rule: 0, manual: 0, unlinked: 0 }, statGapsFailed: false,
    adAudience: { rows: [], periods: [], failed: false }, pageAudience: { rows: [], periods: [], failed: false }, ...extra,
  }) as unknown as SocialData;

describe("PlatformView and the company sizes", () => {
  it("shows the « Tailles d’entreprise » section on the LinkedIn tab, right after the « Audience sponsorisée » one", () => {
    const { container } = render(<PlatformView data={dataFor({ pageAudience })} p="linkedin" period={period} comparison={comparison} />);
    const titles = [...container.querySelectorAll("h2[data-nav]")].map((h) => h.getAttribute("data-nav"));
    const ads = titles.indexOf("Audience sponsorisée");
    expect(ads).toBeGreaterThanOrEqual(0);
    expect(titles[ads + 1]).toBe("Tailles d’entreprise");
    expect(container.querySelector('[data-report-image="visitors-companySize"]')).not.toBeNull();
    expect(screen.getByText("Visiteurs T3 2026")).toBeTruthy();
  });

  it("does not tag the current followers company-size panel of the Abonnés section for the report (the section above carries the period figures)", () => {
    const audience = ["country", "companySize"].map((dimension) => ({ platform: "linkedin", dimension, label: dimension === "country" ? "FR" : "SIZE_11_TO_50", value: 10, unit: "count", synced_at: "2026-11-03T08:00:00Z" }));
    const data = { ...(dataFor({ pageAudience }) as unknown as Record<string, unknown>), audience } as unknown as SocialData;
    const { container } = render(<PlatformView data={data} p="linkedin" period={period} comparison={comparison} />);
    // The current distribution stays on screen (it is a valid snapshot) but is no longer a report image.
    expect(screen.getByText("Tailles d’entreprise (top 10)")).toBeTruthy();
    expect(container.querySelector('[data-report-image="audience-companySize"]')).toBeNull();
    expect(container.querySelector('[data-report-image="audience-country"]')).not.toBeNull();
  });

  it("does not show it on the other tabs", () => {
    render(<PlatformView data={dataFor({ pageAudience })} p="instagram" period={period} comparison={comparison} />);
    expect(screen.queryByRole("heading", { name: "Tailles d’entreprise" })).toBeNull();
  });
});
