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
const comparison = { start: "2024-07-01", end: "2024-09-30" };
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

describe("PlatformView and the page visitors", () => {
  it("shows the « Visiteurs de la page » section on the LinkedIn tab, right after the « Audience sponsorisée » one", () => {
    const { container } = render(<PlatformView data={dataFor({ pageAudience })} p="linkedin" period={period} comparison={comparison} />);
    const titles = [...container.querySelectorAll("h2[data-nav]")].map((h) => h.getAttribute("data-nav"));
    const ads = titles.indexOf("Audience sponsorisée");
    expect(ads).toBeGreaterThanOrEqual(0);
    expect(titles[ads + 1]).toBe("Visiteurs de la page");
    expect(container.querySelector('[data-report-image="visitors-companySize"]')).not.toBeNull();
    expect(screen.getByText("Tailles d’entreprise des visiteurs (top 10)")).toBeTruthy();
  });

  it("does not show it on the other tabs", () => {
    render(<PlatformView data={dataFor({ pageAudience })} p="instagram" period={period} comparison={comparison} />);
    expect(screen.queryByRole("heading", { name: "Visiteurs de la page" })).toBeNull();
  });
});
