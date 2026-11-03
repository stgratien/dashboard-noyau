import { describe, expect, it } from "vitest";
import {
  AD_AUDIENCE_MAX_ROWS, AD_AUDIENCE_REFRESH_MS, AD_AUDIENCE_RETRY_MS, adAudienceDue, adAudienceFields, adAudienceFinal, adAudienceValues, nextAdAudiencePull,
  type AdAudienceState,
} from "../lib/windsor-mapping";
import { AD_AUDIENCE_DIMENSIONS, adAudienceKey } from "../lib/ad-audience";

describe("sponsored audience : request and values", () => {
  it("asks for one profile field and the two measures, without date or account", () => {
    expect(adAudienceFields("function")).toBe("member_job_function,impressions,clicks");
    for (const { key } of AD_AUDIENCE_DIMENSIONS) {
      const fields = adAudienceFields(key).split(",");
      expect(fields).toHaveLength(3);
      expect(fields).not.toContain("date");
      expect(fields).not.toContain("account_id");
    }
    expect(new Set(AD_AUDIENCE_DIMENSIONS.map((d) => adAudienceFields(d.key))).size).toBe(AD_AUDIENCE_DIMENSIONS.length);
  });

  it("ranks by impressions, then clicks, then label, and keeps null clicks unknown instead of zero", () => {
    const out = adAudienceValues("function", [
      { member_job_function: "Engineering", impressions: "900", clicks: "12" },
      { member_job_function: "Marketing", impressions: 1200, clicks: 20 },
      { member_job_function: "Sales", impressions: 900, clicks: 30 },
      { member_job_function: "Finance", impressions: 900, clicks: null },
      { member_job_function: "Admin", impressions: 900, clicks: null },
    ]);
    expect(out.rows.map((r) => r.label)).toEqual(["Marketing", "Sales", "Engineering", "Admin", "Finance"]);
    expect(out.rows.find((r) => r.label === "Finance")?.clicks).toBeNull();
    expect(out.returned).toBe(5);
    expect(out.totalImpressions).toBe(4800);
    // Une valeur sans clics connus rend le total des clics inconnu : jamais une somme partielle présentée comme complète.
    expect(out.totalClicks).toBeNull();
  });

  it("cleans labels, adds duplicates, and skips rows with no label or no usable impressions", () => {
    const out = adAudienceValues("industry", [
      { member_industry: "  Software   Development ", impressions: 100, clicks: 1 },
      { member_industry: "Software Development", impressions: 50, clicks: 2 },
      { member_industry: "", impressions: 999, clicks: 9 },
      { member_industry: "Retail", impressions: 0, clicks: 0 },
      { member_industry: "Banking", impressions: null, clicks: 3 },
      { member_industry: "Insurance", impressions: "n/a", clicks: 3 },
      { impressions: 40, clicks: 1 },
    ]);
    expect(out.rows).toEqual([{ label: "Software Development", impressions: 150, clicks: 3 }]);
    expect(out.returned).toBe(1);
    expect(out.totalImpressions).toBe(150);
    expect(out.totalClicks).toBe(3);
  });

  it("returns an empty list for no row, and a duplicate with an unknown click count makes that value's clicks unknown", () => {
    expect(adAudienceValues("region", [])).toEqual({ rows: [], returned: 0, totalImpressions: 0, totalClicks: 0 });
    const out = adAudienceValues("region", [{ member_region: "Île-de-France", impressions: 10, clicks: 1 }, { member_region: "Île-de-France", impressions: 5, clicks: null }]);
    expect(out.rows).toEqual([{ label: "Île-de-France", impressions: 15, clicks: null }]);
  });

  it("caps the stored list but counts and totals every value read", () => {
    const rows = Array.from({ length: AD_AUDIENCE_MAX_ROWS + 20 }, (_, i) => ({ member_company_name: `Company ${i}`, impressions: 1000 - i, clicks: 1 }));
    const out = adAudienceValues("company", rows);
    expect(out.rows).toHaveLength(AD_AUDIENCE_MAX_ROWS);
    expect(out.rows[0]?.label).toBe("Company 0");
    expect(out.returned).toBe(AD_AUDIENCE_MAX_ROWS + 20);
    expect(out.totalImpressions).toBe(rows.reduce((sum, r) => sum + r.impressions, 0));
    expect(adAudienceValues("company", rows, 3).rows).toHaveLength(3);
    expect(adAudienceValues("company", rows, 0).rows).toEqual([]);
  });
});

