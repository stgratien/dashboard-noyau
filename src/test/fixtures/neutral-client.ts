import type { ClientInput } from "../../core/client-config";

/**
 * Configuration cliente NEUTRE pour les tests génériques du noyau qui dépendent de la configuration (éditions, début de l'historique,
 * signature, mots à ignorer dans les annonces...). Aucun test générique ne doit lire la vraie configuration du client du dépôt : elle change
 * d'un client à l'autre. Les trois éditions tombent un lundi (comme un événement annuel), séparées de plusieurs années, la dernière dans le futur
 * des dates utilisées par les tests.
 *
 * Usage dans un test (la fabrique est asynchrone parce que vi.mock est remonté avant les imports) :
 *   vi.mock("@/client/config", async () => (await import("@/test/fixtures/neutral-client")).neutralClientModule());
 * Pour changer une clé : neutralClientModule({ features: { global: false } }).
 */
export const neutralClient: ClientInput = {
  id: "demo-event",
  brand: {
    name: "Demo Event",
    shortName: "DE",
    pageTitle: "Demo Event dashboard",
    pageDescription: "Neutral test configuration.",
    logo: { url: "/favicon.svg" },
    footerCredit: "Demo Studio",
  },
  data: { start: "2023-06-05" },
  events: {
    groupLabel: "Demo editions",
    editions: [
      { name: "Edition 2023", start: "2023-09-11", end: "2023-09-17" },
      { name: "Edition 2025", start: "2025-09-15", end: "2025-09-21" },
      { name: "Edition 2027", start: "2027-09-13", end: "2027-09-19" },
    ],
  },
  sources: ["facebook", "facebook_organic", "instagram", "tiktok", "tiktok_organic", "linkedin", "linkedin_organic"],
  ads: { extraStopWords: ["metropole", "forum"] },
  report: { google: null, templateName: "Demo template", manualSources: ["X", "Listening tool", "moderation"] },
};

/** Module `@/client/config` factice : `default` est la configuration validée par defineClient, comme le vrai fichier du client. */
export async function neutralClientModule(overrides: Partial<ClientInput> = {}) {
  const { defineClient } = await import("@/core/client-config");
  return { default: defineClient({ ...neutralClient, ...overrides }) };
}
