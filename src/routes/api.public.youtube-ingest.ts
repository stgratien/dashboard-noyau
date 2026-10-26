import { createFileRoute } from "@tanstack/react-router";
import { youtubePayload } from "@/lib/youtube";
import { bearerMatches } from "@/lib/bearer-auth";

export const Route = createFileRoute("/api/public/youtube-ingest")({
  server: { handlers: { POST: async ({ request }) => {
    if (!(await bearerMatches(request, process.env["YOUTUBE_INGEST_SECRET"]))) return new Response(null, { status: 401 });
    let json: unknown;
    try { json = await request.json(); } catch { return Response.json({ error: "JSON invalide" }, { status: 400 }); }
    const parsed = youtubePayload.safeParse(json);
    if (!parsed.success) return Response.json({ error: "Données invalides", issues: parsed.error.issues.slice(0, 5).map(i => ({ path: i.path.join("."), message: i.message })) }, { status: 400 });
    const yt = await import("@/lib/youtube.server");
    try { return Response.json({ success: true, ...(await yt.ingestYoutube(parsed.data)) }); }
    catch { await yt.markYoutubeFailure(); return Response.json({ error: "Enregistrement impossible" }, { status: 500 }); }
  } } },
});
