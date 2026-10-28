import { describe, expect, it, vi } from "vitest";
import { PLATFORMS, getSeries, getPosts, blendedTotals, allNetworkTotals, followersAt } from "../lib/dashboard-data";
import { allTimeShortcut, DATA_START, lastDays, previousPeriod, previousEdition, periodDays, periodShortcuts, periodShortcutGroups, comparisonFor, comparisonChoice, twoYearsAvailable, comparisonEditions, EDITIONS, todayISO, yesterdayISO } from "../lib/dashboard-periods";

// Configuration neutre : les éditions et le début des données ne viennent pas du client de ce dépôt (les faits propres au client se testent dans le dossier src/client/tests de son dépôt).
vi.mock("@/client/config", async () => (await import("@/test/fixtures/neutral-client")).neutralClientModule());

describe("dashboard metrics", () => {
  for (const p of PLATFORMS) {
    for (const days of [7, 30, 90]) {
      it(`${p.id} / ${days}: exact blended totals and paid-only costs`, () => {
        const period = lastDays(days, "2026-10-16");
        const series = getSeries(p.id, period);
        const t = blendedTotals(p.id, series, period);
        const sum = (fn: (d: typeof series[number]) => number) => series.reduce((a, d) => a + fn(d), 0);
        expect(t.impressions).toBe(sum(d => d.orgImpressions + d.impressions));
        expect(t.videoViews).toBe(sum(d => d.videoViews + d.paidVideoViews));
        expect(t.interactions).toBe(sum(d => d.likes + d.comments + d.shares + d.paidLikes + d.paidComments + d.paidShares));
        expect(t.interactionBreakdown.reduce((a, d) => a + d.v, 0)).toBe(t.interactions);
        expect(t.engagementRate).toBe(t.interactions / t.impressions * 100);
        expect(t.clicks).toBe(sum(d => d.orgLinkClicks + d.paidLinkClicks));
        expect(t.cpc).toBe(t.spend / sum(d => d.paidLinkClicks));
        expect(t.cpm).toBe(t.spend / sum(d => d.impressions) * 1000);
        for (const post of getPosts(p.id, period)) {
          expect(post.rate).toBe((post.likes + post.comments + post.shares) / post.impressions * 100);
          expect(post.thumbnail_url).toBeTruthy();
          expect(post.permalink).toContain(`/publications/${p.id}/`);
        }
      });
    }
  }
  it("has only the four social platforms in the requested order", () => {
    expect(PLATFORMS.map(p => p.id)).toEqual(["facebook", "instagram", "linkedin", "tiktok"]);
  });

  for (const period of periodShortcuts("2026-10-16")) {
    it(`${period.name}: exact Global totals for the selected and comparison ranges`, () => {
      for (const range of [period, previousPeriod(period), comparisonFor(period, "edition").period]) {
        const totals = PLATFORMS.map(({ id }) => blendedTotals(id, getSeries(id, range), range));
        const global = allNetworkTotals(totals);
        for (const key of ["impressions", "interactions", "followers", "spend"] as const) {
          expect(global[key]).toBe(totals.reduce((sum, t) => sum + t[key], 0));
          expect(global[key]).toBeGreaterThanOrEqual(0);
        }
        for (const { id } of PLATFORMS) {
          const series = getSeries(id, range);
          expect(series).toHaveLength(periodDays(range));
          expect(blendedTotals(id, series, range).followers).toBe(followersAt(id, range.end));
        }
        expect(getPosts("facebook", range).length).toBeGreaterThan(0);
      }
    });
  }

  it("keeps overlapping calendar days and period-end followers identical", () => {
    const long = lastDays(30, "2027-09-19"), short = lastDays(7, "2027-09-19");
    expect(getSeries("facebook", long).slice(-7)).toEqual(getSeries("facebook", short));
    expect(blendedTotals("facebook", getSeries("facebook", long), long).followers)
      .toBe(blendedTotals("facebook", getSeries("facebook", short), short).followers);
  });

  it("generates a single-day range including Top publications", () => {
    const period = { start: "2030-01-01", end: "2030-01-01" };
    expect(getSeries("tiktok", period)).toHaveLength(1);
    expect(getPosts("tiktok", period).every((post) => post.date === "01/01")).toBe(true);
  });
});

