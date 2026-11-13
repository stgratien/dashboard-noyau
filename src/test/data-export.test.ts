import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialData } from "../components/dashboard/common";
import { buildDataExport, exportFileName, exportToJson, parisLocal, type DataExport, type ExportTable } from "../lib/data-export";
import { realBlendedTotals } from "../lib/social-totals";
import { coverage, days, posts } from "./fixtures/young-account";

// Configuration neutre avec l'audience sponsorisée et les tailles d'entreprise activées.
vi.mock("@/client/config", async () => (await import("@/test/fixtures/neutral-client")).neutralClientModule({ features: { adAudience: true, pageAudience: true } }));

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-03T10:00:00Z")); });
afterEach(() => vi.useRealTimers());

const june = { start: "2025-06-01", end: "2025-06-30" };
const may = { start: "2025-05-01", end: "2025-05-31" };
const february = { start: "2025-02-01", end: "2025-02-28" };

const dataFor = (extra: Record<string, unknown> = {}) =>
  ({
    days, posts, ads: [], adCoverage: coverage, statuses: [], promotedPosts: [], paidAds: [], stories: [], storyPulls: [], storiesFailed: false, unusableStatMonths: [],
    audience: [], adLinking: { rule: 0, manual: 0, unlinked: 0 }, statGapsFailed: false,
    adAudience: { rows: [], periods: [], failed: false }, pageAudience: { rows: [], periods: [], failed: false }, ...extra,
  }) as unknown as SocialData;

const NOW = new Date("2026-11-03T10:30:00Z");
const exportOf = (p: "linkedin" | "instagram" | "tiktok" | "facebook", period = june, comparison = may, extra: Record<string, unknown> = {}): DataExport =>
  buildDataExport({ data: dataFor(extra), p, period, comparison, now: NOW });
const table = (model: DataExport, id: string): ExportTable => {
  const found = model.tables.find((t) => t.id === id);
  if (!found) throw new Error(`no table ${id}`);
  return found;
};
const figure = (model: DataExport, indicator: string) => {
  const row = table(model, "keyFigures").rows.find((r) => r.values["indicator"] === indicator);
  if (!row) throw new Error(`no figure ${indicator}`);
  return row;
};

describe("buildDataExport: the sheets of a network tab", () => {
  it("lists the summary, the key figures, the interactions, the formats, the publications, the followers and the audience, in that order", () => {
    expect(exportOf("linkedin").tables.map((t) => t.id)).toEqual(["summary", "keyFigures", "interactions", "formats", "publications", "followersEvolution", "audience"]);
  });

  it("describes the export: dashboard, network, both periods and the generation time in Paris time", () => {
    const { meta } = exportOf("linkedin");
    expect(meta).toMatchObject({ network: "linkedin", networkName: "LinkedIn", period: { start: "2025-06-01", end: "2025-06-30" }, comparison: { start: "2025-05-01", end: "2025-05-31" }, generatedAt: NOW.toISOString() });
    const summary = table(exportOf("linkedin"), "summary").rows.map((r) => r.values);
    expect(summary.find((r) => r["item"] === "Réseau")?.["value"]).toBe("LinkedIn");
    expect(summary.find((r) => r["item"] === "Export généré le (heure de Paris)")?.["value"]).toBe("2026-11-03T11:30:00");
  });
});

