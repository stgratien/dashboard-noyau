import { z } from "zod";

/**
 * Périodes acceptées par les fonctions de lecture publiques (données sociales, Google Ads, YouTube) : de vraies dates, début avant fin, une durée raisonnable et une fin qui n'est pas
 * dans un futur lointain. Un appel anonyme ne peut pas ainsi réclamer « 0001-01-01 → 9999-12-31 » ni relire des siècles de jours. L'historique le plus long du tableau de bord
 * (« Toute la période ») reste très en deçà de ces bornes.
 */
export const MAX_READ_DAYS = 4000;
const toTime = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Une date valide fait l'aller-retour : « 2026-02-30 » et « 2026-13-01 » sont refusées. */
export const realDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => {
  const t = toTime(d);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
}, "Date invalide");

const FIRST_DAY = "2000-01-01";
const FUTURE_DAYS = 400;

export const readRange = z
  .object({ start: realDay, end: realDay })
  .refine((p) => Number.isNaN(toTime(p.start)) || Number.isNaN(toTime(p.end)) || p.start <= p.end, "Période inversée")
  .refine((p) => p.start >= FIRST_DAY, "Période trop ancienne")
  .refine((p) => Number.isNaN(toTime(p.end)) || toTime(p.end) <= Date.now() + FUTURE_DAYS * 86_400_000, "Période trop lointaine")
  .refine((p) => Number.isNaN(toTime(p.start)) || Number.isNaN(toTime(p.end)) || (toTime(p.end) - toTime(p.start)) / 86_400_000 + 1 <= MAX_READ_DAYS, "Période trop longue");
