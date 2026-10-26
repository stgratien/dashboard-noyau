/**
 * Noyau : forme de la configuration d'un client et valeurs par défaut.
 * Ce fichier appartient au noyau et ne contient rien de propre à un client ; il n'est jamais modifié dans un dépôt client.
 * Règle d'or : une nouvelle clé est toujours OPTIONNELLE, avec sa valeur par défaut définie ici, pour qu'un client existant
 * continue de fonctionner sans changement après une fusion du noyau.
 */
export type IsoDate = string; // AAAA-MM-JJ
export type WindsorSource =
  | "facebook"
  | "facebook_organic"
  | "instagram"
  | "tiktok"
  | "tiktok_organic"
  | "linkedin"
  | "linkedin_organic";
export type EventEdition = { name: string; start: IsoDate; end: IsoDate };

/** Réseaux affichables (vocabulaire fermé du noyau), dans l'ordre des onglets. */
export type PlatformId = "facebook" | "instagram" | "linkedin" | "tiktok";
export const ALL_PLATFORMS: readonly PlatformId[] = ["facebook", "instagram", "linkedin", "tiktok"];
/**
 * Réseaux alimentés par chaque source. La source « facebook » est Meta Ads : ses lignes sont rangées par placement, Facebook ou Instagram.
 * Une source activée impose donc l'onglet de chacun de ses réseaux.
 */
export const SOURCE_PLATFORMS: Record<WindsorSource, PlatformId[]> = {
  facebook: ["facebook", "instagram"],
  facebook_organic: ["facebook"],
  instagram: ["instagram"],
  tiktok: ["tiktok"],
  tiktok_organic: ["tiktok"],
  linkedin: ["linkedin"],
  linkedin_organic: ["linkedin"],
};
/** Sources de chaque réseau : [organique, payant]. Un réseau a son onglet dès que l'une d'elles est activée. */
export const PLATFORM_SOURCES: Record<PlatformId, [WindsorSource, WindsorSource]> = {
  facebook: ["facebook_organic", "facebook"],
  instagram: ["instagram", "facebook"],
  linkedin: ["linkedin_organic", "linkedin"],
  tiktok: ["tiktok_organic", "tiktok"],
};

/** Partie publique : embarquée dans le navigateur et lue par le serveur. Jamais de secret ni d'identifiant de compte. */
export interface ClientInput {
  /** Identifiant stable [a-z0-9-] du client (« mon-client ») : ne jamais le changer. */
  id: string;
  /** Identité affichée : titres, logo, signature, noms de fichiers exportés. */
  brand: {
    /** Nom court de l'événement ou de la marque (« Mon événement ») : exports et titres. */
    name: string;
    /** Sigle (« ME ») pour les libellés d'accessibilité ; défaut : name. */
    shortName?: string;
    pageTitle: string;
    pageDescription: string;
    /** Titre affiché en tête de page (défaut « Dashboard de performances social media et web »). */
    headline?: string;
    logo: { url: string };
    /** Signature du pied de page (« Fait avec ♥️ par Mon agence ») ; absente ou null = pas de signature. */
    footerCredit?: string | null;
    /** Début des noms de fichiers exportés (défaut « Dashboard-<name> »). */
    exportFileBase?: string;
    /** Titre imprimé en tête des exports (défaut « Dashboard <name> »). */
    exportTitle?: string;
  };
  /** Début de l'historique importé (AAAA-MM-JJ). */
  data: { start: IsoDate };
  /** Éditions ou temps forts du client (Édition 2023, 2025...) : raccourcis de période, comparaisons, rattrapage d'import. Défaut : aucune. */
  events?: { editions?: EventEdition[]; groupLabel?: string };
  /** Sources Windsor activées pour ce client (les identifiants de comptes sont dans la partie serveur). */
  sources: WindsorSource[];
  /** Onglets réseaux affichés. Défaut : les réseaux alimentés par les sources activées (voir PLATFORM_SOURCES). */
  networks?: PlatformId[];
  /**
   * Intégrations hors Windsor (scripts nocturnes) et onglet Global. Défaut : Google Ads et YouTube activés ; `global` (vue « tous réseaux ») affiché
   * dès qu'il y a plusieurs onglets réseaux, masqué sinon (le premier onglet réseau s'ouvre alors en premier).
   */
  features?: { googleAds?: boolean; youtube?: boolean; global?: boolean };
  /** Rapprochement annonce-publication par le nom de l'annonce : mots propres au client à ignorer en plus de la liste de base (« paris », nom de l'événement...). */
  ads?: { extraStopWords?: string[] };
  /** Rapport Google Slides. Sans `google`, le bouton « Générer un reporting » reste inactif. */
  report?: {
    google?: { clientId: string; apiKey: string; appId: string; templateId: string } | null;
    /** Nom du modèle dans les messages (« MODELE - Bilan Mon client »). */
    templateName?: string;
    /** Début du nom des copies (défaut « Bilan Social Media »). */
    fileNamePrefix?: string;
    /** Clé de stockage du navigateur pour le modèle choisi (défaut « <id>-report-template-id »). */
    templateStorageKey?: string;
    /** Sources que le tableau de bord n'a pas et que l'équipe complète à la main dans le modèle (« X », « un outil de veille »...). */
    manualSources?: string[];
  };
  /** Textes de définition propres à l'historique du client (documentation) ; sinon le texte générique du noyau. */
  kpiNotes?: { stories?: string; instagramInteractions?: string };
}

