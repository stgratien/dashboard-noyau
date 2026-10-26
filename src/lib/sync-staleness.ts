// Indicateur d'en-tête : alerte quand la synchro Windsor la plus ancienne date de plus de 30 h.
export const STALE_SYNC_HOURS = 30;
export function staleSyncLabel(lastSuccess: (string | null)[], now = Date.now()): string | null {
  const times = lastSuccess.map((s) => (s ? Date.parse(s) : NaN));
  if (!times.length) return null;
  const oldest = times.some(Number.isNaN) ? NaN : Math.min(...times);
  if (Number.isNaN(oldest)) {
    const known = times.filter((t) => !Number.isNaN(t));
    if (!known.length) return null;
    return label(Math.min(...known));
  }
  return now - oldest > STALE_SYNC_HOURS * 3600_000 ? label(oldest) : null;
}
const label = (t: number) => `Données non mises à jour depuis le ${new Date(t).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit" })}`;
