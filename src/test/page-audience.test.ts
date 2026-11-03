import { describe, expect, it } from "vitest";
import { pageAudienceView, PAGE_AUDIENCE_DIMENSIONS, PAGE_AUDIENCE_ROWS, type PageAudienceData, type PageAudiencePeriod, type PageAudienceDimension, type StoredPageAudienceRow } from "../lib/page-audience";

const period = { start: "2026-07-01", end: "2026-09-30" };
const before = { start: "2025-07-01", end: "2025-09-30" };
const planned = [period, { start: "2026-04-01", end: "2026-06-30" }, before];
const nb = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

const reading = (range: { start: string; end: string }, extra: Partial<PageAudiencePeriod> = {}): PageAudiencePeriod => ({
  platform: "linkedin", dimension: "companySize", period_start: range.start, period_end: range.end, returned_count: 2, total_views: 1000, is_final: true, synced_at: "2026-11-03T08:00:00Z", ...extra,
});
const value = (range: { start: string; end: string }, label: string, views: number, dimension: PageAudienceDimension = "companySize"): StoredPageAudienceRow => ({
  platform: "linkedin", dimension, period_start: range.start, period_end: range.end, label, views,
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
  it("is only about the displayed period: a reading of the compared period alone does not open the section", () => {
    expect(pageAudienceView(data({ periods: [reading(before)], rows: [value(before, "SIZE_1", 10)] }), period, before, planned)).toEqual({ state: "unfetched" });
  });
});

