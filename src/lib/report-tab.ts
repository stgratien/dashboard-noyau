/**
 * Onglets d'où le reporting se lance (le cœur du pied de page) : Global quand le client en a un ; sans Global (client à une seule plateforme),
 * chaque onglet réseau, le rapport couvrant de toute façon tous les réseaux du client.
 */
export function reportTabAvailable(tab: string, hasGlobal: boolean, networkTabs: readonly string[]) {
  return hasGlobal ? tab === "overview" : networkTabs.includes(tab);
}