describe("sponsored audience : which reading is due", () => {
  const now = new Date("2026-11-03T10:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const state = (over: Partial<AdAudienceState>): AdAudienceState => ({ syncedAt: null, lastAttemptAt: null, final: false, ...over });

  it("reads what was never read, waits after an attempt, and rereads a revisable reading once a day", () => {
    expect(adAudienceDue(undefined, now)).toBe(true);
    expect(adAudienceDue(state({}), now)).toBe(true);
    expect(adAudienceDue(state({ lastAttemptAt: ago(AD_AUDIENCE_RETRY_MS - 1000) }), now)).toBe(false);
    expect(adAudienceDue(state({ lastAttemptAt: ago(AD_AUDIENCE_RETRY_MS + 1000) }), now)).toBe(true);
    expect(adAudienceDue(state({ syncedAt: ago(AD_AUDIENCE_REFRESH_MS - 1000), lastAttemptAt: ago(AD_AUDIENCE_REFRESH_MS - 1000) }), now)).toBe(false);
    expect(adAudienceDue(state({ syncedAt: ago(AD_AUDIENCE_REFRESH_MS + 1000), lastAttemptAt: ago(AD_AUDIENCE_REFRESH_MS + 1000) }), now)).toBe(true);
  });

  it("never reads a final reading again, and ignores an unreadable date", () => {
    expect(adAudienceDue(state({ final: true, syncedAt: ago(10 * AD_AUDIENCE_REFRESH_MS) }), now)).toBe(false);
    expect(adAudienceDue(state({ syncedAt: "not a date", lastAttemptAt: "also not" }), now)).toBe(true);
  });

  it("makes a reading final only well after the period ended", () => {
    expect(adAudienceFinal("2026-09-30", new Date("2026-10-10T00:00:00Z"))).toBe(false);
    expect(adAudienceFinal("2026-09-30", new Date("2026-10-14T00:00:00Z"))).toBe(false);
    expect(adAudienceFinal("2026-09-30", new Date("2026-10-16T00:00:00Z"))).toBe(true);
    expect(adAudienceFinal("2025-12-31", now)).toBe(true);
  });

  it("picks the first due reading from the newest period, dimensions in display order", () => {
    const periods = [{ start: "2026-07-01", end: "2026-09-30" }, { start: "2026-04-01", end: "2026-06-30" }];
    const states = new Map<string, AdAudienceState>();
    expect(nextAdAudiencePull(periods, states, now)).toEqual({ dimension: "function", start: "2026-07-01", end: "2026-09-30" });
    // Un découpage fraîchement tenté est sauté, le suivant est pris.
    states.set(adAudienceKey("linkedin", "function", "2026-07-01", "2026-09-30"), state({ syncedAt: ago(1000), lastAttemptAt: ago(1000) }));
    expect(nextAdAudiencePull(periods, states, now)).toEqual({ dimension: "title", start: "2026-07-01", end: "2026-09-30" });
    // Tous les découpages de la période la plus récente faits ou définitifs : on passe à la précédente.
    for (const { key } of AD_AUDIENCE_DIMENSIONS) states.set(adAudienceKey("linkedin", key, "2026-07-01", "2026-09-30"), state({ final: true, syncedAt: ago(1000) }));
    expect(nextAdAudiencePull(periods, states, now)).toEqual({ dimension: "function", start: "2026-04-01", end: "2026-06-30" });
    for (const { key } of AD_AUDIENCE_DIMENSIONS) states.set(adAudienceKey("linkedin", key, "2026-04-01", "2026-06-30"), state({ final: true, syncedAt: ago(1000) }));
    expect(nextAdAudiencePull(periods, states, now)).toBeNull();
    expect(nextAdAudiencePull([], new Map(), now)).toBeNull();
  });
});
