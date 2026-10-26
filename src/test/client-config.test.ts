import { describe, expect, it } from "vitest";
import { defineClient, defineClientServer } from "../core/client-config";
import client from "../client/config";
import { clientV1 } from "./fixtures/client-v1";

describe("client configuration", () => {
  it("the configuration of this repository is valid and shows at least one network", () => {
    expect(client.networks.length).toBeGreaterThan(0);
    expect(client.sources.length).toBeGreaterThan(0);
  });

  it("still accepts the frozen minimal v1 configuration, new keys being optional with documented defaults", () => {
    const c = defineClient(clientV1);
    expect(c.networks).toEqual(["instagram"]);
    expect(c.features).toEqual({ googleAds: true, youtube: true, global: false });
    expect(c.events).toEqual({ editions: [], groupLabel: "Éditions" });
    expect(c.report.google).toBeNull();
    expect(c.brand.footerCredit).toBeNull();
  });

  it("derives the network tabs from the enabled sources, Meta Ads feeding Facebook and Instagram", () => {
    expect(defineClient({ ...clientV1, sources: ["linkedin_organic", "tiktok"] }).networks).toEqual(["linkedin", "tiktok"]);
    expect(defineClient({ ...clientV1, sources: ["facebook"] }).networks).toEqual(["facebook", "instagram"]);
  });

  it("shows the Global tab only with several network tabs, unless features.global says otherwise", () => {
    expect(defineClient(clientV1).features.global).toBe(false);
    expect(defineClient({ ...clientV1, sources: ["linkedin_organic", "tiktok"] }).features.global).toBe(true);
    expect(defineClient({ ...clientV1, sources: ["facebook"] }).features.global).toBe(true);
    expect(defineClient({ ...clientV1, sources: ["linkedin_organic", "tiktok"], features: { global: false } }).features.global).toBe(false);
    expect(defineClient({ ...clientV1, features: { global: true } }).features.global).toBe(true);
  });

  it("rejects incoherent configurations with a clear message", () => {
    expect(() => defineClient({ ...clientV1, sources: ["facebook"], networks: ["facebook"] })).toThrow(/instagram/);
    expect(() => defineClient({ ...clientV1, sources: ["instagram"], networks: ["tiktok"] })).toThrow(/tiktok/);
    expect(() => defineClient({ ...clientV1, sources: ["instagram", "instagram"] })).toThrow(/deux fois/);
    expect(() => defineClient({ ...clientV1, sources: [] })).toThrow(/source/);
    expect(() => defineClient({ ...clientV1, events: { editions: [{ name: "2025", start: "2025-06-01", end: "2025-06-07" }] } })).toThrow(/raccourci/);
    expect(() => defineClient({ ...clientV1, events: { editions: [{ name: "A", start: "2025-06-07", end: "2025-06-01" }] } })).toThrow(/dates invalides/);
  });

  it("the server configuration needs a real Windsor account per enabled source", () => {
    const c = defineClient(clientV1);
    expect(() => defineClientServer(c, { windsor: { accounts: {} } })).toThrow(/manquant/);
    expect(() => defineClientServer(c, { windsor: { accounts: { instagram: "REMPLACER-PAR-L-IDENTIFIANT" } } })).toThrow(/remplacez/);
    expect(defineClientServer(c, { windsor: { accounts: { instagram: "123" } } }).windsor.accounts.instagram).toBe("123");
  });
});
