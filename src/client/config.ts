// PROPRIÉTÉ DU CLIENT : partie publique de la configuration (embarquée dans le navigateur). Aucun secret, aucun identifiant de compte.
// À REMPLIR pour ce client : voir docs/noyau.md.
import { defineClient } from "@/core/client-config";

export default defineClient({
  id: "mon-client", // identifiant stable : ne jamais le changer
  brand: {
    name: "Mon événement",
    shortName: "ME",
    pageTitle: "Dashboard Mon événement — Social media & web",
    pageDescription: "Suivez les performances social media et web : audience, visibilité, interactions et budget par plateforme.",
    logo: { url: "/favicon.svg" }, // remplacer par le logo du client (fichier de src/assets ou de public)
    footerCredit: null, // « Fait avec ♥️ par <signature> » ; null = pas de signature
  },
  data: { start: "2024-01-01" }, // début de l'historique à importer
  events: { groupLabel: "Éditions", editions: [] }, // éditions ou temps forts : { name, start, end }
  // Sources Windsor activées : les onglets réseaux s'en déduisent (facebook, facebook_organic, instagram, tiktok, tiktok_organic, linkedin, linkedin_organic).
  sources: ["instagram"],
  features: { googleAds: false, youtube: false },
  // report: { google: { clientId, apiKey, appId, templateId }, templateName: "…", manualSources: ["X"] }, // bouton « Générer un reporting »
});
