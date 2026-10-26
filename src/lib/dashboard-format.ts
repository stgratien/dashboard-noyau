export const unavailable = "Donnée non disponible";
/** Vrai signe moins (U+2212) comme pour les pourcentages, et jamais de « -0 ». */
export const typographicMinus = (s: string) => (/^-0(,0+)?[KM]?$/.test(s) ? s.slice(1) : s.replace(/^-/, "−"));
export function formatNumber(n: number | null | undefined, decimals = 0) {
  if (n == null || !Number.isFinite(n)) return unavailable;
  const abs = Math.abs(n);
  // À 0 décimale, 999,5 s'arrondirait à « 1 000 » : on bascule en K un peu avant ; de même 999 500 en M (« 1 000K »).
  const divisor = abs >= 999_500 ? 1_000_000 : abs >= (decimals === 0 ? 999.5 : 1_000) ? 1_000 : 1;
  const suffix = divisor === 1_000_000 ? "M" : divisor === 1_000 ? "K" : "";
  return typographicMinus(
    new Intl.NumberFormat("fr-FR", {
      maximumFractionDigits: suffix === "K" && abs >= 99_950 ? 0 : suffix ? Math.max(1, decimals) : decimals,
      // Les millions gardent toujours une décimale (« 1,0M »).
      minimumFractionDigits: suffix === "K" && abs >= 99_950 ? 0 : suffix === "M" ? Math.max(1, decimals) : suffix && decimals === 0 ? 0 : decimals,
    })
      .format(n / divisor)
      .replace(/[\u202f\u00a0]/g, " ") + suffix,
  );
}
export const formatEuro = (n: number | null | undefined, decimals = 0) =>
  n == null || !Number.isFinite(n) ? unavailable : `${formatNumber(n, decimals)}€`;
/** Budget : euros entiers sous 1 000 (« 8€ », « 82€ »), puis K avec virgule (« 1,5K€ »), jamais de centimes ; un budget réel sous 0,50 € s'écrit « <1€ », pas « 0€ ». */
export const formatBudget = (n: number | null | undefined) =>
  n != null && Number.isFinite(n) && n > 0 && n < 0.5 ? "<1€" : formatEuro(n, 0);
/** Percent/point magnitude: no decimal from 10 upward, one decimal below; comma decimal, no space before the unit. */
export function percentDigits(n: number) {
  const r1 = Math.round(Math.abs(n) * 10) / 10;
  return r1 >= 10 ? String(Math.round(Math.abs(n))) : r1.toFixed(1).replace(".", ",");
}
const signOf = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");
export const formatPercent = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? unavailable : `${n < 0 && percentDigits(n) !== "0,0" ? "−" : ""}${percentDigits(n)}%`;
/** Accord français : « 0 vidéo », « 1 vidéo », « 2 vidéos ». */
export const plural = (n: number, word: string) => (Math.abs(n) >= 2 ? `${word}s` : word);
/**
 * Sous-titre de « Vues de vidéo » : le nombre de vidéos publiées a sa propre carte, le sous-titre ne garde que ce qui éclaire le chiffre :
 * absence de vidéo sur la période (les vues sont alors celles de vidéos plus anciennes, ou nulles) et réseaux non comptés au Global.
 */
export const videosNote = (t: { videos: number | null; videoViews: number | null }, notCounted: string[] = []) => {
  if (t.videos == null) return "Nombre de vidéos non disponible";
  return [
    t.videos === 0 ? (t.videoViews ? "Vues de vidéos publiées avant la période" : "Aucune vidéo publiée sur la période") : "",
    notCounted.length ? `hors ${notCounted.join(", ")}` : "",
  ].filter(Boolean).join(" · ");
};
export const formatChangePercent = (n: number) => `${percentDigits(n) === "0,0" ? "" : signOf(n)}${percentDigits(n)}%`;
export const formatPoints = (n: number) => `${percentDigits(n) === "0,0" ? "" : signOf(n)}${percentDigits(n)}pt`;
export const changePercent = (current: number | null | undefined, previous: number | null | undefined) =>
  current == null || previous == null || !previous ? undefined : ((current - previous) / Math.abs(previous)) * 100;
/** Titres de cartes au pluriel et leur singulier : en français, 0 et 1 s'accordent au singulier (« 0 vidéo publiée »). */
const SINGULAR_LABELS: Record<string, string> = {
  "Abonnés": "Abonné", "Nouveaux abonnés": "Nouvel abonné", "Nouveaux abonnés (variation nette)": "Nouvel abonné (variation nette)",
  "Publications": "Publication", "Posts publiés": "Post publié", "Vidéos publiées": "Vidéo publiée",
  "Annonces diffusées": "Annonce diffusée", "Impressions": "Impression", "Impressions totales": "Impression totale", "Impressions moy. / post": "Impression moy. / post",
  "Vues": "Vue", "Vues vidéo": "Vue vidéo", "Vues de vidéo": "Vue de vidéo", "Interactions": "Interaction", "Interactions totales": "Interaction totale",
  "Stories publiées": "Story publiée", "Impressions des stories": "Impression des stories", "Impressions moy. / story": "Impression moy. / story", "Interactions des stories": "Interaction des stories",
  "Clics": "Clic", "Clics sur les liens": "Clic sur les liens", "Conversions": "Conversion", "Sessions": "Session", "Utilisateurs": "Utilisateur", "Pages vues": "Page vue",
};
/** Vrai pour les valeurs affichées 0 ou 1 (avec leur signe éventuel) : « 0 », « 1 », « +1 », « −1 ». */
export const isSingularValue = (value: string) => /^[+−-]?[01]$/.test(value.trim());
/** Titre de carte accordé à sa valeur : singulier quand la valeur affichée est 0 ou 1. */
export const labelForValue = (label: string, value: string) => (isSingularValue(value) ? (SINGULAR_LABELS[label] ?? label) : label);
/** Date de graphique : jour, tiret, mois, sans l'année (« 2026-10-18 » → « 18-10 »). Toute autre valeur est rendue telle quelle. */
export const dayMonth = (iso: unknown) => {
  const m = typeof iso === "string" ? /^\d{4}-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[2]}-${m[1]}` : String(iso);
};

