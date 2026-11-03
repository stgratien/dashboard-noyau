/**
 * Taille d'entreprise (tranche d'effectif) telle que le réseau la fournit, en libellé français court : « 11-50 employés », « 1001-5 000 employés », « + de 10 000 employés ».
 * LinkedIn renvoie des codes (SIZE_11_TO_50, SIZE_10001_OR_MORE, SIZE_1) ; un libellé déjà lisible (« 11-50 », « 10001+ ») est normalisé de la même façon, et tout autre texte est gardé tel quel.
 */
const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const range = (low: number, high: number) => `${low}-${high >= 1000 ? thousands(high) : high} employés`;
export function companySizeLabel(raw: string): string {
  // Séparateurs de milliers dans un libellé lisible (« 10 001+ », « 10,001+ ») : retirés avant la lecture des bornes.
  const label = String(raw ?? "").trim().replace(/(?<=\d)[\s\u00a0,](?=\d{3}(?!\d))/g, "");
  const between = /^(?:SIZE_)?(\d+)\s*(?:_TO_|-|–|à)\s*(\d+)$/i.exec(label);
  if (between) return range(Number(between[1]), Number(between[2]));
  const orMore = /^(?:SIZE_)?(\d+)\s*(?:_OR_MORE|\+)$/i.exec(label);
  if (orMore) return `+ de ${thousands(Math.max(0, Number(orMore[1]) - 1))} employés`;
  const one = /^SIZE_1$/i.exec(label);
  if (one) return "1 employé";
  if (/^SIZE_NOT_AVAILABLE$|^SIZE_UNKNOWN$/i.test(label)) return "Non précisé";
  // Un code sans contenu (« SIZE_ », chaîne vide) reste une ligne nommée, jamais une valeur sans libellé.
  return label.replace(/^SIZE_/i, "").replace(/_/g, " ").trim() || "Non précisé";
}
