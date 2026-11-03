import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { PageAudienceSection } from "../components/dashboard/page-audience-section";

// Configuration neutre, les visiteurs de la page ne sont pas activés (valeur par défaut) : la section n'existe pas, même avec des données, et ne les lit pas.
vi.mock("@/client/config", async () => (await import("@/test/fixtures/neutral-client")).neutralClientModule());

describe("PageAudienceSection without the feature", () => {
  it("renders nothing, even when readings are provided, and never reads them", () => {
    const period = { start: "2026-07-01", end: "2026-09-30" };
    const reads: string[] = [];
    // Any access to the readings is recorded: the section must return before looking at them.
    const data = new Proxy(
      { failed: false, periods: [], rows: [] },
      { get: (target, key) => { reads.push(String(key)); return target[key as keyof typeof target]; } },
    );
    const { container } = render(<PageAudienceSection data={data} p="linkedin" period={period} comparison={{ start: "2024-07-01", end: "2024-09-30" }} />);
    expect(container.innerHTML).toBe("");
    expect(reads).toEqual([]);
  });
});
