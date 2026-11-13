import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import type { SocialData } from "../components/dashboard/common";
import { exportFileName, exportToJson, type DataExport, type ExportTable } from "../lib/data-export";
import { buildGlobalExport, type GlobalExportInput } from "../lib/data-export-global";
import { buildXlsx } from "../lib/data-export-xlsx";
import { globalTotals, networkTotals } from "../lib/global-totals";
import { coverage, days, posts } from "./fixtures/young-account";
import { youtubeConnected } from "./fixtures/youtube-account";

// Configuration neutre : quatre réseaux, donc un onglet Global.
vi.mock("@/client/config", async () => (await import("@/test/fixtures/neutral-client")).neutralClientModule({ features: { dataExport: true } }));

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-03T10:00:00Z")); });
afterEach(() => vi.useRealTimers());

const june = { start: "2025-06-01", end: "2025-06-30" };
const may = { start: "2025-05-01", end: "2025-05-31" };
const february = { start: "2025-02-01", end: "2025-02-28" };
const NOW = new Date("2026-11-03T10:30:00Z");

const data = {
  days, posts, ads: [], adCoverage: coverage, statuses: [], promotedPosts: [], paidAds: [], stories: [], storyPulls: [], storiesFailed: false, unusableStatMonths: [],
  audience: [], adLinking: { rule: 0, manual: 0, unlinked: 0 }, statGapsFailed: false,
  adAudience: { rows: [], periods: [], failed: false }, pageAudience: { rows: [], periods: [], failed: false },
} as unknown as SocialData;

const exportOf = (extra: Partial<GlobalExportInput> = {}): DataExport =>
  buildGlobalExport({ data, google: undefined, youtube: undefined, youtubeUnavailable: false, period: june, comparison: may, now: NOW, ...extra });
const table = (model: DataExport, id: string): ExportTable => {
  const found = model.tables.find((t) => t.id === id);
  if (!found) throw new Error(`no table ${id}`);
  return found;
};
const figure = (model: DataExport, indicator: string) => {
  const row = table(model, "keyFigures").rows.find((r) => r.values["indicator"] === indicator);
  if (!row) throw new Error(`no figure ${indicator}`);
  return row.values;
};