describe("buildDataExport: the key figures are the ones of the screen", () => {
  it("takes the period and compared values from the same totals as the network tab, as numbers", () => {
    const t = realBlendedTotals("linkedin", days, posts, june, [], [], coverage);
    const o = realBlendedTotals("linkedin", days, posts, may, [], [], coverage);
    const model = exportOf("linkedin");
    for (const [indicator, key] of [["Impressions totales", "impressions"], ["Interactions totales", "interactions"], ["Budget dépensé", "spend"], ["Clics sur les liens", "clicks"]] as const) {
      const row = figure(model, indicator);
      expect(row.values["period"]).toBe(t[key]);
      expect(row.values["compared"]).toBe(o[key]);
      expect(typeof row.values["period"]).toBe("number");
    }
    expect(figure(model, "Impressions totales").values["change"]).toBeCloseTo(((t.impressions! - o.impressions!) / o.impressions!) * 100, 6);
    expect(figure(model, "Impressions totales").values["changeUnit"]).toBe("%");
  });

  it("gives the engagement rate in points of rate, the cost per engagement on LinkedIn and the cost per view on TikTok", () => {
    const linkedin = exportOf("linkedin");
    expect(figure(linkedin, "Taux d'engagement (sur impressions)").values).toMatchObject({ unit: "%" });
    expect(figure(linkedin, "CPE (coût par engagement)").values["unit"]).toBe("€");
    expect(table(linkedin, "keyFigures").rows.some((r) => r.values["indicator"] === "CPV (coût par vue)")).toBe(false);
    const tiktok = exportOf("tiktok");
    expect(table(tiktok, "keyFigures").rows.some((r) => r.values["indicator"] === "CPV (coût par vue)")).toBe(true);
    expect(table(tiktok, "keyFigures").rows.some((r) => r.values["indicator"] === "CPE (coût par engagement)")).toBe(false);
    expect(figure(tiktok, "Vidéos publiées").values["indicator"]).toBe("Vidéos publiées");
  });

  it("does not compare the followers (the card never follows the comparison) but gives their growth over the period", () => {
    const row = figure(exportOf("linkedin"), "Abonnés");
    expect(row.values["compared"]).toBeNull();
    expect(row.values["change"]).toBeNull();
    expect(table(exportOf("linkedin"), "keyFigures").rows.map((r) => r.values["indicator"])).toContain("Évolution des abonnés sur la période");
  });

  it("does not comment the coverage of the compared period on the followers row, whose comparison is not shown", () => {
    const model = exportOf("facebook", june, february);
    expect(String(figure(model, "Abonnés").values["remark"] ?? "")).not.toContain("période comparée");
    expect(String(figure(model, "Impressions totales").values["remark"] ?? "")).toContain("période comparée partielle");
  });

  it("leaves an unavailable figure empty (never zero) and says why, and marks a partial one", () => {
    // LinkedIn has no organic figures before 05/05/2025: February is partial for the account figures and has no follower count yet.
    const model = exportOf("linkedin", february, { start: "2025-01-01", end: "2025-01-31" });
    const followers = figure(model, "Abonnés").values;
    expect(followers["period"]).toBeNull();
    expect(followers["remark"]).toBe("Donnée non disponible");
    expect(String(figure(model, "Impressions totales").values["remark"])).toMatch(/^partiel : /);
    expect(figure(model, "Impressions totales").values["period"]).toBe(11200);
  });

  it("explains a partial period in the key figures and in the summary, as the grey lines of the screen do", () => {
    const model = exportOf("linkedin", february, may);
    expect(table(model, "keyFigures").rows.some((r) => String(r.values["remark"] ?? "").startsWith("partiel"))).toBe(true);
    const summary = table(model, "summary").rows.map((r) => String(r.values["value"] ?? ""));
    expect(summary.some((v) => /Chiffres partiels|partielle/.test(v))).toBe(true);
  });

  it("hides the variation when the two periods do not cover the same sources, and says the compared period is partial", () => {
    const model = exportOf("linkedin", june, february);
    const row = figure(model, "Impressions totales");
    expect(row.values["period"]).toBe(27000);
    expect(row.values["compared"]).toBe(11200);
    expect(row.values["change"]).toBeNull();
    expect(row.values["changeUnit"]).toBe("");
    expect(String(row.values["remark"])).toMatch(/période comparée partielle/);
  });

  it("keeps the stories of Instagram with the key figures and nowhere else", () => {
    const instagram = exportOf("instagram");
    expect(table(instagram, "keyFigures").rows.filter((r) => r.values["section"] === "Stories").map((r) => r.values["indicator"])).toEqual([
      "Stories publiées", "Impressions des stories", "Impressions moy. / story", "Interactions des stories",
    ]);
    expect(table(exportOf("linkedin"), "keyFigures").rows.some((r) => r.values["section"] === "Stories")).toBe(false);
  });
});

describe("buildDataExport: the publications", () => {
  it("lists every publication of the period, newest first, with the Paris time, the figures as numbers and unknown figures empty", () => {
    const rows = table(exportOf("linkedin"), "publications").rows.map((r) => r.values);
    const inJune = posts.filter((x) => x.platform === "linkedin" && x.published_at.slice(0, 10) >= june.start && x.published_at.slice(0, 10) <= june.end);
    expect(rows).toHaveLength(inJune.length);
    expect(rows.length).toBeGreaterThan(3);
    const dates = rows.map((r) => String(r["date"]));
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(dates[0]).toMatch(/^2025-06-\d\dT12:00:00$/);
    expect(rows[0]).toMatchObject({ type: "Organique", format: "Photo", impressions: 300, likes: 5, comments: 1, shares: 1, interactions: 7 });
    expect(rows[0]?.["spend"]).toBeNull();
    expect(rows[0]?.["link"]).toBeNull();
  });

  it("counts the formats of the publications of the period only", () => {
    const formats = table(exportOf("linkedin"), "formats").rows.map((r) => r.values);
    expect(formats).toEqual([{ format: "Photo", count: table(exportOf("linkedin"), "publications").rows.length }]);
  });

  it("calls the first figure column « Vues » on TikTok", () => {
    expect(table(exportOf("tiktok"), "publications").columns.find((c) => c.key === "impressions")?.label).toBe("Vues");
    expect(table(exportOf("linkedin"), "publications").columns.find((c) => c.key === "impressions")?.label).toBe("Impressions");
  });
});

