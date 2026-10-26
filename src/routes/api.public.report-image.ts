import { createFileRoute } from "@tanstack/react-router";
import { GOOGLE_REPORT } from "@/lib/google-report-config";

/**
 * Dépôt temporaire d'une image du rapport : POST (PNG en corps, jeton Google en « Authorization: Bearer ») → { url } signée 15 minutes.
 * Google Slides lit cette adresse pour insérer l'image ; l'objet est supprimé environ une heure plus tard (nettoyage espacé de 5 minutes).
 */
export const Route = createFileRoute("/api/public/report-image")({
  server: { handlers: { POST: async ({ request }) => {
    const server = await import("@/lib/report-image.server");
    const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    const began = Date.now();
    if (!(await server.googleTokenAllowedCached(token, GOOGLE_REPORT.clientId))) return new Response(null, { status: 401 });
    const tokenMs = Date.now() - began;
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > server.REPORT_IMAGE_MAX_BYTES) return Response.json({ error: "Image trop lourde" }, { status: 413 });
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length > server.REPORT_IMAGE_MAX_BYTES) return Response.json({ error: "Image trop lourde" }, { status: 413 });
    if (!server.isPng(bytes)) return Response.json({ error: "PNG attendu" }, { status: 415 });
    try {
      return Response.json({ url: await server.storeReportImage(bytes, { tokenMs }) }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      console.error("report-image: dépôt impossible", error instanceof Error ? error.message : error);
      return Response.json({ error: "Dépôt impossible" }, { status: 500 });
    }
  } } },
});