describe("buildGlobalExport: the sheets of the Global tab", () => {
  it("lists the summary, the key figures of all networks and the per-network key figures, in that order", () => {
    expect(exportOf().tables.map((t) => t.id)).toEqual(["summary", "keyFigures", "networks"]);
    expect(exportOf().tables.map((t) => t.name)).toEqual(["Résumé", "Chiffres clés", "Par réseau"]);
  });

  it("describes the Global tab, its period and its comparison", () => {
    const model = exportOf();
    expect(model.meta).toMatchObject({ network: "overview", networkName: "Global", period: { start: "2025-06-01", end: "2025-06-30" }, comparison: { start: "2025-05-01", end: "2025-05-31" }, generatedAt: "2026-11-03T10:30:00.000Z" });
    const summary = Object.fromEntries(table(model, "summary").rows.filter((r) => r.values["item"]).map((r) => [r.values["item"], r.values["value"]]));
    expect(summary["Onglet"]).toBe("Global (tous réseaux)");
    expect(String(summary["Période"])).toContain("2025-06-01 au 2025-06-30");
    expect(String(summary["Période comparée"])).toContain("2025-05-01 au 2025-05-31");
    expect(summary["Export généré le (heure de Paris)"]).toBe("2026-11-03T11:30:00");
    expect(summary["Réseaux additionnés"]).toBe("Facebook, Instagram, LinkedIn, TikTok");
  });

  it("gives the thirteen cards of the screen, with the screen's labels, in the screen's order", () => {
    const labels = table(exportOf(), "keyFigures").rows.map((r) => r.values["indicator"]);
    expect(labels).toEqual([
      "Abonnés", "Évolution des abonnés sur la période", "Évolution des abonnés sur la période (%)", "Posts publiés", "Vidéos publiées", "Annonces diffusées", "Impressions",
      "Impressions moy. / post", "Vues de vidéo", "Interactions", "Clics sur les liens", "Taux d'engagement", "Budget", "CPE moyen", "CPM moyen",
    ]);
  });

  it("takes every figure from the same totals as the tab (never recomputed)", () => {
    const { t, o } = globalTotals(networkTotals(data, june, may), undefined, undefined, false, june, may);
    const model = exportOf();
    expect(figure(model, "Abonnés")["period"]).toBe(t.followers);
    expect(figure(model, "Posts publiés")).toMatchObject({ period: t.posts, compared: o.posts });
    expect(figure(model, "Impressions")).toMatchObject({ period: t.impressions, compared: o.impressions });
    expect(figure(model, "Interactions")).toMatchObject({ period: t.interactions, compared: o.interactions });
    expect(figure(model, "Taux d'engagement")["period"]).toBe(t.engagementRate);
    expect(figure(model, "Budget")["period"]).toBe(t.spend);
    expect(figure(model, "CPM moyen")["period"]).toBe(t.cpm);
  });

  it("keeps numbers as numbers and an unavailable figure empty, with its reason", () => {
    const model = exportOf();
    for (const r of table(model, "keyFigures").rows) {
      for (const key of ["period", "compared", "change"]) expect(["number", "object"]).toContain(typeof r.values[key]);
    }
    const unavailable = table(model, "keyFigures").rows.filter((r) => r.values["period"] == null);
    for (const r of unavailable) expect(String(r.values["remark"])).toMatch(/Donnée non disponible|Source indisponible/);
  });

  it("gives the Abonnés card no comparison and a change in points for the rate", () => {
    const model = exportOf();
    expect(figure(model, "Abonnés")).toMatchObject({ compared: null, change: null });
    // Juin et mai ont les mêmes sources pour le taux : l'écart est donné, en points.
    const rate = figure(model, "Taux d'engagement");
    expect(rate["change"]).not.toBeNull();
    expect(rate["changeUnit"]).toBe("points");
    expect(table(model, "keyFigures").rows.find((r) => r.values["indicator"] === "Impressions")?.values["changeUnit"]).toMatch(/^(%|)$/);
  });

  it("hides a change when the two periods do not cover the same networks and sources, like the screen", () => {
    // Février n'a pas l'historique de tous les réseaux : les variations de ses cartes partielles sont masquées.
    const model = exportOf({ period: june, comparison: february });
    const partial = table(model, "keyFigures").rows.filter((r) => String(r.values["remark"] ?? "").includes("période comparée partielle"));
    for (const r of partial) {
      if (r.values["indicator"] === "Abonnés") continue;
      expect(r.values["change"], String(r.values["indicator"])).toBeNull();
    }
  });

  it("does not comment the compared coverage on the Abonnés row, whose comparison is not shown", () => {
    // Février n'a ni Facebook, ni LinkedIn, ni TikTok : les cartes chiffrées le disent, « Abonnés » (sans période comparée) se tait.
    const model = exportOf({ period: june, comparison: february });
    expect(String(figure(model, "Abonnés")["remark"] ?? "")).not.toContain("période comparée");
    expect(String(figure(model, "Impressions")["remark"] ?? "")).toContain("période comparée partielle");
  });

  it("does not comment the compared coverage next to an empty compared value, as the screen adds « (partiel) » only to a shown value", () => {
    const model = exportOf({ period: june, comparison: { start: "2024-06-01", end: "2024-06-30" } });
    const row = figure(model, "Impressions");
    expect(row["compared"]).toBeNull();
    expect(String(row["remark"] ?? "")).not.toContain("période comparée");
  });

  it("lists the key figures of each network in « Par réseau », the same as its own tab", () => {
    const networks = table(exportOf(), "networks");
    expect(networks.columns.map((c) => c.key)).toEqual(["network", "section", "indicator", "unit", "period", "compared", "change", "changeUnit", "remark"]);
    const names = [...new Set(networks.rows.map((r) => r.values["network"]))];
    expect(names).toEqual(["Facebook", "Instagram", "LinkedIn", "TikTok"]);
    const { rows } = { rows: networkTotals(data, june, may) };
    const linkedin = rows.find((r) => r.p === "linkedin")!;
    const impressions = networks.rows.find((r) => r.values["network"] === "LinkedIn" && r.values["indicator"] === "Impressions totales")!;
    expect(impressions.values["period"]).toBe(linkedin.current.impressions);
    expect(impressions.values["compared"]).toBe(linkedin.previous.impressions);
  });

  it("writes the grey partial notes of the screen in the summary", () => {
    const summary = table(exportOf({ period: june, comparison: february }), "summary").rows.map((r) => `${r.values["item"] ?? ""} ${r.values["value"]}`).join("\n");
    expect(summary).toMatch(/Chiffres partiels|partielle/);
  });
});

