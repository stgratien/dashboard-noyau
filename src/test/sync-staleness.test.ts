import { describe, expect, it } from "vitest";
import { staleSyncLabel } from "@/lib/sync-staleness";

const now = Date.parse("2026-10-18T12:00:00Z");
describe("staleSyncLabel", () => {
  it("no warning under 30 h", () => expect(staleSyncLabel(["2026-10-18T04:18:00Z", "2026-10-17T07:00:00Z"], now)).toBeNull());
  it("warns over 30 h using the oldest source", () => expect(staleSyncLabel(["2026-10-18T04:18:00Z", "2026-10-16T11:34:00Z"], now)).toBe("Données non mises à jour depuis le 16/10"));
});
