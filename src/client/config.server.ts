// PROPRIÉTÉ DU CLIENT : partie serveur de la configuration. Importé uniquement par du code serveur (jamais dans le navigateur).
import { defineClientServer } from "@/core/client-config";
import client from "@/client/config";

export default defineClientServer(client, {
  windsor: {
    accounts: {
      // Un identifiant de compte Windsor par source activée dans config.ts.
      instagram: "REMPLACER-PAR-L-IDENTIFIANT-DU-COMPTE-WINDSOR",
    },
  },
});