describe("pageAudienceView : the panels", () => {
  it("has the visitors panel then the followers panel, with their report keys", () => {
    const view = ready(pageAudienceView(data({ periods: [reading(period)], rows: [value(period, "SIZE_1", 10)] }), period, before, planned));
    expect(view.panels.map((p) => [p.dimension, p.metric, p.reportKey])).toEqual([
      ["companySize", "Visiteurs", "visitors-companySize"], ["followersCompanySize", "Abonnés", "followers-companySize"],
    ]);
    expect(view.panels.map((p) => p.dimension)).toEqual(PAGE_AUDIENCE_DIMENSIONS.map((d) => d.key));
  });

  it("shows the raw codes as French labels, ranked by value, with their share of the whole distribution", () => {
    const view = ready(pageAudienceView(data({
      periods: [reading(period, { total_views: 1000 })],
      rows: [value(period, "SIZE_11_TO_50", 250), value(period, "SIZE_10001_OR_MORE", 600), value(period, "SIZE_51_TO_200", 150)],
    }), period, before, planned));
    const column = view.panels[0]!.current;
    expect(column.reading).toBe("read");
    expect(column.rows.map((r) => [nb(r.label), r.value, r.share])).toEqual([["+ de 10 000 employés", 600, 60], ["11-50 employés", 250, 25], ["51-200 employés", 150, 15]]);
  });

  it("keeps the five biggest sizes only, and the share is still taken on the total of the whole distribution", () => {
    const codes = ["SIZE_1", "SIZE_2_TO_10", "SIZE_11_TO_50", "SIZE_51_TO_200", "SIZE_201_TO_500", "SIZE_501_TO_1000", "SIZE_1001_TO_5000"];
    const view = ready(pageAudienceView(data({
      periods: [reading(period, { total_views: 10000, returned_count: 7 })],
      rows: codes.map((code, i) => value(period, code, 100 * (i + 1))),
    }), period, before, planned));
    const column = view.panels[0]!.current;
    expect(PAGE_AUDIENCE_ROWS).toBe(5);
    expect(column.rows).toHaveLength(5);
    expect(column.rows.map((r) => r.value)).toEqual([700, 600, 500, 400, 300]);
    expect(column.rows[0]?.share).toBeCloseTo(7, 9);
  });

  it("adds the codes that give the same French label", () => {
    const view = ready(pageAudienceView(data({
      periods: [reading(period, { total_views: 400 })],
      rows: [value(period, "SIZE_11_TO_50", 100), value(period, "11-50", 50), value(period, "SIZE_1", 250)],
    }), period, before, planned));
    expect(view.panels[0]?.current.rows.map((r) => [nb(r.label), r.value])).toEqual([["1 employé", 250], ["11-50 employés", 150]]);
  });

  it("leaves the share unknown (never inflated) for a partial list without a total, and never gives a share above 100 %", () => {
    // Two sizes stored out of seven read, no total: the kept values are not the whole distribution.
    const partial = ready(pageAudienceView(data({ periods: [reading(period, { total_views: null, returned_count: 7 })], rows: [value(period, "SIZE_1", 500), value(period, "SIZE_11_TO_50", 500)] }), period, before, planned));
    expect(partial.panels[0]?.current.rows.map((r) => r.value)).toEqual([500, 500]);
    expect(partial.panels[0]?.current.rows.map((r) => r.share)).toEqual([null, null]);
    // A total smaller than the values kept is inconsistent: it cannot be smaller than them.
    const small = ready(pageAudienceView(data({ periods: [reading(period, { total_views: 400, returned_count: 2 })], rows: [value(period, "SIZE_1", 300), value(period, "SIZE_11_TO_50", 300)] }), period, before, planned));
    expect(small.panels[0]?.current.rows.map((r) => r.share)).toEqual([50, 50]);
  });

  it("falls back on the kept values when the reading has no total", () => {
    const noTotal = ready(pageAudienceView(data({ periods: [reading(period, { total_views: null })], rows: [value(period, "SIZE_1", 500), value(period, "SIZE_11_TO_50", 500)] }), period, before, planned));
    expect(noTotal.panels[0]?.current.rows.map((r) => r.share)).toEqual([50, 50]);
  });

  it("reads the visitors and the followers independently, one dimension per column pair", () => {
    const view = ready(pageAudienceView(data({
      periods: [reading(period), reading(period, { dimension: "followersCompanySize", total_views: 200 }), reading(before, { dimension: "followersCompanySize", total_views: 100 })],
      rows: [value(period, "SIZE_1", 100), value(period, "SIZE_1", 50, "followersCompanySize"), value(before, "SIZE_1", 25, "followersCompanySize")],
    }), period, before, planned));
    const [visitors, followers] = view.panels;
    expect(visitors?.current.rows.map((r) => r.value)).toEqual([100]);
    expect(visitors?.compared.reading).toBe("unavailable");
    expect(followers?.current.rows.map((r) => [r.value, r.share])).toEqual([[50, 25]]);
    expect(followers?.compared.rows.map((r) => [r.value, r.share])).toEqual([[25, 25]]);
    expect(view.comparedAny).toBe(true);
  });

  it("leaves a dimension without reading unavailable (never zero) while the other one is shown", () => {
    const view = ready(pageAudienceView(data({ periods: [reading(period)], rows: [value(period, "SIZE_1", 100)] }), period, before, planned));
    expect(view.panels[1]?.current).toEqual({ reading: "unavailable", rows: [] });
    expect(view.panels[1]?.compared.reading).toBe("unavailable");
  });

  it("does not turn a reading whose values are missing into an empty distribution", () => {
    const view = ready(pageAudienceView(data({
      periods: [reading(period), reading(period, { dimension: "followersCompanySize", returned_count: 3 })],
      rows: [value(period, "SIZE_1", 100)],
    }), period, before, planned));
    expect(view.panels[1]?.current.reading).toBe("unavailable");
  });

  it("marks the comparison unavailable when the compared period has no reading", () => {
    const view = ready(pageAudienceView(data({ periods: [reading(period)], rows: [value(period, "SIZE_1", 100)] }), period, before, planned));
    expect(view.comparedAny).toBe(false);
    expect(view.panels[0]?.compared.reading).toBe("unavailable");
  });

  it("gives each period its own share, whatever the other one totals", () => {
    const view = ready(pageAudienceView(data({
      periods: [reading(period, { total_views: 1000 }), reading(before, { total_views: 400 })],
      rows: [value(period, "SIZE_11_TO_50", 600), value(before, "11-50", 300)],
    }), period, before, planned));
    expect(view.panels[0]?.current.rows[0]?.share).toBe(60);
    expect(view.panels[0]?.compared.rows[0]?.share).toBe(75);
  });
});
