import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import type { DataExport } from "../lib/data-export";
import { XLSX_MIME, buildXlsx, columnLetters, excelSerial, sheetNames } from "../lib/data-export-xlsx";

const model: DataExport = {
  meta: {
    dashboard: "Demo", network: "linkedin", networkName: "LinkedIn", period: { start: "2025-06-01", end: "2025-06-30", name: "juin 2025" },
    comparison: { start: "2025-05-01", end: "2025-05-31", name: "mai 2025" }, generatedAt: "2026-11-03T10:30:00.000Z",
  },
  tables: [
    {
      id: "one", name: "Chiffres clés",
      columns: [
        { key: "label", label: "Indicateur", kind: "text", width: 30 }, { key: "value", label: "Période", kind: "decimal", width: 14 },
        { key: "date", label: "Date", kind: "datetime", width: 20 }, { key: "day", label: "Jour", kind: "date", width: 12 }, { key: "note", label: "Remarque", kind: "text", width: 60 },
      ],
      rows: [
        { values: { label: "Budget dépensé", value: 1234.5, date: "2025-06-15T00:30:00", day: "2025-06-15", note: null }, kinds: { value: "euro" } },
        { values: { label: "=1+1 & <b>\"x\"</b>", value: null, date: null, day: null, note: "ligne\navec\u0000contrôle\u0007 et accents éèà" }, kinds: { value: "integer" } },
        { values: { label: "Taux", value: 22.34, date: "pas une date", day: "2025-02-30", note: "" }, kinds: { value: "percent" } },
      ],
    },
    { id: "two", name: "Feuille [vide]: test?", columns: [{ key: "a", label: "A", kind: "text", width: 10 }], rows: [] },
    { id: "three", name: "Liste", plain: true, columns: [{ key: "a", label: "A", kind: "text", width: 10 }], rows: [{ values: { a: "x" } }] },
  ],
};

const parse = (xml: string) => new DOMParser().parseFromString(xml, "application/xml");
const files = () => unzipSync(buildXlsx(model));

describe("helpers", () => {
  it("names the columns like a spreadsheet", () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnLetters)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
  });

  it("converts dates and local times to Excel serial numbers", () => {
    expect(excelSerial("1900-03-01")).toBe(61);
    expect(excelSerial("2025-06-15")).toBe(45823);
    expect(excelSerial("2025-06-15T12:00:00")).toBeCloseTo(45823.5, 10);
    expect(excelSerial("2025-06-15T00:30:00")).toBeCloseTo(45823 + 1800 / 86400, 10);
    expect(excelSerial("pas une date")).toBeNull();
  });

  it("makes valid, unique sheet names of 31 characters at most", () => {
    expect(sheetNames(["Résumé", "Feuille [vide]: test?", "résumé", "x".repeat(40), "x".repeat(40)])).toEqual(["Résumé", "Feuille vide test", "résumé 2", "x".repeat(31), `${"x".repeat(29)} 2`]);
  });
});