describe("buildDataExport: the audience sheets", () => {
  it("adds the sponsored audience and the company sizes only when they are readable for the period", () => {
    expect(exportOf("linkedin").tables.map((t) => t.id)).not.toContain("sponsoredAudience");
    expect(exportOf("linkedin").tables.map((t) => t.id)).not.toContain("companySizes");
    const quarter = { start: "2025-04-01", end: "2025-06-30" }, before = { start: "2025-01-01", end: "2025-03-31" };
    const ad = (range: { start: string; end: string }) => ({ platform: "linkedin", dimension: "function", period_start: range.start, period_end: range.end, returned_count: 1, is_final: true, synced_at: "2026-11-03T08:00:00Z" });
    const adValue = (range: { start: string; end: string }, impressions: number) => ({ platform: "linkedin", dimension: "function", period_start: range.start, period_end: range.end, label: "Engineering", impressions, clicks: 10 });
    const size = (range: { start: string; end: string }, dimension: string, views: number) => ({ platform: "linkedin", dimension, period_start: range.start, period_end: range.end, label: "SIZE_11_TO_50", views });
    const sizeReading = (range: { start: string; end: string }, dimension: string) => ({ platform: "linkedin", dimension, period_start: range.start, period_end: range.end, returned_count: 1, total_views: 200, is_final: true, synced_at: "2026-11-03T08:00:00Z" });
    const model = exportOf("linkedin", quarter, before, {
      adAudience: { failed: false, periods: [ad(quarter), ad(before)], rows: [adValue(quarter, 1000), adValue(before, 500)] },
      pageAudience: { failed: false, periods: [sizeReading(quarter, "companySize"), sizeReading(quarter, "followersCompanySize")], rows: [size(quarter, "companySize", 100), size(quarter, "followersCompanySize", 50)] },
    });
    const sponsored = table(model, "sponsoredAudience").rows[0]?.values;
    expect(sponsored).toMatchObject({ label: "Engineering", impressions: 1000, clicks: 10, comparedImpressions: 500 });
    // The other breakdowns have no reading: each says so instead of disappearing.
    const sponsoredRows = table(model, "sponsoredAudience").rows.map((r) => r.values);
    expect(sponsoredRows.filter((r) => r["label"] === "Donnée non disponible").length).toBeGreaterThanOrEqual(4);
    const sizes = table(model, "companySizes").rows.map((r) => r.values);
    expect(sizes.map((r) => [r["measure"], r["period"], String(r["size"]).replace(/[\u00a0\u202f]/g, " "), r["value"], r["share"]])).toEqual([
      ["Visiteurs", "T2 2025", "11-50 employés", 100, 50], ["Visiteurs", "T1 2025", "Donnée non disponible", null, null],
      ["Abonnés", "T2 2025", "11-50 employés", 50, 25], ["Abonnés", "T1 2025", "Donnée non disponible", null, null],
    ]);
  });
});

describe("exportToJson", () => {
  it("writes the metadata, then every sheet with its typed columns and its rows as objects, numbers staying numbers and unknown values null", () => {
    const json = JSON.parse(exportToJson(exportOf("linkedin")));
    expect(json.meta).toMatchObject({ network: "linkedin", period: { start: "2025-06-01" } });
    expect(Object.keys(json.sheets)).toEqual(["summary", "keyFigures", "interactions", "formats", "publications", "followersEvolution", "audience"]);
    const figures = json.sheets.keyFigures;
    expect(figures.name).toBe("Chiffres clés");
    expect(figures.columns.map((c: { key: string }) => c.key)).toEqual(["section", "indicator", "unit", "period", "compared", "change", "changeUnit", "remark"]);
    const impressions = figures.rows.find((r: Record<string, unknown>) => r["indicator"] === "Impressions totales");
    expect(typeof impressions.period).toBe("number");
    expect(figures.rows.find((r: Record<string, unknown>) => r["indicator"] === "Abonnés").compared).toBeNull();
    expect(json.sheets.publications.rows[0]).toHaveProperty("date");
  });
});