describe("buildGlobalExport: YouTube", () => {
  it("adds YouTube to the total once it is connected, and says so", () => {
    const without = exportOf();
    const withYoutube = exportOf({ youtube: youtubeConnected });
    const { t } = globalTotals(networkTotals(data, june, may), undefined, youtubeConnected, false, june, may);
    expect(figure(withYoutube, "Abonnés")["period"]).toBe(t.followers);
    expect(figure(withYoutube, "Abonnés")["period"]).not.toBe(figure(without, "Abonnés")["period"]);
    expect(figure(withYoutube, "Interactions")["period"]).toBe(t.interactions);
    // Le budget et les impressions ne changent pas : YouTube n'y entre jamais.
    expect(figure(withYoutube, "Budget")["period"]).toBe(figure(without, "Budget")["period"]);
    expect(figure(withYoutube, "Impressions")["period"]).toBe(figure(without, "Impressions")["period"]);
    const summary = table(withYoutube, "summary").rows.find((r) => r.values["item"] === "Réseaux additionnés")?.values["value"];
    expect(summary).toBe("Facebook, Instagram, LinkedIn, TikTok et YouTube (abonnés, publications, vues de vidéo et interactions seulement)");
  });

  it("flags the figures YouTube feeds as partial while a connected YouTube cannot be read", () => {
    const model = exportOf({ youtubeUnavailable: true });
    for (const label of ["Abonnés", "Posts publiés", "Vues de vidéo", "Interactions"]) expect(String(figure(model, label)["remark"] ?? ""), label).toContain("partiel");
    expect(String(figure(model, "Impressions")["remark"] ?? "")).not.toContain("YouTube");
  });
});

describe("the Global export as a file", () => {
  it("is named after the client, Global and the period", () => {
    expect(exportFileName(exportOf(), "xlsx")).toBe("DE-Global-juin-2025.xlsx");
    expect(exportFileName(exportOf(), "json")).toBe("DE-Global-juin-2025.json");
  });

  it("serialises to JSON with the sheets by id", () => {
    const json = JSON.parse(exportToJson(exportOf()));
    expect(json.meta.network).toBe("overview");
    expect(Object.keys(json.sheets)).toEqual(["summary", "keyFigures", "networks"]);
    expect(json.sheets.keyFigures.rows.length).toBe(15);
  });

  it("builds an Excel workbook of three sheets", () => {
    const parts = unzipSync(buildXlsx(exportOf()));
    const workbook = strFromU8(parts["xl/workbook.xml"]!);
    for (const name of ["Résumé", "Chiffres clés", "Par réseau"]) expect(workbook).toContain(`name="${name}"`);
    expect(Object.keys(parts).filter((k) => k.startsWith("xl/worksheets/"))).toHaveLength(3);
  });
});
