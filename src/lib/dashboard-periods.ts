import { client } from "@/lib/client";
export type Period = {
  start: string;
  end: string;
  name?: string;
  comparisonKind?: "rolling" | "month-to-date" | "month" | "year" | "quarter";
};
export type ComparisonMode = "previous" | "edition" | "two-years" | "custom";

// Configuration unique des éditions du client (src/client/config.ts) : les comparaisons utilisent ces dates exactes.
export const EDITIONS: { name: string; start: string; end: string }[] = client.events.editions;

const DAY = 86_400_000;
export const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY);
export const isoFromDay = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);
export const periodDays = (period: Period) => dayNumber(period.end) - dayNumber(period.start) + 1;
const parisDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
/** Jour courant à Paris (AAAA-MM-JJ) : le tableau de bord suit le jour de l'équipe, pas l'UTC. */
export const todayISO = () => parisDate.format(new Date());
/** Dernier jour complet : la veille à Paris, par soustraction d'un jour calendaire (sans décalage d'heure d'été). */
export const yesterdayISO = () => isoFromDay(dayNumber(todayISO()) - 1);
/** Premier jour de données : début de l'historique importé (aucune donnée avant, tous réseaux confondus ; Meta organique n'est disponible que depuis fin 2024, ce que les totaux signalent « partiel »). */
export const DATA_START = client.data.start;
export const lastDays = (days: number, today = todayISO()): Period => ({
  start: isoFromDay(dayNumber(today) - days + 1),
  end: today,
});
/** Dernier jour du trimestre qui contient la date donnée. */
const quarterEndOf = (iso: string) =>
  new Date(Date.UTC(Number(iso.slice(0, 4)), Math.floor((Number(iso.slice(5, 7)) - 1) / 3) * 3 + 3, 0)).toISOString().slice(0, 10);
export const previousPeriod = (period: Period): Period => ({
  start: isoFromDay(dayNumber(period.start) - periodDays(period)),
  end: isoFromDay(dayNumber(period.start) - 1),
});
export function previousEdition(period: Period) {
  const editions = [...EDITIONS].sort((a, b) => a.start.localeCompare(b.start));
  const index = editions.findIndex((edition) => edition.start === period.start && edition.end === period.end);
  return index > 0 ? editions[index - 1] : undefined;
}
/** Éditions proposées en raccourci de comparaison : les éditions déjà terminées, sauf celle qui est la période affichée (se comparer à soi-même n'a pas de sens). */
export const comparisonEditions = (period: Period, today = todayISO()) =>
  EDITIONS.filter((edition) => edition.end < today && !(edition.start === period.start && edition.end === period.end));
/** « Même période il y a 2 ans » n'a de sens que si la période décalée finit avant la période affichée (« Toute la période » ou trois ans de données se chevaucheraient). */
export const twoYearsAvailable = (period: Period) => comparisonFor(period, "two-years").period.end < period.start;
/** Valeur de la liste « Comparaison » pour le mode courant : « Même période il y a 2 ans », un raccourci d'édition (période nommée), la période personnalisée ou, sinon, la période précédente. */
export const comparisonChoice = (mode: ComparisonMode, edition?: string) =>
  mode === "two-years" ? "two-years" : mode !== "custom" ? "previous" : edition ? `edition:${edition}` : "custom";