describe("dashboard periods", () => {
  it("uses inclusive days and the immediately preceding period across leap years", () => {
    expect(periodDays({ start: "2024-02-28", end: "2024-03-01" })).toBe(3);
    expect(previousPeriod({ start: "2027-09-13", end: "2027-09-19" })).toEqual({ start: "2027-09-06", end: "2027-09-12" });
  });
  it("compares Edition 2027 with the exact Edition 2025 dates", () => {
    const edition = EDITIONS.find((e) => e.name === "Edition 2027");
    if (!edition) throw new Error("Missing Edition 2027 configuration");
    expect(comparisonFor(edition, "edition")).toEqual({ period: { name: "Edition 2025", start: "2025-09-15", end: "2025-09-21" }, label: "vs Edition 2025", description: "Edition 2025" });
    expect(previousEdition({ start: "2027-09-13", end: "2027-09-20" })).toBeUndefined();
    expect(previousEdition({ start: "2025-09-15", end: "2025-09-21" })).toEqual({ name: "Edition 2023", start: "2023-09-11", end: "2023-09-17" });
    expect(comparisonFor(lastDays(30, "2026-10-16"), "edition").label).toBe("vs préc.");
  });
  it("calculates current year and previous month from the reference date", () => {
    const shortcuts = periodShortcuts("2026-01-10");
    expect(shortcuts.find((p) => p.name === "Mois précédent")).toEqual({ name: "Mois précédent", start: "2025-12-01", end: "2025-12-31", comparisonKind: "month" });
    expect(shortcuts.find((p) => p.name === "Année en cours")).toEqual({ name: "Année en cours", start: "2026-01-01", end: "2026-01-09", comparisonKind: "year" });
  });
  it("offers « Toute la période » from the first day of data to yesterday, outside the expandable groups", () => {
    expect(allTimeShortcut("2026-10-20")).toEqual({ name: "Toute la période", start: DATA_START, end: "2026-10-19" });
    expect(DATA_START).toBe("2023-06-05");
    expect(periodShortcutGroups("2026-10-20").flatMap((g) => g.items.map((i) => i.name))).not.toContain("Toute la période");
  });
  it("compares with a custom period as chosen, whatever the main period", () => {
    const custom = { start: "2025-01-01", end: "2025-03-31" };
    expect(comparisonFor(lastDays(30, "2026-10-16"), "custom", custom)).toEqual({ period: custom, label: "vs 01/01/2025 – 31/03/2025", description: "Période personnalisée" });
    expect(comparisonFor({ start: "2026-04-01", end: "2026-06-30", comparisonKind: "quarter" }, "custom", custom).period).toEqual(custom);
    // Sans dates choisies, on retombe sur la période précédente.
    expect(comparisonFor(lastDays(30, "2026-10-16"), "custom").period).toEqual(previousPeriod(lastDays(30, "2026-10-16")));
    // Les autres modes ne changent pas.
    expect(comparisonFor(lastDays(30, "2026-10-16"), "previous", custom).label).toBe("vs préc.");
  });
  it("offers the finished editions as named comparison shortcuts, never the edition already displayed", () => {
    expect(comparisonEditions(lastDays(30, "2026-10-16"), "2026-10-16").map((e) => e.name)).toEqual(["Edition 2023", "Edition 2025"]);
    expect(comparisonEditions({ start: "2025-09-15", end: "2025-09-21" }, "2026-10-16").map((e) => e.name)).toEqual(["Edition 2023"]);
    // Une édition qui n'est pas terminée n'est pas proposée.
    expect(comparisonEditions(lastDays(30, "2025-09-19"), "2025-09-19").map((e) => e.name)).toEqual(["Edition 2023"]);
    const edition = EDITIONS.find((e) => e.name === "Edition 2023");
    if (!edition) throw new Error("Missing Edition 2023 configuration");
    expect(comparisonFor(lastDays(30, "2026-10-16"), "custom", edition)).toEqual({ period: edition, label: "vs Edition 2023", description: "Edition 2023" });
  });
  it("offers no quarter that has not started yet", () => {
    const quarters = periodShortcuts("2026-03-10").filter((p) => p.comparisonKind === "quarter").map((p) => p.name);
    expect(quarters).toContain("T1 2026");
    expect(quarters).not.toContain("T2 2026");
    expect(quarters).toContain("T4 2025");
    for (const p of periodShortcuts("2026-03-10")) expect(p.start <= p.end).toBe(true);
    expect(periodShortcuts("2026-10-18").find((p) => p.name === "T4 2026")).toMatchObject({ start: "2026-10-01", end: "2026-10-17" });
  });
  it("compares a quarter in progress with the same days of the previous quarter", () => {
    const partial = periodShortcuts("2026-10-18").find((p) => p.name === "T4 2026");
    if (!partial) throw new Error("Missing T4 2026");
    const c = comparisonFor(partial, "previous");
    expect(c.period).toEqual({ start: "2026-07-01", end: "2026-07-17" });
    expect(c.label).toBe("vs T3 2026");
    expect(c.description).toBe("T3 2026 (mêmes jours)");
    const full = periodShortcuts("2026-10-18").find((p) => p.name === "T3 2026");
    if (!full) throw new Error("Missing T3 2026");
    expect(comparisonFor(full, "previous")).toMatchObject({ period: { start: "2026-04-01", end: "2026-06-30" }, description: "T2 2026" });
    const twoYears = comparisonFor(partial, "two-years");
    expect(twoYears.period).toEqual({ start: "2024-10-01", end: "2024-10-17" });
    expect(twoYears.description).toBe("T4 2024 (mêmes jours)");
    expect(comparisonFor(full, "two-years").description).toBe("T3 2024");
  });
  it("offers the same period two years earlier from the comparison list, whatever the period shown", () => {
    const full = periodShortcuts("2026-10-18").find((p) => p.name === "T3 2026");
    if (!full) throw new Error("Missing T3 2026");
    expect(comparisonFor(full, "two-years")).toMatchObject({ period: { start: "2024-07-01", end: "2024-09-30" }, label: "vs T3 2024" });
    // A free range keeps its days: the label cannot name a quarter.
    expect(comparisonFor({ start: "2026-02-10", end: "2026-03-20" }, "two-years")).toMatchObject({ period: { start: "2024-02-10", end: "2024-03-20" }, label: "vs même période 2024" });
    expect(comparisonChoice("two-years")).toBe("two-years");
    expect(comparisonChoice("previous")).toBe("previous");
    expect(comparisonChoice("custom")).toBe("custom");
    expect(comparisonChoice("custom", "Edition 2023")).toBe("edition:Edition 2023");
  });
  it("offers the two-years comparison only when the shifted period ends before the displayed one", () => {
    expect(twoYearsAvailable({ start: "2026-07-01", end: "2026-09-30" })).toBe(true);
    expect(twoYearsAvailable({ start: "2024-10-01", end: "2026-10-27" })).toBe(false);
    // The shifted end must precede the start: a period just under two years long still qualifies, one just over does not.
    expect(twoYearsAvailable({ start: "2024-10-28", end: "2026-10-27" })).toBe(true);
    expect(twoYearsAvailable({ start: "2024-10-27", end: "2026-10-27" })).toBe(false);
    expect(twoYearsAvailable(allTimeShortcut("2026-10-28"))).toBe(false);
  });
  it("lists every full year since 2023, so 2026 appears in 2027", () => {
    const names = (today: string) => periodShortcutGroups(today).find((g) => g.name === "Années")?.items.map((p) => p.name);
    expect(names("2026-10-18")).toEqual(["Année en cours", "2025", "2024", "2023"]);
    expect(names("2027-01-02")).toEqual(["Année en cours", "2026", "2025", "2024", "2023"]);
  });
  it("follows the Paris day, not UTC, for today and yesterday", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-18T22:30:00Z"));
      expect([todayISO(), yesterdayISO()]).toEqual(["2026-10-19", "2026-10-18"]);
      vi.setSystemTime(new Date("2026-12-31T23:30:00Z"));
      expect([todayISO(), yesterdayISO()]).toEqual(["2027-01-01", "2026-12-31"]);
      vi.setSystemTime(new Date("2027-03-28T23:30:00Z"));
      expect(yesterdayISO()).toBe("2027-03-28");
    } finally {
      vi.useRealTimers();
    }
  });
});