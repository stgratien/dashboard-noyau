import { createFileRoute } from "@tanstack/react-router";
import { googleAdsPayload, toDbRows } from "@/lib/google-ads";
import { bearerMatches } from "@/lib/bearer-auth";

const unauthorized = () => new Response(null, { status: 401 });

export const Route = createFileRoute("/api/public/google-ads-ingest")({
  server: { handlers: { POST: async ({ request }) => {
    if (!(await bearerMatches(request, process.env["GOOGLE_ADS_INGEST_SECRET"]))) return unauthorized();
    let json: unknown;
    try { json = await request.json(); } catch { return Response.json({ error: "JSON invalide" }, { status: 400 }); }
    const parsed = googleAdsPayload.safeParse(json);
    if (!parsed.success) return Response.json({ error: "Données invalides", issues: parsed.error.issues.slice(0, 5).map(i => ({ path: i.path.join("."), message: i.message })) }, { status: 400 });
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const rows = toDbRows(parsed.data);
    const now = new Date().toISOString();
    for (let i = 0; i < rows.length; i += 500) {
      const saved = await db.from("google_ads_daily").upsert(rows.slice(i, i + 500), { onConflict: "day,campaign_id" });
      if (saved.error) {
        await db.from("social_sync_status").upsert({ source: "google_ads", last_attempt_at: now, state: "error", message: "Enregistrement Google Ads impossible" });
        return Response.json({ error: "Enregistrement impossible" }, { status: 500 });
      }
    }
    await db.from("social_sync_status").upsert({ source: "google_ads", last_attempt_at: now, last_success_at: now, state: "ok", message: null });
    return Response.json({ success: true, rows: rows.length });
  } } },
});
