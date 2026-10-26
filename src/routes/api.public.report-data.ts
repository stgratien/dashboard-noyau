import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const MAX_DAYS = 400;
const toTime = (d: string) => Date.parse(`${d}T00:00:00Z`);
// Une date valide fait l'aller-retour : « 2026-02-30 » (rattrapée en mars par Date) et « 2026-13-01 » sont refusées ici, jamais envoyées à la base.
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => { const t = toTime(d); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d; }, "Date invalide");
const validTimes = (p: { start: string; end: string }) => !Number.isNaN(toTime(p.start)) && !Number.isNaN(toTime(p.end));
// Les contrôles de période ne parlent que de dates déjà valides (sinon l'erreur de date suffit).
const range = z.object({ start: day, end: day })
  .refine((p) => !validTimes(p) || p.start <= p.end, "Période inversée")
  .refine((p) => !validTimes(p) || (toTime(p.end) - toTime(p.start)) / 86_400_000 + 1 <= MAX_DAYS, "Période trop longue (400 jours au plus)");
const label = z.string().trim().min(1).max(60);

/**
 * Chiffres du rapport Google Slides pour une période et, en option, la période comparée (lecture seule, mêmes agrégats
 * que le tableau de bord, déjà public).
 * GET /api/public/report-data?start=2026-04-01&end=2026-06-30[&compare_start=2024-04-01&compare_end=2024-06-30&compare_label=T2 2024]
 * → { period, comparison?, tokens: { "linkedin.impressions": "2,1M", "linkedin.impressions_prev": "3,1M", … }, notes: ["LinkedIn, impressions : partiel (…)"] }
 * notes liste les chiffres que le tableau de bord marque « partiel » (vide quand tout est complet).
 */
export const Route = createFileRoute("/api/public/report-data")({
  server: { handlers: { GET: async ({ request }) => {
    const q = new URL(request.url).searchParams;
    const period = range.safeParse({ start: q.get("start"), end: q.get("end") });
    const wantsComparison = q.has("compare_start") || q.has("compare_end") || q.has("compare_label");
    const comparison = wantsComparison
      ? range.safeParse({ start: q.get("compare_start"), end: q.get("compare_end") })
      : undefined;
    const comparisonLabel = wantsComparison ? label.safeParse(q.get("compare_label")) : undefined;
    const issues = [period, comparison, comparisonLabel].flatMap((r) => (r && !r.success ? r.error.issues.map((i) => i.message) : []));
    if (!period.success || (comparison && !comparison.success) || (comparisonLabel && !comparisonLabel.success))
      return Response.json({ error: "Paramètres start et end (AAAA-MM-JJ) requis ; compare_start, compare_end et compare_label vont ensemble", issues: issues.slice(0, 3) }, { status: 400 });
    try {
      const { loadReportTokens } = await import("@/lib/report-data.server");
      const compared = comparison?.success && comparisonLabel?.success ? { period: comparison.data, label: comparisonLabel.data } : undefined;
      const { tokens, notes } = await loadReportTokens(period.data, compared);
      return Response.json({ period: period.data, ...(compared ? { comparison: { ...compared.period, label: compared.label } } : {}), tokens, notes }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      console.error("report-data: calcul impossible", error instanceof Error ? error.message : error);
      return Response.json({ error: "Calcul des chiffres impossible" }, { status: 500 });
    }
  } } },
});
