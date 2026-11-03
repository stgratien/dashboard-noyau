import { describe, expect, it } from "vitest";
import { pageAudienceView, PAGE_AUDIENCE_DIMENSIONS, type PageAudienceData, type PageAudiencePeriod, type StoredPageAudienceRow } from "../lib/page-audience";

const period = { start: "2026-07-01", end: "2026-09-30" };
const before = { start: "2024-07-01", end: "2024-09-30" };
const planned = [period, { start: "2026-04-01", end: "2026-06-30" }, before];
const nb = (s: string) => s.replace(/[  ]/g, " ");

const reading = (range: { start: string; end: string }, extra: Partial<PageAudiencePeriod> = {}): PageAudiencePeriod => ({
  platform: "linkedin", dimension: "companySize", period_start: range.start, period_end: range.end, returned_count: 2, total_views: 1000, is_final: false, synced_at: "2026-11-03T08:00:00Z", ...extra,
});
const value = (range: { start: string; end: string }, label: string, views: number): StoredPageAudienceRow => ({
  platform: "linkedin", dimension: "companySize", period_start: range.start, period_end: range.end, label, views,
});
const data = (over: Partial<PageAudienceData> = {}): PageAudienceData => ({ rows: [], periods: [], failed: false, ...over });
const ready = (view: ReturnType<typeof pageAudienceView>) => {
  if (view.state !== "ready") throw new Error(`state ${view.state}`);
  return view;
};

describe("pageAudienceView : which state the section is in", () => {
  it("says to pick a closed quarter or edition for a period that is not one and has no reading", () => {
    expect(pageAudienceView(data(), { start: "2026-10-04", end: "2026-11-02" }, { start: "2026-09-04", end: "2026-10-03" }, planned)).toEqual({ state: "hint" });
  });
  it("says the period is not read yet when it is a closed quarter without any reading", () => {
    expect(pageAudienceView(data(), period, before, planned)).toEqual({ state: "unfetched" });
    expect(pageAudienceView(undefined, period, before, planned)).toEqual({ state: "unfetched" });
  });
  it("never turns a failed read into an absence", () => {
    expect(pageAudienceView(data({ failed: true }), period, before, planned)).toEqual({ state: "failed" });
  });
  it("shows a custom period that happens to carry a stored reading, even when it is not planned", () => {
    const custom = { start: "2026-04-01", end: "2026-06-30" };
    expect(pageAudienceView(data({ periods: [reading(custom)], rows: [value(custom, "SIZE_11_TO_50", 100)] }), custom, before, []).state).toBe("ready");
  });
  it("ignores readings of another network or of other dates", () => {
    const elsewhere = { ...value(period, "SIZE_11_TO_50", 100), platform: "tiktok" as const };
    const otherDates = value({ start: "2026-07-01", end: "2026-09-29" }, "SIZE_1", 100);
    expect(pageAudienceView(data({ periods: [{ ...reading(period), platform: "tiktok" }], rows: [elsewhere, otherDates] }), period, before, planned)).toEqual({ state: "unfetched" });
  });
});

