/**
 * Lecture d'un onglet rendu (DOM) pour contrôler les notes « Chiffres partiels » : quelles cartes portent « partiel » (période affichée) ou « (partiel) » (valeur comparée) à l'écran,
 * et ce que disent les notes grises en tête d'onglet. Partagé par le test de rendu (données synthétiques) et par le contrôle sur les données réelles (hors dépôt), pour que les deux
 * appliquent exactement la même règle. Aucune donnée d'aucun client ici.
 */

/** Libellé d'une carte (singulier compris : « Impression totale » quand la valeur est 0 ou 1) → clé de RealTotals. « Vidéos publiées » est le nombre de publications sur TikTok. */
const CARD_KEYS: [RegExp, string][] = [
  [/^abonnés?$/i, "followers"],
  [/^(publications?|posts? publiés?)$/i, "posts"],
  [/^vidéos? publiées?$/i, "videos"],
  [/^annonces? diffusées?$/i, "adsDelivered"],
  [/^impressions?( totales?)?$/i, "impressions"],
  [/^impressions? moy\. \/ post$/i, "impressionsPerPost"],
  [/^vues? de vidéo$/i, "videoViews"],
  [/^interactions?( totales?)?$/i, "interactions"],
  [/^taux d'engagement/i, "engagementRate"],
  [/^clics? sur les liens$/i, "clicks"],
  [/^budget/i, "spend"],
  [/^cpm/i, "cpm"],
  [/^cpc/i, "cpc"],
  [/^cpv/i, "cpv"],
  [/^cpe/i, "cpe"],
];
export function cardKey(label: string, tiktok: boolean): string | null {
  const key = CARD_KEYS.find(([pattern]) => pattern.test(label.trim()))?.[1] ?? null;
  return tiktok && key === "videos" ? "posts" : key;
}

/** Chiffres dont les mentions sont celles des listes de partial-note.ts (les cartes de stories, d'abonnés gagnés... ont leurs propres notes et ne sont pas lues). */
export function readCards(container: HTMLElement, tiktok: boolean) {
  const displayed: string[] = [];
  const compared: string[] = [];
  for (const card of container.querySelectorAll("[data-export-card]")) {
    const lines = [...card.querySelectorAll("p")];
    const key = cardKey(lines[0]?.textContent ?? "", tiktok);
    if (!key) continue;
    // Une note de carte : « partiel » est l'un de ses morceaux (les notes d'une carte se séparent par « · ») ; la valeur comparée : « vs 721K (partiel) ».
    if (lines.some((line) => line.textContent?.split(" · ").includes("partiel")))
      displayed.push(key);
    if (lines.some((line) => /^vs .*\(partiel\)/.test(line.textContent ?? ""))) compared.push(key);
  }
  return { displayed, compared };
}

/** Chiffres que la phrase de comparaison vide (comparisonGapNote) explique : l'organique du compte, et les clics qui s'arrêtent le même jour. */
const GAP_NOTE_CARDS = [
  "impressions",
  "impressionsPerPost",
  "videoViews",
  "interactions",
  "engagementRate",
  "cpe",
  "clicks",
];

/**
 * Écarts entre l'écran et ce que la lib attend : `displayed` et `compared` sont les cartes que partial-note.ts dit partielles (partialKeys, partialComparedKeys).
 * Liste vide = aucun écart. Contrôle les cartes (période affichée et valeurs comparées), la présence de chaque phrase, et qu'elles sont hors des exports.
 */
export function viewDiscrepancies(
  container: HTMLElement,
  { tiktok, displayed, compared }: { tiktok: boolean; displayed: string[]; compared: string[] },
): string[] {
  const bad: string[] = [];
  const screen = readCards(container, tiktok);
  const same = (a: string[], b: string[]) =>
    [...new Set(a)].sort().join() === [...new Set(b)].sort().join();
  if (!same(screen.displayed, displayed))
    bad.push(`cartes « partiel » à l'écran [${screen.displayed}] ≠ attendues [${displayed}]`);
  if (!same(screen.compared, compared))
    bad.push(
      `valeurs comparées « (partiel) » à l'écran [${screen.compared}] ≠ attendues [${compared}]`,
    );
  const notes = [...container.querySelectorAll('[role="note"]')];
  const texts = notes.map((n) => n.textContent ?? "");
  const partial = texts.find((t) => t.startsWith("Chiffres partiels"));
  const comparedLine = texts.find((t) => t.startsWith("Période comparée"));
  const gap = texts.find((t) => t.includes("leur comparaison reste donc vide"));
  if (displayed.length > 0 && !partial)
    bad.push(`cartes partielles [${displayed}] sans note « Chiffres partiels »`);
  if (displayed.length === 0 && partial)
    bad.push(`note « Chiffres partiels » sans carte partielle : ${partial}`);
  if (compared.length > 0 && !comparedLine && !gap)
    bad.push(`valeurs comparées partielles [${compared}] sans phrase`);
  if (compared.length > 0 && !comparedLine && gap) {
    const unexplained = compared.filter((key) => !GAP_NOTE_CARDS.includes(key));
    if (unexplained.length)
      bad.push(
        `valeurs comparées [${unexplained}] que la phrase de comparaison vide n'explique pas`,
      );
  }
  if (compared.length === 0 && comparedLine)
    bad.push(`phrase de période comparée sans valeur partielle : ${comparedLine}`);
  for (const [i, note] of notes.entries()) {
    if (!note.closest("[data-export-hide]")) bad.push(`note hors data-export-hide : ${texts[i]}`);
    if (note.closest("[data-export-block]")) bad.push(`note dans un bloc exporté : ${texts[i]}`);
    // La phrase de repli (identifiant que rien ne classe) ne doit jamais s'écrire sur des données réelles.
    if (/des chiffres sont incomplets/.test(texts[i] ?? ""))
      bad.push(`phrase de repli : ${texts[i]}`);
  }
  return bad;
}
