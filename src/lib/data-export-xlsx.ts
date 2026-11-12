import { strToU8, zipSync } from "fflate";
import type { CellKind, DataExport, ExportColumn, ExportTable, ExportValue } from "@/lib/data-export";

/**
 * Classeur Excel (.xlsx) d'un export : un fichier ZIP de quelques parties XML (SpreadsheetML), écrit ici sans bibliothèque de tableur (seul `fflate` compresse). Une feuille par table,
 * ligne d'en-tête figée et filtrable, nombres et dates en vraies cellules numériques (Excel les calcule et les trie), textes en chaînes en ligne : un texte n'est jamais lu comme
 * une formule, même s'il commence par « = ». Fonction pure : aucun accès au navigateur.
 */

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
/** Limite d'une cellule d'Excel. */
const MAX_TEXT = 32000;

/** Caractères interdits en XML 1.0 (contrôles, demi-paires) : retirés, ils rendraient le fichier illisible pour Excel. */
const INVALID_XML = /[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu;
const escapeXml = (s: string) => s.replace(INVALID_XML, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Index des styles de cellule de `styles.xml`. */
const STYLE = { text: 0, header: 1, integer: 2, decimal: 3, percent: 4, euro: 5, date: 6, datetime: 7, wrap: 8 } as const;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS}">
<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;"/><numFmt numFmtId="165" formatCode="0.0"/><numFmt numFmtId="166" formatCode="dd/mm/yyyy\\ hh:mm"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF4"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF94A3B8"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** Lettres de colonne : 0 → A, 25 → Z, 26 → AA. */
export function columnLetters(index: number): string {
  let n = index + 1, out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
/** Numéro de série Excel d'une date « AAAA-MM-JJ » ou d'une heure locale « AAAA-MM-JJTHH:MM:SS » (sans fuseau : Excel n'en a pas). */
export function excelSerial(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(iso);
  if (!m) return null;
  const day = (Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - EXCEL_EPOCH) / 86_400_000;
  const seconds = Number(m[4] ?? 0) * 3600 + Number(m[5] ?? 0) * 60 + Number(m[6] ?? 0);
  return day + seconds / 86_400;
}

/** Nom de feuille valide pour Excel : 31 caractères au plus, sans « [ ] : * ? / \ », unique sans tenir compte des majuscules. */
export function sheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw) => {
    const base = (raw.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim() || "Feuille").slice(0, 31);
    let name = base, i = 2;
    while (used.has(name.toLowerCase())) name = `${base.slice(0, 31 - String(i).length - 1)} ${i++}`;
    used.add(name.toLowerCase());
    return name;
  });
}

const styleFor = (kind: CellKind, column: ExportColumn): number =>
  kind === "text" ? (column.width >= 40 ? STYLE.wrap : STYLE.text)
  : kind === "integer" ? STYLE.integer : kind === "decimal" ? STYLE.decimal : kind === "percent" ? STYLE.percent
  : kind === "euro" ? STYLE.euro : kind === "date" ? STYLE.date : STYLE.datetime;

function cellXml(ref: string, value: ExportValue, kind: CellKind, column: ExportColumn): string {
  if (value == null || value === "") return "";
  const style = styleFor(kind, column);
  if (kind === "date" || kind === "datetime") {
    const serial = typeof value === "string" ? excelSerial(value) : null;
    return serial == null ? `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value).slice(0, MAX_TEXT))}</t></is></c>` : `<c r="${ref}" s="${style}"><v>${serial}</v></c>`;
  }
  if (typeof value === "number") return Number.isFinite(value) ? `<c r="${ref}" s="${style}"><v>${value}</v></c>` : "";
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value.slice(0, MAX_TEXT))}</t></is></c>`;
}

function sheetXml(table: ExportTable, first: boolean): string {
  const lastCol = columnLetters(Math.max(0, table.columns.length - 1));
  const lastRow = table.rows.length + 1;
  const header = table.columns.map((c, i) => `<c r="${columnLetters(i)}1" s="${STYLE.header}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(c.label)}</t></is></c>`).join("");
  const body = table.rows.map((row, r) => {
    const cells = table.columns.map((c, i) => cellXml(`${columnLetters(i)}${r + 2}`, row.values[c.key] ?? null, row.kinds?.[c.key] ?? c.kind, c)).join("");
    return `<row r="${r + 2}">${cells}</row>`;
  }).join("");
  const cols = table.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${NS}" xmlns:r="${REL_NS}"><dimension ref="A1:${lastCol}${lastRow}"/><sheetViews><sheetView${first ? ' tabSelected="1"' : ""} workbookViewId="0">${table.plain ? "" : '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>'}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData><row r="1" ht="30" customHeight="1">${header}</row>${body}</sheetData>${table.rows.length > 0 && !table.plain ? `<autoFilter ref="A1:${lastCol}${lastRow}"/>` : ""}</worksheet>`;
}

/** Le classeur : un octet-tableau prêt à être téléchargé (type MIME `XLSX_MIME`). */
export function buildXlsx(model: DataExport): Uint8Array {
  const names = sheetNames(model.tables.map((t) => t.name));
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${model.tables.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${NS}" xmlns:r="${REL_NS}"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="16000"/></bookViews><sheets>${names.map((n, i) => `<sheet name="${escapeXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PACKAGE_REL}">${model.tables.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${model.tables.length + 1}" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(STYLES_XML),
  };
  model.tables.forEach((table, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(table, i === 0)); });
  return zipSync(files, { level: 6 });
}
