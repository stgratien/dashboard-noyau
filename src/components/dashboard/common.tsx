import { createContext, useContext, type ReactNode } from "react";
import { readSocialData } from "@/lib/social-data.functions";
import { type RealTotals } from "@/lib/social-totals";
import { changePercent, formatBudget, formatEuro, formatNumber, formatPercent, formatChangePercent, formatPoints, typographicMinus, plural, labelForValue } from "@/lib/dashboard-format";
import { PLATFORMS, type PlatformId } from "@/lib/dashboard-data";
import { cn } from "@/lib/utils";
import { type Period } from "@/lib/dashboard-periods";
import { type GoogleAdsRow } from "@/lib/google-ads";


export type Tab = "overview" | PlatformId | "youtube" | "google" | "web";

export const ComparisonLabel = createContext("vs préc.");

export const PeriodLine = createContext("");

export type ViewPeriods = { period: Period; comparison: Period };

export type SocialData = Awaited<ReturnType<typeof readSocialData>>;

export type GoogleData = { rows: GoogleAdsRow[]; lastSuccess: string | null };

export const fmt = (n: number | null) => formatNumber(n);

export const eur = (n: number | null, d = 0) => formatEuro(n, d);

/** Budget : euros entiers, sans chiffre après la virgule. */
export const budget = (n: number | null) => formatBudget(n);

/** Palette de la marque pour les répartitions (bleu, bleu nuit, accent de la marque, nuances de bleu, gris-bleu). */
/** Palette des graphiques : les jetons --brand-second, --brand-sky et --brand-deep sont facultatifs (src/client/theme.css) ; sans eux, les valeurs de repli ci-dessous s'appliquent. */
export const BRAND_COLORS = ["var(--primary)", "var(--brand-second, var(--heading))", "var(--brand-accent)", "var(--brand-sky, #4DA8E0)", "var(--brand-deep, #14497F)", "var(--muted-foreground)"];

export const pct = formatPercent;

export const delta = changePercent;

export const nf = { format: (n: number | null) => formatNumber(n) };

