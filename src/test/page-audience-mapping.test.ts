import { describe, expect, it } from "vitest";
import {
  PAGE_AUDIENCE_FIELD, PAGE_AUDIENCE_MAX_ROWS, AD_AUDIENCE_REFRESH_MS, AD_AUDIENCE_RETRY_MS, nextPageAudiencePull, pageAudienceFields, pageAudienceValues,
  type AdAudienceState,
} from "../lib/windsor-mapping";
import { PAGE_AUDIENCE_DIMENSIONS, pageAudienceKey } from "../lib/page-audience";

describe("page visitors : request and values", () => {
  it("asks for the staff range and the page views by staff range, without date or account", () => {
    expect(pageAudienceFields("companySize")).toBe("page_staff_count_range,page_views_by_staff_count_range");
    for (const { key } of PAGE_AUDIENCE_DIMENSIONS) {
      const fields = pageAudienceFields(key).split(",");
      expect(fields).toHaveLength(2);
      expect(fields).toEqual([PAGE_AUDIENCE_FIELD[key].label, PAGE_AUDIENCE_FIELD[key].value]);
      expect(fields).not.toContain("date");
      expect(fields).not.toContain("account_id");
    }
  });

  it("ranks by page views then label, and keeps the raw labels of the network", () => {
    const out = pageAudienceValues("companySize", [
      { page_staff_count_range: "SIZE_11_TO_50", page_views_by_staff_count_range: "900" },
      { page_staff_count_range: "SIZE_10001_OR_MORE", page_views_by_staff_count_range: 1200 },
      { page_staff_count_range: "SIZE_51_TO_200", page_views_by_staff_count_range: 900 },
      { page_staff_count_range: "SIZE_1", page_views_by_staff_count_range: 40 },
    ]);
    expect(out.rows).toEqual([
      { label: "SIZE_10001_OR_MORE", views: 1200 }, { label: "SIZE_11_TO_50", views: 900 }, { label: "SIZE_51_TO_200", views: 900 }, { label: "SIZE_1", views: 40 },
    ]);
    expect(out.returned).toBe(4);
    expect(out.totalViews).toBe(3040);
  });

  it("cleans labels, adds the rows of the same label (one per day or one per period), and skips rows with no label or no usable page view", () => {
    const out = pageAudienceValues("companySize", [
      { page_staff_count_range: "  SIZE_11_TO_50 ", page_views_by_staff_count_range: 100 },
      { page_staff_count_range: "SIZE_11_TO_50", page_views_by_staff_count_range: 50 },
      { page_staff_count_range: "", page_views_by_staff_count_range: 999 },
      { page_staff_count_range: "SIZE_1", page_views_by_staff_count_range: 0 },
      { page_staff_count_range: "SIZE_51_TO_200", page_views_by_staff_count_range: null },
      { page_staff_count_range: "SIZE_201_TO_500", page_views_by_staff_count_range: "n/a" },
      { page_staff_count_range: "SIZE_501_TO_1000", page_views_by_staff_count_range: -3 },
      { page_views_by_staff_count_range: 40 },
    ]);
    expect(out.rows).toEqual([{ label: "SIZE_11_TO_50", views: 150 }]);
    expect(out.returned).toBe(1);
    expect(out.totalViews).toBe(150);
  });

  it("returns an empty list for no row", () => {
    expect(pageAudienceValues("companySize", [])).toEqual({ rows: [], returned: 0, totalViews: 0 });
  });

  it("caps the stored list but counts and totals every value read", () => {
    const rows = Array.from({ length: PAGE_AUDIENCE_MAX_ROWS + 20 }, (_, i) => ({ page_staff_count_range: `Range ${i}`, page_views_by_staff_count_range: 1000 - i }));
    const out = pageAudienceValues("companySize", rows);
    expect(out.rows).toHaveLength(PAGE_AUDIENCE_MAX_ROWS);
    expect(out.rows[0]?.label).toBe("Range 0");
    expect(out.returned).toBe(PAGE_AUDIENCE_MAX_ROWS + 20);
    expect(out.totalViews).toBe(rows.reduce((sum, r) => sum + r.page_views_by_staff_count_range, 0));
    expect(pageAudienceValues("companySize", rows, 3).rows).toHaveLength(3);
    expect(pageAudienceValues("companySize", rows, 0).rows).toEqual([]);
  });
});

describe("page visitors : which reading is due", () => {
  const now = new Date("2026-11-03T10:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const state = (over: Partial<AdAudienceState>): AdAudienceState => ({ syncedAt: null, lastAttemptAt: null, final: false, ...over });
  const periods = [{ start: "2026-07-01", end: "2026-09-30" }, { start: "2026-04-01", end: "2026-06-30" }];

  it("picks the newest closed period first and then the previous ones, skipping what was just tried or is final", () => {
    const states = new Map<string, AdAudienceState>();
    expect(nextPageAudiencePull(periods, states, now)).toEqual({ dimension: "companySize", start: "2026-07-01", end: "2026-09-30" });
    states.set(pageAudienceKey("linkedin", "companySize", "2026-07-01", "2026-09-30"), state({ syncedAt: ago(1000), lastAttemptAt: ago(1000) }));
    expect(nextPageAudiencePull(periods, states, now)).toEqual({ dimension: "companySize", start: "2026-04-01", end: "2026-06-30" });
    states.set(pageAudienceKey("linkedin", "companySize", "2026-04-01", "2026-06-30"), state({ final: true, syncedAt: ago(10 * AD_AUDIENCE_REFRESH_MS) }));
    expect(nextPageAudiencePull(periods, states, now)).toBeNull();
    expect(nextPageAudiencePull([], new Map(), now)).toBeNull();
  });

  it("uses the same delays as the sponsored audience : retry after a failed attempt, a daily refresh while the network may still revise", () => {
    const first = [{ start: "2026-07-01", end: "2026-09-30" }];
    const key = pageAudienceKey("linkedin", "companySize", "2026-07-01", "2026-09-30");
    const due = (s: AdAudienceState) => nextPageAudiencePull(first, new Map([[key, s]]), now) !== null;
    expect(due(state({ lastAttemptAt: ago(AD_AUDIENCE_RETRY_MS - 1000) }))).toBe(false);
    expect(due(state({ lastAttemptAt: ago(AD_AUDIENCE_RETRY_MS + 1000) }))).toBe(true);
    expect(due(state({ syncedAt: ago(AD_AUDIENCE_REFRESH_MS - 1000), lastAttemptAt: ago(AD_AUDIENCE_REFRESH_MS - 1000) }))).toBe(false);
    expect(due(state({ syncedAt: ago(AD_AUDIENCE_REFRESH_MS + 1000), lastAttemptAt: ago(AD_AUDIENCE_REFRESH_MS + 1000) }))).toBe(true);
  });

  it("does not mix its readings with those of the sponsored audience", () => {
    // A state filed under the key of another kind of reading (same period, a sponsored dimension) does not make the page visitors look done.
    const states = new Map<string, AdAudienceState>([["linkedin|function|2026-07-01|2026-09-30", state({ final: true, syncedAt: ago(1000) })]]);
    expect(nextPageAudiencePull(periods, states, now)).toEqual({ dimension: "companySize", start: "2026-07-01", end: "2026-09-30" });
  });
});