describe("pageAudienceView : the panel", () => {
  it("has one panel per dimension, with the raw codes shown as French labels, ranked by page views, with their share of the period total", () => {
    const view = ready(pageAudienceView(data({
      periods: [reading(period, { total_views: 1000 })],
      rows: [value(period, "SIZE_11_TO_50", 250), value(period, "SIZE_10001_OR_MORE", 600), value(period, "SIZE_51_TO_200", 150)],
    }), period, before, planned));
    expect(view.panels.map((p) => p.dimension)).toEqual(PAGE_AUDIENCE_DIMENSIONS.map((d) => d.key));
    const panel = view.panels[0]!;
    expect(panel.title).toBe("Tailles d’entreprise des visiteurs");
    expect(panel.reading).toBe("read");
    expect(panel.rows.map((r) => [nb(r.label), r.views, r.share])).toEqual([["+ de 10 000 employés", 600, 60], ["11-50 employés", 250, 25], ["51-200 employés", 150, 15]]);
  });

  it("adds the codes that give the same French label", () => {
    const view = ready(pageAudienceView(data({
      periods: [reading(period, { total_views: 400 })],
      rows: [value(period, "SIZE_11_TO_50", 100), value(period, "11-50", 50), value(period, "SIZE_1", 250)],
    }), period, before, planned));
    expect(view.panels[0]?.rows.map((r) => [nb(r.label), r.views])).toEqual([["1 employé", 250], ["11-50 employés", 150]]);
  });

  it("takes the share on the total read by the network, not on the values kept, and falls back on the kept values without a total", () => {
    const capped = ready(pageAudienceView(data({ periods: [reading(period, { total_views: 2000, returned_count: 40 })], rows: [value(period, "SIZE_1", 500)] }), period, before, planned));
    expect(capped.panels[0]?.rows[0]?.share).toBe(25);
    expect(capped.panels[0]?.returned).toBe(40);
    const noTotal = ready(pageAudienceView(data({ periods: [reading(period, { total_views: null })], rows: [value(period, "SIZE_1", 500), value(period, "SIZE_11_TO_50", 500)] }), period, before, planned));
    expect(noTotal.panels[0]?.rows.map((r) => r.share)).toEqual([50, 50]);
  });

  it("separates « no visit » (the network answered with nothing) from « not available »", () => {
    const none = ready(pageAudienceView(data({ periods: [reading(period, { returned_count: 0, total_views: 0 })] }), period, before, planned));
    expect(none.panels[0]?.reading).toBe("none");
    expect(none.panels[0]?.rows).toEqual([]);
    // Un relevé qui annonce des valeurs mais n'en a plus : ce n'est pas « aucune visite » ; seul relevé du découpage, la section dit alors « pas relevée ».
    expect(pageAudienceView(data({ periods: [reading(period, { returned_count: 3 })] }), period, before, planned)).toEqual({ state: "unfetched" });
  });

  it("finds the compared value by its French label, with the change in %, and leaves it unknown (never zero) when it is not in the comparison", () => {
    const view = ready(pageAudienceView(data({
      periods: [reading(period, { total_views: 1000 }), reading(before, { total_views: 400 })],
      rows: [
        value(period, "SIZE_11_TO_50", 600), value(period, "SIZE_51_TO_200", 400),
        value(before, "11-50", 300), value(before, "SIZE_1", 100),
      ],
    }), period, before, planned));
    const panel = view.panels[0]!;
    expect(panel.compared).toBe("read");
    const small = panel.rows.find((r) => nb(r.label) === "11-50 employés");
    expect(small?.prev).toEqual({ views: 300, share: 75 });
    expect(small?.change).toBe(100);
    const mid = panel.rows.find((r) => nb(r.label) === "51-200 employés");
    expect(mid?.prev).toBeNull();
    expect(mid?.change).toBeNull();
    expect(view.comparedAny).toBe(true);
  });

  it("gives no change when the compared value is zero", () => {
    const view = ready(pageAudienceView(data({
      periods: [reading(period), reading(before)],
      rows: [value(period, "SIZE_1", 10), value(before, "SIZE_1", 0)],
    }), period, before, planned));
    expect(view.panels[0]?.rows[0]?.prev?.views).toBe(0);
    expect(view.panels[0]?.rows[0]?.change).toBeNull();
  });

  it("marks the comparison unavailable when the compared period has no reading", () => {
    const view = ready(pageAudienceView(data({ periods: [reading(period)], rows: [value(period, "SIZE_1", 100)] }), period, before, planned));
    expect(view.comparedAny).toBe(false);
    expect(view.panels[0]?.compared).toBe("unavailable");
    expect(view.panels[0]?.rows[0]?.prev).toBeNull();
  });
});
