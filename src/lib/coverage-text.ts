import { plural } from "./dashboard-format";

/** Chiffres dont l'absence du nombre de j'aime se lit « sans nombre de j'aime » (et non « de vues »). */
const LIKE_KEYS = ["likes", "interactions", "engagementRate", "cpe"];

/**
 * Lecture d'un identifiant de couverture partielle (RealTotals.missing) : « 3 vidéos Instagram sans nombre de vues », « organique LinkedIn non disponible… ».
 * Partagée par le tableau de bord (coverageDetails) et par le rapport (notes) pour que les deux disent la même chose.
 */
export function coverageDescription(id: string, key: string, networkName: (platform: string) => string, capital = false): string {
  const [platform = "", source, count] = id.split(":");
  const name = networkName(platform);
  if (source === "videos") {
    const n = Number(count);
    return `${n} ${plural(n, "vidéo")} ${name} sans nombre de ${LIKE_KEYS.includes(key) ? "j’aime" : "vues"}`;
  }
  // Jours de la période hors de l'historique importé : lus du connecteur, autre définition (l'identifiant porte le dernier jour de l'historique).
  if (source === "export") {
    const last = /^\d{4}-\d{2}-\d{2}$/.test(count ?? "") ? ` (il s’arrête le ${count!.slice(8, 10)}/${count!.slice(5, 7)}/${count!.slice(0, 4)})` : "";
    return `${name} : réactions lues du connecteur sur des jours que l’historique importé ne couvre pas${last}, autre définition`;
  }
  if (source) return `${source === "organic" ? "organique" : "payant"} ${name} non disponible sur cette période`;
  return `${capital ? "Réseau" : "réseau"} manquant : ${name}`;
}