export function Kpi({
  label,
  value,
  d,
  inverse,
  large,
  note,
  tooltip,
  prev,
  pts,
}: {
  label: string;
  value: string;
  d?: number | undefined;
  prev?: string;
  pts?: number | undefined;
  inverse?: boolean;
  large?: boolean;
  note?: string | undefined;
  tooltip?: string;
}) {
  const comparisonLabel = useContext(ComparisonLabel);
  const title = labelForValue(label, value);
  void tooltip; // Definitions stay in kpi-definitions.ts; nothing is shown on hover.
  const shift = pts ?? d;
  const good = shift === undefined ? true : inverse ? shift <= 0 : shift >= 0;
  const prevShown = prev === undefined || /disponible/.test(prev) ? "—" : prev;
  const change =
    prevShown === "—"
      ? undefined
      : pts !== undefined
        ? formatPoints(pts)
        : d !== undefined
          ? formatChangePercent(d)
          : undefined;
  return (
    <div data-export-card className={cn("min-w-0 rounded-lg border bg-card p-4", large && "p-5 sm:p-6")}>
      <div className="flex items-start justify-between gap-1">
        <p
          className={cn(
            "text-xs font-medium uppercase text-muted-foreground",
            label === "Impressions moy. / post" && "whitespace-nowrap",
          )}
        >
          {title}
        </p>
      </div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <p
          className={cn(
            "break-words font-medium",
            value.includes("non disponible") || value.includes("indisponible")
              ? "text-base text-muted-foreground"
              : "text-2xl",
            large && !value.includes("disponible") && "text-3xl",
          )}
        >
          {value}
        </p>
      </div>
      {prev !== undefined && (
        <p className="mt-1 text-xs text-muted-foreground" title={comparisonLabel}>
          vs {prevShown}
          {change !== undefined && (
            <>
              {" "}
              <span className={cn("font-medium", good ? "text-success" : "text-destructive")}>({change})</span>
            </>
          )}
        </p>
      )}
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

export const shown = (t: RealTotals, value: string) =>
  t.sourceUnavailable && value.includes("non disponible") ? "Source indisponible" : value;

export function coverageDetails(t: RealTotals, key: string, base?: string) {
  const missing = t.missing[key] ?? [];
  const descriptions = missing.map((id) => {
    const [platform, source, count] = id.split(":");
    const name = PLATFORMS.find((p) => p.id === platform)?.name ?? platform;
    if (source === "videos") {
      const n = Number(count);
      return `${n} ${plural(n, "vidéo")} ${name} sans nombre de vues`;
    }
    return source
      ? `${source === "organic" ? "organique" : "payant"} ${name} non disponible sur cette période`
      : `Réseau manquant : ${name}`;
  });
  const tooltip = [base, ...descriptions].filter(Boolean).join(". ");
  return { ...(missing.length ? { note: "partiel" } : {}), ...(tooltip ? { tooltip } : {}) };
}

export function comparableDelta(t: RealTotals, o: RealTotals, key: keyof RealTotals & string) {
  const current = t[key],
    previous = o[key];
  return JSON.stringify(t.missing[key] ?? []) === JSON.stringify(o.missing[key] ?? []) &&
    (typeof current === "number" || current === null) &&
    (typeof previous === "number" || previous === null)
    ? delta(current, previous)
    : undefined;
}

/** Ancres du menu de gauche : chaque titre de partie porte un identifiant et son libellé (data-nav), lus dans la page par le menu. */
export const navSlug = (label: string) => `section-${label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
export const navProps = (label: string) => ({ id: navSlug(label), "data-nav": label });
/** Marge de défilement : la partie atteinte par une ancre s'arrête sous l'en-tête fixe (sa hauteur est mesurée dans --header-h). */
export const NAV_SCROLL = "scroll-mt-[calc(var(--header-h,6rem)+1rem)]";
/** Repère d'un bloc capturé pour le rapport Google Slides (voir report-capture.tsx) : clé de l'image dans le rapport. */
export const reportAttr = (key?: string) => (key ? { "data-report-image": key } : {});
/** Nombre de lignes maximum des listes quand le dashboard est rendu pour le rapport (undefined : toutes, comme à l'écran). */
export const ReportRowLimit = createContext<number | undefined>(undefined);

export function Panel({
  title,
  children,
  className,
  reportKey,
  actions,
  nav,
  bare = false,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  info?: string;
  reportKey?: string;
  /** Commandes de l'en-tête, à droite du titre (marquer data-export-hide celles qui ne doivent pas figurer dans les exports). */
  actions?: ReactNode;
  /** Libellé de l'ancre du menu de gauche, quand ce bloc est une partie de la page à part entière. */
  nav?: string;
  /** Sans en-tête : le titre est porté par une partie de la page. */
  bare?: boolean;
}) {
  return (
    <div data-export-block {...(nav ? navProps(nav) : {})} {...reportAttr(reportKey)} className={cn("relative rounded-lg border bg-card p-4", nav && NAV_SCROLL, className)}>
      {!bare && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{title}</h3>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export const tip = {
  contentStyle: {
    background: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    fontSize: 12,
  },
  itemStyle: { color: "var(--popover-foreground)" },
  labelStyle: { color: "var(--popover-foreground)" },
  separator: " : ",
  formatter: (v: unknown) => (typeof v === "number" ? tooltipNumber(v) : String(v)),
};

export const axis = { fontSize: 11, stroke: "var(--muted-foreground)" };

/** Légendes des axes : séparateur de milliers avec une espace (« 39 200 »), vrai signe moins. */
export const axisNumber = (v: unknown) => (typeof v === "number" ? tooltipNumber(v) : String(v));
/** Légendes d'un axe en euros : le signe € collé au chiffre (« 1 200€ »). */
export const axisEuro = (v: unknown) => (typeof v === "number" ? `${tooltipNumber(v)}€` : String(v));

/** Titre de partie de la page : ancre du menu de gauche (voir navProps). */
export function SectionTitle({ title, className, children }: { title: string; className?: string; children?: ReactNode }) {
  return (
    <h2 {...navProps(title)} className={cn(NAV_SCROLL, className)}>
      {children ?? title}
    </h2>
  );
}

export function BigSection({ title, children, four = false }: { title: string; children: ReactNode; four?: boolean }) {
  return (
    <section data-export-block className="space-y-3">
      <SectionTitle title={title} className="border-b pb-1 text-lg font-medium text-foreground" />
      <div className={cn("grid grid-cols-1 gap-3", four ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3")}>
        {children}
      </div>
    </section>
  );
}

export const tooltipNumber = (v: number) =>
  typographicMinus(v.toLocaleString("fr-FR", { maximumFractionDigits: 2 }).replace(/[\u202f\u00a0]/g, " "));

export function followerNote(t: RealTotals) {
  return (
    [
      t.followerGrowth != null && t.followerGrowthPercent != null
        ? `${formatChangePercent(t.followerGrowthPercent)} (${t.followerGrowth >= 0 ? "+" : ""}${typographicMinus(t.followerGrowth.toLocaleString("fr-FR"))})`
        : undefined,
      t.estimated ? "Valeur estimée" : undefined,
    ]
      .filter(Boolean)
      .join(" · ") || undefined
  );
}
/** Valeur d'une carte Google Ads / YouTube : la valeur si la source a des données, sinon « Source indisponible » ou la mention standard. */
export const gv = (has: boolean, stale: boolean, v: string) => (has ? v : stale ? "Source indisponible" : formatNumber(null));
/** Variation affichée seulement si les deux périodes ont des données. */
export const gd = (a: number | null, b: number | null, okA: boolean, okB: boolean) => (okA && okB ? delta(a, b) : undefined);