describe("buildXlsx", () => {
  it("is a ZIP of the parts Excel expects, the content types first", () => {
    const zip = buildXlsx(model);
    expect(String.fromCharCode(zip[0]!, zip[1]!)).toBe("PK");
    const parts = unzipSync(zip);
    expect(Object.keys(parts)).toEqual([
      "[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml", "xl/worksheets/sheet3.xml",
    ]);
    expect(XLSX_MIME).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  });

  it("writes only well-formed XML, whatever the texts contain", () => {
    for (const [name, bytes] of Object.entries(files())) {
      const doc = parse(strFromU8(bytes));
      expect(doc.getElementsByTagName("parsererror").length, name).toBe(0);
    }
  });

  it("lists the sheets with valid names and links each to its part", () => {
    const parts = files();
    const workbook = parse(strFromU8(parts["xl/workbook.xml"]!));
    const sheets = [...workbook.getElementsByTagName("sheet")].map((s) => [s.getAttribute("name"), s.getAttribute("sheetId"), s.getAttribute("r:id")]);
    expect(sheets).toEqual([["Chiffres clés", "1", "rId1"], ["Feuille vide test", "2", "rId2"], ["Liste", "3", "rId3"]]);
    const rels = [...parse(strFromU8(parts["xl/_rels/workbook.xml.rels"]!)).getElementsByTagName("Relationship")].map((r) => [r.getAttribute("Id"), r.getAttribute("Target")]);
    expect(rels).toEqual([["rId1", "worksheets/sheet1.xml"], ["rId2", "worksheets/sheet2.xml"], ["rId3", "worksheets/sheet3.xml"], ["rId4", "styles.xml"]]);
    const types = strFromU8(parts["[Content_Types].xml"]!);
    expect(types).toContain('/xl/worksheets/sheet2.xml');
  });

  it("writes the header, numbers as numbers, dates as serial numbers, and skips empty cells", () => {
    const sheet = parse(strFromU8(files()["xl/worksheets/sheet1.xml"]!));
    const cells = new Map([...sheet.getElementsByTagName("c")].map((c) => [c.getAttribute("r")!, c]));
    expect(["A1", "B1", "C1", "D1", "E1"].map((r) => cells.get(r)?.textContent)).toEqual(["Indicateur", "Période", "Date", "Jour", "Remarque"]);
    expect(cells.get("B2")?.getElementsByTagName("v")[0]?.textContent).toBe("1234.5");
    expect(cells.get("B2")?.getAttribute("t")).toBeNull();
    expect(cells.get("C2")?.getElementsByTagName("v")[0]?.textContent).toBe(String(excelSerial("2025-06-15T00:30:00")));
    expect(cells.get("D2")?.getElementsByTagName("v")[0]?.textContent).toBe("45823");
    // Empty values (null, "") write no cell at all.
    expect(cells.has("E2")).toBe(false);
    expect(cells.has("B3")).toBe(false);
    expect(cells.has("C3")).toBe(false);
    expect(cells.has("E4")).toBe(false);
  });

  it("keeps a text as a text, even when it looks like a formula, and cleans what XML cannot hold", () => {
    const sheet = parse(strFromU8(files()["xl/worksheets/sheet1.xml"]!));
    const cells = new Map([...sheet.getElementsByTagName("c")].map((c) => [c.getAttribute("r")!, c]));
    const a3 = cells.get("A3")!;
    expect(a3.getAttribute("t")).toBe("inlineStr");
    expect(a3.textContent).toBe('=1+1 & <b>"x"</b>');
    expect(a3.getElementsByTagName("f").length).toBe(0);
    expect(cells.get("E3")?.textContent).toBe("ligne\naveccontrôle et accents éèà");
  });

  it("keeps a value that is not a date as text instead of losing it", () => {
    const sheet = parse(strFromU8(files()["xl/worksheets/sheet1.xml"]!));
    const cells = new Map([...sheet.getElementsByTagName("c")].map((c) => [c.getAttribute("r")!, c]));
    expect(cells.get("C4")?.textContent).toBe("pas une date");
    // 30 February does not exist: Excel's serial still computes (a date after the 28th), nothing throws.
    expect(cells.get("D4")).toBeTruthy();
  });

  it("freezes and filters the header of a sheet with rows, and only freezes an empty one", () => {
    const parts = files();
    const one = strFromU8(parts["xl/worksheets/sheet1.xml"]!), two = strFromU8(parts["xl/worksheets/sheet2.xml"]!);
    expect(one).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(one).toContain('<autoFilter ref="A1:E4"/>');
    expect(one).toContain('<dimension ref="A1:E4"/>');
    expect(one).toContain('tabSelected="1"');
    expect(two).not.toContain("autoFilter");
    expect(two).not.toContain("tabSelected");
    // A plain list (the summary) has neither a frozen pane nor a filter.
    const three = strFromU8(parts["xl/worksheets/sheet3.xml"]!);
    expect(three).not.toContain("pane");
    expect(three).not.toContain("autoFilter");
    // The column widths are written.
    expect(one).toContain('<col min="1" max="1" width="30" customWidth="1"/>');
  });

  it("styles the cells by kind: header, euro, integer, percent, date and date-time", () => {
    const sheet = parse(strFromU8(files()["xl/worksheets/sheet1.xml"]!));
    const style = (ref: string) => [...sheet.getElementsByTagName("c")].find((c) => c.getAttribute("r") === ref)?.getAttribute("s");
    // header = 1, euro = 5 (row kind overrides the column kind), date-time = 7, date = 6, long text column = wrapped (8).
    expect(style("A1")).toBe("1");
    expect(style("B2")).toBe("5");
    expect(style("C2")).toBe("7");
    expect(style("D2")).toBe("6");
    expect(style("B4")).toBe("4");
    expect(style("E3")).toBe("8");
    expect(style("A2")).toBe("0");
  });
});