/** Partie serveur : importée uniquement par du code serveur (*.server.ts). */
export interface ClientServerInput {
  /** Un identifiant de compte Windsor par source activée. */
  windsor: { accounts: Partial<Record<WindsorSource, string>> };
  /** Adresse prévue pour les alertes de synchronisation (aucun envoi n'existe encore). Facultative. */
  alertEmail?: string;
}

export interface Client {
  id: string;
  brand: {
    name: string;
    shortName: string;
    pageTitle: string;
    pageDescription: string;
    headline: string;
    logo: { url: string };
    footerCredit: string | null;
    exportFileBase: string;
    exportTitle: string;
  };
  data: { start: IsoDate };
  events: { editions: EventEdition[]; groupLabel: string };
  sources: WindsorSource[];
  networks: PlatformId[];
  features: { googleAds: boolean; youtube: boolean; global: boolean };
  ads: { extraStopWords: string[] };
  report: {
    google: { clientId: string; apiKey: string; appId: string; templateId: string } | null;
    templateName: string;
    fileNamePrefix: string;
    templateStorageKey: string;
    manualSources: string[];
  };
  kpiNotes: { stories?: string; instagramInteractions?: string };
}
export type ClientServer = ClientServerInput;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Valide la configuration (échec clair au démarrage) et complète les valeurs par défaut. */
export function defineClient(input: ClientInput): Client {
  if (!/^[a-z0-9-]+$/.test(input.id)) throw new Error(`Configuration client : id invalide « ${input.id} » (a-z, 0-9 et tirets).`);
  if (!ISO.test(input.data.start)) throw new Error("Configuration client : data.start doit être une date AAAA-MM-JJ.");
  const editions = input.events?.editions ?? [];
  for (const edition of editions) {
    if (!ISO.test(edition.start) || !ISO.test(edition.end) || edition.start > edition.end)
      throw new Error(`Configuration client : dates invalides pour l'édition « ${edition.name} ».`);
  }
  const names = editions.map((e) => e.name);
  if (new Set(names).size !== names.length) throw new Error("Configuration client : deux éditions portent le même nom.");
  const clash = names.find((n) => /^\d{4}$/.test(n) || /^T[1-4] \d{4}/.test(n) || /^(Mois|Année)/.test(n));
  if (clash) throw new Error(`Configuration client : le nom d'édition « ${clash} » se confond avec un raccourci de période (année, trimestre, mois).`);
  if (input.sources.length === 0) throw new Error("Configuration client : au moins une source Windsor doit être activée.");
  if (new Set(input.sources).size !== input.sources.length) throw new Error("Configuration client : une source Windsor est listée deux fois.");
  const networks = input.networks ?? ALL_PLATFORMS.filter((p) => PLATFORM_SOURCES[p].some((source) => input.sources.includes(source)));
  if (networks.length === 0) throw new Error("Configuration client : au moins un réseau doit être affiché.");
  for (const network of networks) {
    if (!PLATFORM_SOURCES[network].some((source) => input.sources.includes(source)))
      throw new Error(`Configuration client : le réseau « ${network} » est affiché sans aucune de ses sources (${PLATFORM_SOURCES[network].join(", ")}).`);
  }
  for (const source of input.sources) {
    const hidden = SOURCE_PLATFORMS[source].filter((p) => !networks.includes(p));
    if (hidden.length)
      throw new Error(`Configuration client : la source « ${source} » alimente aussi ${hidden.join(", ")} : affichez cet onglet (networks) ou retirez la source.`);
  }
  const b = input.brand, r = input.report ?? {};
  return {
    id: input.id,
    brand: {
      name: b.name,
      shortName: b.shortName ?? b.name,
      pageTitle: b.pageTitle,
      pageDescription: b.pageDescription,
      headline: b.headline ?? "Dashboard de performances social media et web",
      logo: b.logo,
      footerCredit: b.footerCredit ?? null,
      exportFileBase: b.exportFileBase ?? `Dashboard-${b.name.trim().replace(/\s+/g, "-")}`,
      exportTitle: b.exportTitle ?? `Dashboard ${b.name}`,
    },
    data: input.data,
    events: { editions, groupLabel: input.events?.groupLabel ?? "Éditions" },
    sources: input.sources,
    networks: ALL_PLATFORMS.filter((p) => networks.includes(p)),
    features: { googleAds: input.features?.googleAds ?? true, youtube: input.features?.youtube ?? true, global: input.features?.global ?? networks.length > 1 },
    ads: { extraStopWords: input.ads?.extraStopWords ?? [] },
    report: {
      google: r.google ?? null,
      templateName: r.templateName ?? "le modèle du rapport",
      fileNamePrefix: r.fileNamePrefix ?? "Bilan Social Media",
      templateStorageKey: r.templateStorageKey ?? `${input.id}-report-template-id`,
      manualSources: r.manualSources ?? [],
    },
    kpiNotes: input.kpiNotes ?? {},
  };
}

/** Vérifie que chaque source activée a un compte Windsor. */
export function defineClientServer(client: Client, input: ClientServerInput): ClientServer {
  const missing = client.sources.filter((source) => !input.windsor.accounts[source]);
  if (missing.length) throw new Error(`Configuration client : compte Windsor manquant pour ${missing.join(", ")}.`);
  const placeholder = client.sources.filter((source) => /^REMPLACER/i.test(input.windsor.accounts[source] ?? ""));
  if (placeholder.length) throw new Error(`Configuration client : remplacez le compte Windsor de ${placeholder.join(", ")} dans src/client/config.server.ts.`);
  return input;
}
