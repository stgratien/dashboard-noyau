import { DATA_START } from "./dashboard-periods";
// Les comptes Windsor autorisés (identifiants) vivent dans la configuration serveur du client : src/client/config.server.ts.
export type { WindsorSource } from "@/core/client-config";
export const HISTORY_START = DATA_START;
export const THUMBNAIL_BUCKET = "publication-thumbnails";
