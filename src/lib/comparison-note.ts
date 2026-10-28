import { PLATFORMS, type PlatformId } from "./dashboard-data";
import { PLATFORM_SOURCES } from "../core/client-config";
import { calendarDate, type Period } from "./dashboard-periods";
import type { RealTotals, SocialDay } from "./social-totals";

/**
 * Premier jour dont les chiffres organiques du compte sont utilisables (historique manuel déjà fusionné) : un jour du fournisseur à zéro, ou dans une série
 * de zéros écartée (accountOrganicUnavailable), n'en est pas un. Null sans aucun jour, et pour TikTok dont l'organique vient des publications.
 */
export function organicHistoryStart(days: readonly SocialDay[], p: PlatformId): string | null {
  if (p === "tiktok") return null;
  const organic = PLATFORM_SOURCES[p][0];
  let first: string | null = null;
  for (const d of days) {
    if (d.platform !== p || d.source !== organic) continue;
    const usable =
      d.metrics["manualOrganicHistory"] === 1 ||
      (d.metrics["accountOrganicUnavailable"] !== 1 && (d.metrics["impressions"] ?? 0) > 0);
    if (usable && (first === null || d.day < first)) first = d.day;
  }
  return first;
}

const organicMissing = (t: RealTotals, p: PlatformId) => (t.missing["impressions"] ?? []).includes(`${p}:organic`);

/**
 * Explique les « vs — » d'un onglet réseau : la période comparée n'a pas de chiffres organiques alors que la période affichée en a. Sans note quand les deux
 * périodes ont leur organique (rien à expliquer) ou qu'aucune ne l'a (les cartes disent déjà « Donnée non disponible »).
 */
export function comparisonGapNote(
  p: PlatformId,
  days: readonly SocialDay[],
  totals: RealTotals,
  compared: RealTotals,
  comparison: Period,
): string | null {
  if (organicMissing(totals, p) || !organicMissing(compared, p)) return null;
  const name = PLATFORMS.find((x) => x.id === p)?.name ?? p;
  const start = organicHistoryStart(days, p);
  // Les publications, les vidéos publiées et le payant se comparent quand même : la phrase ne vise que les chiffres organiques.
  const reason =
    start && comparison.start < start
      ? `ne remontent pas avant le ${calendarDate(start).toLocaleDateString("fr-FR")}`
      : "sont incomplets sur la période comparée";
  // TikTok : l'organique vient des vidéos publiées, jamais du compte.
  const scope = p === "tiktok" ? "des publications" : "du compte";
  return `${name} : les chiffres organiques ${scope} (impressions, interactions…) ${reason}, leur comparaison reste donc vide.`;
}
