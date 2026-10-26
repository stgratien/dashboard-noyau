import type { ClientInput } from "../../core/client-config";

/**
 * Configuration client minimale de la première version du noyau. Elle ne doit JAMAIS changer : elle prouve qu'une configuration écrite
 * avec les seules clés obligatoires d'alors compile et fonctionne encore (toute clé ajoutée depuis est facultative, avec un défaut).
 */
export const clientV1: ClientInput = {
  id: "client-test",
  brand: { name: "Client test", pageTitle: "Dashboard Client test", pageDescription: "Description de test.", logo: { url: "/favicon.svg" } },
  data: { start: "2024-01-01" },
  sources: ["instagram"],
};
