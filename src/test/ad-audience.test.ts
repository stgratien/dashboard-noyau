import { describe, expect, it } from "vitest";
import { adAudienceView, AD_AUDIENCE_DIMENSIONS, type AdAudienceData, type AdAudiencePeriod, type StoredAdAudienceRow } from "../lib/ad-audience";

const period = { start: "2026-07-01", end: "2026-09-30" };
const before = { start: "2024-07-01", end: "2024-09-30" };
const planned = [period, { start: "2026-04-01", end: "2026-06-30" }, before];

const reading = (dimension: AdAudiencePeriod["dimension"], range: { start: string; end: string }, extra: Partial<AdAudiencePeriod> = {}): AdAudiencePeriod => ({
  platform: "linkedin", dimension, period_start: range.start, period_end: range.end, returned_count: 2, total_impressions: 1500, total_clicks: 30, is_final: false, synced_at: "2026-11-03T08:00:00Z", ...extra,
});
const value = (dimension: StoredAdAudienceRow["dimension"], range: { start: string; end: string }, label: string, impressions: number, clicks: number | null): StoredAdAudienceRow => ({
  platform: "linkedin", dimension, period_start: range.start, period_end: range.end, label, impressions, clicks,
});
const data = (over: Partial<AdAudienceData> = {}): AdAudienceData => ({ rows: [], periods: [], failed: false, ...over });
const ready = (view: ReturnType<typeof adAudienceView>) => {
  if (view.state !== "ready") throw new Error(`state ${view.state}`);
  return view;
};

describe("adAudienceView : which state the section is in", () => {
  it("says to pick a closed quarter or edition for a period that is not one and has no reading", () => {
    expect(adAudienceView(data(), "linkedin", { start: "2026-10-04", end: "2026-11-02" }, { start: "2026-09-04", end: "2026-10-03" }, planned)).toEqual({ state: "hint" });
  });
  it("says the period is not read yet when it is a closed quarter without any reading", () => {
    expect(adAudienceView(data(), "linkedin", period, before, planned)).toEqual({ state: "unfetched" });
    expect(adAudienceView(undefined, "linkedin", period, before, planned)).toEqual({ state: "unfetched" });
  });
  it("never turns a failed read into an absence", () => {
    expect(adAudienceView(data({ failed: true }), "linkedin", period, before, planned)).toEqual({ state: "failed" });
  });
  it("shows a custom period that happens to carry a stored reading, even when it is not planned", () => {
    const custom = { start: "2026-04-01", end: "2026-06-30" };
    const view = adAudienceView(data({ periods: [reading("function", custom)], rows: [value("function", custom, "Engineering", 100, 1)] }), "linkedin", custom, before, []);
    expect(view.state).toBe("ready");
  });
});

describe("adAudienceView : panels", () => {
  it("lists the six dimensions in display order, the unread ones as unavailable", () => {
    const view = ready(adAudienceView(data({ periods: [reading("function", period)], rows: [value("function", period, "Engineering", 100, 1)] }), "linkedin", period, before, planned));
    expect(view.panels.map((p) => p.dimension)).toEqual(AD_AUDIENCE_DIMENSIONS.map((d) => d.key));
    expect(view.panels.map((p) => p.reading)).toEqual(["read", "unavailable", "unavailable", "unavailable", "unavailable", "unavailable"]);
    expect(view.panels[0]?.title).toBe("Fonctions touchées");
  });

  it("ranks by impressions, computes the click rate at read time and keeps an unknown click count unknown", () => {
    const view = ready(adAudienceView(data({
      periods: [reading("industry", period)],
      rows: [value("industry", period, "Banking", 1000, 10), value("industry", period, "Software", 4000, 80), value("industry", period, "Retail", 1000, null), value("industry", period, "Zero", 500, 0)],
    }), "linkedin", period, before, planned));
    const rows = view.panels.find((p) => p.dimension === "industry")?.rows ?? [];
    expect(rows.map((r) => r.label)).toEqual(["Software", "Banking", "Retail", "Zero"]);
    expect(rows.map((r) => r.ctr)).toEqual([2, 1, null, 0]);
    expect(rows.find((r) => r.label === "Retail")?.clicks).toBeNull();
  });

  it("separates « no delivery » (the network answered with nothing) from « not available »", () => {
    const view = ready(adAudienceView(data({
      periods: [reading("function", period), reading("title", period, { returned_count: 0, total_impressions: 0, total_clicks: 0 }), reading("region", period, { returned_count: 3 })],
      rows: [value("function", period, "Engineering", 100, 1)],
    }), "linkedin", period, before, planned));
    const by = (dimension: string) => view.panels.find((p) => p.dimension === dimension);
    expect(by("title")?.reading).toBe("none");
    // Un relevé qui annonce des valeurs mais n'en a plus : ce n'est pas « aucune diffusion ».
    expect(by("region")?.reading).toBe("unavailable");
    expect(by("function")?.reading).toBe("read");
  });

  it("finds the compared value by its label, and leaves it unknown (never zero) when it is not in the comparison", () => {
    const view = ready(adAudienceView(data({
      periods: [reading("company", period), reading("company", before)],
      rows: [
        value("company", period, "Acme", 1000, 20), value("company", period, "Globex", 800, 8),
        value("company", before, " Acme ", 500, 5), value("company", before, "Initech", 900, 9),
      ],
    }), "linkedin", period, before, planned));
    const panel = view.panels.find((p) => p.dimension === "company");
    expect(panel?.compared).toBe("read");
    expect(panel?.rows.find((r) => r.label === "Acme")?.prev).toEqual({ impressions: 500, clicks: 5, ctr: 1 });
    expect(panel?.rows.find((r) => r.label === "Globex")?.prev).toBeNull();
    expect(view.comparedAny).toBe(true);
  });

  it("marks the comparison unavailable when the compared period has no reading", () => {
    const view = ready(adAudienceView(data({ periods: [reading("function", period)], rows: [value("function", period, "Engineering", 100, 1)] }), "linkedin", period, before, planned));
    expect(view.comparedAny).toBe(false);
    expect(view.panels[0]?.compared).toBe("unavailable");
    expect(view.panels[0]?.rows[0]?.prev).toBeNull();
  });

  it("ignores readings of another network or of other dates", () => {
    const elsewhere = { ...value("function", period, "Engineering", 100, 1), platform: "tiktok" as const };
    const otherDates = value("function", { start: "2026-07-01", end: "2026-09-29" }, "Sales", 100, 1);
    expect(adAudienceView(data({ periods: [{ ...reading("function", period), platform: "tiktok" }], rows: [elsewhere, otherDates] }), "linkedin", period, before, planned)).toEqual({ state: "unfetched" });
  });
});