/** `custom` : la période choisie à la main (« Période personnalisée ») ou un raccourci d'édition (elle porte alors son nom : « vs Édition 2023 ») ; sans dates, on retombe sur la période précédente. */
export function comparisonFor(period: Period, mode: ComparisonMode, custom?: Period) {
  if (mode === "custom" && custom)
    return {
      period: { start: custom.start, end: custom.end, ...(custom.name ? { name: custom.name } : {}) },
      label: `vs ${custom.name ?? formatPeriod(custom)}`,
      description: custom.name ?? "Période personnalisée",
    };
  const edition = mode === "edition" ? previousEdition(period) : undefined;
  if (edition) return { period: edition, label: `vs ${edition.name}`, description: edition.name };
  const shift = (iso: string, months: number) => {
    const d = new Date(`${iso}T00:00:00Z`);
    const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    return isoFromDay(dayNumber(first.toISOString().slice(0, 10)) + Math.min(d.getUTCDate(), last) - 1);
  };
  if (mode === "two-years") {
    const year = Number(period.start.slice(0, 4)) - 2;
    const label =
      period.comparisonKind === "quarter"
        ? `vs T${Math.floor((Number(period.start.slice(5, 7)) - 1) / 3) + 1} ${year}`
        : `vs même période ${year}`;
    const partialQuarter = period.comparisonKind === "quarter" && period.end < quarterEndOf(period.start);
    return {
      period: { start: shift(period.start, -24), end: shift(period.end, -24) },
      label,
      description: partialQuarter ? `${label.slice(3)} (mêmes jours)` : label.slice(3),
    };
  }
  if (period.comparisonKind === "quarter") {
    const start = shift(period.start, -3);
    // Trimestre en cours (partiel) : comparé aux mêmes jours du trimestre précédent, pas à ses 92 jours.
    const partial = period.end < quarterEndOf(period.start);
    const end = partial ? isoFromDay(dayNumber(start) + periodDays(period) - 1) : isoFromDay(dayNumber(period.start) - 1);
    const label = `vs T${Math.floor((Number(start.slice(5, 7)) - 1) / 3) + 1} ${start.slice(0, 4)}`;
    return { period: { start, end }, label, description: partial ? `${label.slice(3)} (mêmes jours)` : label.slice(3) };
  }
  if (period.comparisonKind === "year")
    return {
      period: { start: shift(period.start, -12), end: shift(period.end, -12) },
      label: "vs année préc.",
      description: "Mêmes dates de l’année précédente",
    };
  if (period.comparisonKind === "month-to-date")
    return {
      period: { start: shift(period.start, -1), end: shift(period.end, -1) },
      label: "vs mois préc.",
      description: "Mêmes jours du mois précédent",
    };
  if (period.comparisonKind === "month") {
    const end = isoFromDay(dayNumber(period.start) - 1);
    return {
      period: { start: `${end.slice(0, 7)}-01`, end },
      label: "vs mois préc.",
      description: "Mois précédent entier",
    };
  }
  return { period: previousPeriod(period), label: "vs préc.", description: "Période précédente" };
}
export function periodShortcuts(today = todayISO()): (Period & { name: string })[] {
  // Rolling shortcuts end on the last complete day (yesterday).
  const y = isoFromDay(dayNumber(today) - 1);
  const firstYear = Number(DATA_START.slice(0, 4));
  const year = y.slice(0, 4),
    monthStart = `${y.slice(0, 7)}-01`;
  const previousMonthEnd = isoFromDay(dayNumber(monthStart) - 1);
  return [
    ...[7, 30, 90].map((days) => ({ name: `${days} derniers jours`, ...lastDays(days, y) })),
    { name: "Mois en cours", start: monthStart, end: y, comparisonKind: "month-to-date" as const },
    {
      name: "Mois précédent",
      start: `${previousMonthEnd.slice(0, 7)}-01`,
      end: previousMonthEnd,
      comparisonKind: "month" as const,
    },
    { name: "Année en cours", start: `${year}-01-01`, end: y, comparisonKind: "year" as const },
    // Chaque année complète depuis le début des données (la liste ne doit pas s'arrêter à 2025 : 2026 apparaît dès 2027).
    ...Array.from({ length: Math.max(0, Number(year) - firstYear) }, (_, i) => firstYear + i).map((fullYear) => ({
      name: String(fullYear),
      start: `${fullYear}-01-01`,
      end: `${fullYear}-12-31`,
      comparisonKind: "year" as const,
    })),
    ...EDITIONS,
    // Les trimestres de chaque année depuis le début des données, du plus récent au plus ancien (T4 2026, T3 2026… T2 2023).
    ...Array.from({ length: Number(year) - Number(DATA_START.slice(0, 4)) + 1 }, (_, i) => Number(year) - i).flatMap((yy) =>
      [4, 3, 2, 1].map((q) => ({
        name: `T${q} ${yy}`,
        start: `${yy}-${String((q - 1) * 3 + 1).padStart(2, "0")}-01`,
        end: [new Date(Date.UTC(yy, q * 3, 0)).toISOString().slice(0, 10), y].sort()[0] ?? y,
        comparisonKind: "quarter" as const,
      })).filter((quarter) => quarter.start <= y && quarter.end >= DATA_START), // pas de trimestre pas encore commencé, ni terminé avant les données
    ),
  ];
}
/** « Toute la période » : du premier jour de données (DATA_START) à hier. Raccourci direct, hors des groupes dépliables. */
export const allTimeShortcut = (today = todayISO()): Period & { name: string } => ({
  name: "Toute la période",
  start: DATA_START,
  end: isoFromDay(dayNumber(today) - 1),
});
export type ShortcutGroup = { name: string; items: (Period & { name: string })[]; subgroups?: { name: string; items: (Period & { name: string })[] }[] };
export function periodShortcutGroups(today = todayISO()): ShortcutGroup[] {
  const shortcuts = periodShortcuts(today);
  const currentYear = isoFromDay(dayNumber(today) - 1).slice(0, 4);
  const quarters = shortcuts.filter((s) => s.comparisonKind === "quarter");
  // Les autres années sont des sous-menus (une liste de trimestres depuis 2023 serait interminable).
  const otherYears = [...new Set(quarters.map((s) => s.name.slice(3)).filter((yy) => yy !== currentYear))];
  return [
    { name: "Derniers jours", items: shortcuts.filter((s) => s.name.endsWith("derniers jours")) },
    { name: "Mois", items: shortcuts.filter((s) => s.name.startsWith("Mois")) },
    // Les trimestres de l'année en cours, du plus récent au plus ancien ; les années précédentes en sous-menus.
    {
      name: "Trimestres",
      items: quarters.filter((s) => s.name.endsWith(currentYear)),
      subgroups: otherYears.map((yy) => ({ name: yy, items: quarters.filter((s) => s.name.endsWith(yy)) })),
    },
    // Du plus récent au plus ancien : l'année en cours tout en haut, puis les années complètes (2025, 2024, 2023).
    {
      name: "Années",
      items: [
        ...shortcuts.filter((s) => s.name === "Année en cours"),
        ...shortcuts.filter((s) => /^\d{4}$/.test(s.name)).sort((a, b) => b.start.localeCompare(a.start)),
      ],
    },
    // Les éditions aussi, de la plus récente à la plus ancienne ; pas de groupe pour un client sans éditions.
    ...(EDITIONS.length
      ? [{ name: client.events.groupLabel, items: shortcuts.filter((s) => EDITIONS.some((e) => e.name === s.name && e.start === s.start && e.end === s.end)).sort((a, b) => b.start.localeCompare(a.start)) }]
      : []),
  ];
}
/** Libellé de comparaison au milieu d'une phrase : en minuscules, sauf le nom d'une édition ou d'un trimestre (« Édition 2023 », « T2 2026 »). */
export const comparisonInSentence = (description: string) =>
  EDITIONS.some((e) => description.startsWith(e.name)) || /^T\d/.test(description) ? description : description.toLocaleLowerCase("fr-FR");
// Dates locales réservées au calendrier, sans conversion de fuseau sur les dates métier.
export const calendarDate = (iso: string) => {
  const [year = 1970, month = 1, day = 1] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
};
export const calendarISO = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const formatPeriod = (period: Period) =>
  `${calendarDate(period.start).toLocaleDateString("fr-FR")} – ${calendarDate(period.end).toLocaleDateString("fr-FR")}`;
