import config from "@/client/config.server";
import { client } from "@/lib/client";
import type { WindsorSource } from "@/core/client-config";

/** Compte Windsor d'une source activée. Une source sans compte est une erreur claire, jamais « tous les comptes du connecteur ». */
export function sourceAccount(source: WindsorSource): string {
  const account = config.windsor.accounts[source];
  if (!account) throw new Error(`Source Windsor non configurée : ${source}`);
  return account;
}

/** Sources activées pour ce client, dans l'ordre de la configuration. */
export const activeSources = (): WindsorSource[] => [...client.sources];
