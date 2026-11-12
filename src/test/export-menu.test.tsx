import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SocialData } from "../components/dashboard/common";
import { ExportMenu } from "../components/dashboard/export-menu";
import { coverage, days, posts } from "./fixtures/young-account";

vi.mock("@/client/config", async () => (await import("@/test/fixtures/neutral-client")).neutralClientModule({ features: { dataExport: true } }));

const june = { start: "2025-06-01", end: "2025-06-30" };
const may = { start: "2025-05-01", end: "2025-05-31" };
const data = {
  days, posts, ads: [], adCoverage: coverage, statuses: [], promotedPosts: [], paidAds: [], stories: [], storyPulls: [], storiesFailed: false, unusableStatMonths: [],
  audience: [], adLinking: { rule: 0, manual: 0, unlinked: 0 }, statGapsFailed: false,
  adAudience: { rows: [], periods: [], failed: false }, pageAudience: { rows: [], periods: [], failed: false },
} as unknown as SocialData;

// jsdom n'a pas ResizeObserver ni la capture de pointeur que demande le menu déroulant.
beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});

const blobs: Blob[] = [];
const downloads: { name: string; href: string }[] = [];
beforeEach(() => {
  blobs.length = 0;
  downloads.length = 0;
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn((blob: Blob) => { blobs.push(blob); return `blob:test-${blobs.length}`; }), revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push({ name: this.download, href: this.href }); });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-03T10:00:00Z"));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

const readText = (blob: Blob) => new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsText(blob); });
const readBytes = (blob: Blob) => new Promise<Uint8Array>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer)); r.onerror = reject; r.readAsArrayBuffer(blob); });
const open = () => fireEvent.keyDown(screen.getByRole("button", { name: "Exporter" }), { key: "Enter" });

describe("ExportMenu", () => {
  it("is an icon button named « Exporter », disabled while there is no data", () => {
    const { container, rerender } = render(<ExportMenu data={undefined} p="linkedin" period={june} comparison={may} className="max-sm:order-2" />);
    const button = screen.getByRole("button", { name: "Exporter" });
    expect(button.textContent).toBe("");
    expect(button.querySelector("svg")).not.toBeNull();
    expect((button as HTMLButtonElement).disabled).toBe(true);
    // The wrapper is the header's flex child: it carries the phone ordering of the buttons next to it.
    expect((container.firstElementChild as HTMLElement).className).toContain("max-sm:order-2");
    rerender(<ExportMenu data={data} p="linkedin" period={june} comparison={may} />);
    expect((screen.getByRole("button", { name: "Exporter" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("offers Excel and JSON", async () => {
    render(<ExportMenu data={data} p="linkedin" period={june} comparison={may} />);
    open();
    expect(await screen.findByRole("menuitem", { name: "Excel (.xlsx)" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "JSON (.json)" })).toBeTruthy();
  });

  it("downloads the JSON of the displayed network, period and comparison, named after them", async () => {
    render(<ExportMenu data={data} p="linkedin" period={june} comparison={may} />);
    open();
    fireEvent.click(await screen.findByRole("menuitem", { name: "JSON (.json)" }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0]?.name).toBe("DE-LinkedIn-juin-2025.json");
    expect(blobs[0]?.type).toBe("application/json");
    const json = JSON.parse(await readText(blobs[0]!));
    expect(json.meta).toMatchObject({ network: "linkedin", period: { start: "2025-06-01", end: "2025-06-30" }, comparison: { start: "2025-05-01", end: "2025-05-31" } });
    expect(json.sheets.keyFigures.rows.length).toBeGreaterThan(10);
  });

  it("downloads an Excel workbook (a ZIP) named after the network and the period", async () => {
    render(<ExportMenu data={data} p="instagram" period={june} comparison={may} />);
    open();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Excel (.xlsx)" }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0]?.name).toBe("DE-Instagram-juin-2025.xlsx");
    expect(blobs[0]?.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const bytes = await readBytes(blobs[0]!);
    expect(String.fromCharCode(bytes[0]!, bytes[1]!)).toBe("PK");
    expect(bytes.length).toBeGreaterThan(2000);
  });

  it("says so, and stays usable, when the export fails", async () => {
    const broken = { ...(data as unknown as Record<string, unknown>), days: null } as unknown as SocialData;
    render(<ExportMenu data={broken} p="linkedin" period={june} comparison={may} />);
    open();
    fireEvent.click(await screen.findByRole("menuitem", { name: "JSON (.json)" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Export impossible, réessayez.");
    // The message floats under the button: it does not add a line to the header.
    expect(alert.className).toContain("absolute");
    expect(downloads).toHaveLength(0);
    expect((screen.getByRole("button", { name: "Exporter" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("builds only one file when the same entry is chosen twice quickly", async () => {
    render(<ExportMenu data={data} p="linkedin" period={june} comparison={may} />);
    open();
    const item = await screen.findByRole("menuitem", { name: "JSON (.json)" });
    fireEvent.click(item);
    fireEvent.click(item);
    await waitFor(() => expect(downloads.length).toBeGreaterThanOrEqual(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(downloads).toHaveLength(1);
  });
});