describe("exportFileName and parisLocal", () => {
  it("names the file after the dashboard, the network and the period, without accent or space", () => {
    expect(exportFileName(exportOf("linkedin"), "xlsx")).toBe("DE-LinkedIn-juin-2025.xlsx");
    expect(exportFileName(exportOf("linkedin", { start: "2025-06-03", end: "2025-06-20" }, may), "json")).toMatch(/^DE-LinkedIn-.*\.json$/);
  });

  it("converts an instant to the Paris clock (summer and winter time)", () => {
    expect(parisLocal(Date.parse("2025-06-14T22:30:00Z"))).toBe("2025-06-15T00:30:00");
    expect(parisLocal(Date.parse("2025-12-14T22:30:00Z"))).toBe("2025-12-14T23:30:00");
    expect(parisLocal(Number.NaN)).toBeNull();
  });
});

describe("buildDataExport: the compared value and the notes follow the screen", () => {
  it("keeps the compared value of a card whose variation is hidden (TikTok without a published video), and drops only the variation", () => {
    // The fixture's TikTok posts are photos: no video in the period, the cohort cards show « vs X » without a change on the screen.
    const model = exportOf("tiktok");
    for (const indicator of ["Impressions totales", "Interactions totales", "Impressions moy. / post"]) {
      const row = figure(model, indicator);
      expect(row.values["compared"], indicator).not.toBeNull();
      expect(row.values["change"], indicator).toBeNull();
    }
    expect(figure(model, "Taux d'engagement (sur impressions)").values["compared"]).not.toBeNull();
    expect(String(figure(model, "Impressions totales").values["remark"])).toContain("Aucune vidéo publiée sur la période");
    expect(figure(model, "Abonnés").values["compared"]).toBeNull();
  });

  it("keeps the compared video views and says, as the screen does, that the views are those of videos published before the period", () => {
    // The fixture publishes photos only: no video in the period, but video views on the account.
    const row = figure(exportOf("linkedin"), "Vues de vidéo");
    expect(row.values["compared"]).not.toBeNull();
    expect(String(row.values["remark"])).toContain("Vues de vidéos publiées avant la période");
  });

  it("does not write « partiel » next to an unavailable figure, but keeps the other mentions", () => {
    const model = exportOf("linkedin", february, { start: "2025-01-01", end: "2025-01-31" });
    const followers = figure(model, "Abonnés").values;
    expect(followers["period"]).toBeNull();
    expect(String(followers["remark"])).not.toContain("partiel");
    expect(String(figure(model, "Nouveaux abonnés").values["remark"])).toBe("Donnée non disponible");
  });

  it("puts the follower growth right after the followers and the stories between Engagement and Média, as the screen does", () => {
    const sections = (model: DataExport) => table(model, "keyFigures").rows.map((r) => r.values["section"]);
    expect(table(exportOf("linkedin"), "keyFigures").rows.slice(0, 3).map((r) => r.values["indicator"])).toEqual(["Abonnés", "Évolution des abonnés sur la période", "Évolution des abonnés sur la période (%)"]);
    const order = [...new Set(sections(exportOf("instagram")))];
    expect(order).toEqual(["Activité", "Visibilité", "Engagement", "Stories", "Média", "Coûts média"]);
  });

  it("gives the interaction shares on the total of the interactions, and none when one of the three is unknown", () => {
    const withShares = exportOf("linkedin");
    const shares = table(withShares, "interactions").rows.map((r) => r.values["share"] as number);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
    // Instagram without the account shares on the period: the total is unknown, so is every share (the screen shows « Donnée non disponible »).
    const noShares = days.map((d) => (d.platform === "instagram" && d.day >= june.start && d.day <= june.end ? { ...d, metrics: { ...d.metrics, shares: null } } : d));
    const t = realBlendedTotals("instagram", noShares, posts, june, [], [], coverage);
    expect(t.interactions).toBeNull();
    const model = buildDataExport({ data: dataFor({ days: noShares }), p: "instagram", period: june, comparison: may, now: NOW });
    const rows = table(model, "interactions").rows.map((r) => r.values);
    expect(rows.some((r) => r["volume"] != null)).toBe(true);
    expect(rows.every((r) => r["share"] == null)).toBe(true);
  });

  it("writes the Stories rows with their values and says when the period is only partly read", () => {
    const stories = [
      { platform: "instagram", story_id: "a", published_at: "2025-06-10T10:00:00Z", views: 100, reach: 80, replies: 2, shares: 1, interactions: 5 },
      { platform: "instagram", story_id: "b", published_at: "2025-06-11T10:00:00Z", views: 300, reach: 200, replies: 0, shares: 0, interactions: null },
    ];
    const pulls = [{ platform: "instagram", day: "2025-06-05", pulls: 1, through: "2025-06-30", level: "complete" as const }];
    const model = buildDataExport({ data: dataFor({ stories, storyPulls: pulls }), p: "instagram", period: june, comparison: may, now: NOW });
    const rows = table(model, "keyFigures").rows.filter((r) => r.values["section"] === "Stories").map((r) => r.values);
    expect(rows.map((r) => [r["indicator"], r["period"]])).toEqual([["Stories publiées", 2], ["Impressions des stories", 400], ["Impressions moy. / story", 200], ["Interactions des stories", 5]]);
    // Never the same word twice in a remark.
    for (const r of rows) expect(String(r["remark"] ?? "").match(/partiel/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });
});

describe("buildDataExport: the other sheets keep the screen's meaning", () => {
  it("writes the audience with their units and says when there is none", () => {
    expect(table(exportOf("linkedin"), "audience").rows.map((r) => r.values["label"])).toContain("Donnée non disponible");
    const audience = [
      { platform: "linkedin", dimension: "country", label: "FR", value: "120", unit: "count", synced_at: "2026-11-03T08:00:00Z" },
      { platform: "linkedin", dimension: "industry", label: "Software", value: 12.5, unit: "percent", synced_at: "2026-11-03T08:00:00Z" },
    ];
    const rows = table(exportOf("linkedin", june, may, { audience }), "audience").rows;
    const france = rows.find((r) => r.values["label"] === "France");
    expect(france?.values["value"]).toBe(120);
    expect(france?.kinds?.["value"]).toBe("integer");
    const software = rows.find((r) => r.values["label"] === "Software");
    expect(software?.values["value"]).toBe(12.5);
    expect(software?.kinds?.["value"]).toBe("decimal");
  });

  it("lists the promoted older posts and the ads without a post, and gives an ad only its first day", () => {
    const old = { ...posts.find((x) => x.platform === "linkedin")!, post_id: "old-1", published_at: "2025-04-02T10:00:00Z", title: "Ancienne" };
    const ad = { platform: "linkedin", ad_id: "ad-1", title: "Pub seule", thumbnail_url: "", first_day: "2025-06-10", spend: 40, impressions: 4000, likes: 3, comments: 1, shares: 0, permalink: "" };
    const model = exportOf("linkedin", june, may, { promotedPosts: [old], paidAds: [ad] });
    const rows = table(model, "publications").rows;
    const titles = rows.map((r) => r.values["title"]);
    expect(titles).toContain("Ancienne");
    expect(titles).toContain("Pub seule");
    const adRow = rows.find((r) => r.values["title"] === "Pub seule")!;
    expect(adRow.values["date"]).toBe("2025-06-10");
    expect(adRow.kinds?.["date"]).toBe("date");
    expect(adRow.values).toMatchObject({ type: "Paid", format: "Publicité", impressions: 4000, spend: 40, cpm: 10 });
    // Posts keep their time; the table is newest first whatever the row kind.
    expect(String(rows.find((r) => r.values["title"] === "Ancienne")?.values["date"])).toBe("2025-04-02T12:00:00");
  });

  it("copes with very long titles and awkward characters without throwing", () => {
    const post = { ...posts.find((x) => x.platform === "linkedin")!, post_id: "weird", published_at: "2025-06-12T10:00:00Z", title: `=SUM(A1) ${"é".repeat(40000)}` };
    const model = exportOf("linkedin", june, may, { posts: [...posts, post] });
    expect(table(model, "publications").rows.some((r) => String(r.values["title"]).startsWith("=SUM(A1)"))).toBe(true);
  });
});

describe("exportFileName limits", () => {
  it("keeps the name short, without accents or ligatures, and never empty", () => {
    const long = { ...exportOf("linkedin"), meta: { ...exportOf("linkedin").meta, period: { start: "a", end: "b", name: `du 1er au 30 de l'été œuvre ${"très long ".repeat(30)}` } } };
    const name = exportFileName(long, "xlsx");
    expect(name.length).toBeLessThanOrEqual(85);
    expect(name).toMatch(/^[A-Za-z0-9-]+\.xlsx$/);
    expect(name).toContain("oeuvre");
    const odd = { ...exportOf("linkedin"), meta: { ...exportOf("linkedin").meta, period: { start: "a", end: "b", name: "日本語" } } };
    expect(exportFileName(odd, "json")).toBe("DE-LinkedIn-export.json");
  });
});
