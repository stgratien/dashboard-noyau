import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
import { z } from "zod";
import type { WindsorSource } from "@/lib/windsor-config";
import { client } from "@/lib/client";
export const Route = createFileRoute("/api/public/windsor-sync")({
  server: { handlers: { POST: async ({ request }) => {
    const denied = await authenticateCronRequest(request);
    if (denied) return denied;
    const body = z.object({ action: z.enum(["enqueue", "process", "nightly", "sync", "ads", "postAds", "adCreatives", "audience", "stories"]), source: z.string().refine(s => (client.sources as string[]).includes(s)).optional(), start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).safeParse(await request.json());
    if (!body.success) return Response.json({ error: "Invalid request" }, { status: 400 });
    const key = process.env['WINDSOR_API_KEY'] ?? process.env['WINDSOR'];
    if (!key) return Response.json({ error: "Clé Windsor non configurée" }, { status: 503 });
    const sync = await import("@/lib/windsor-sync.server");
    if (body.data.action === "stories") return Response.json(await sync.syncStories(key));
    if (body.data.action === "audience") {
      if (!body.data.source) return Response.json({ error: "Invalid source" }, { status: 400 });
      return Response.json(await sync.syncAudience(body.data.source as WindsorSource, key));
    }
    if (body.data.action === "sync" || body.data.action === "ads" || body.data.action === "postAds" || body.data.action === "adCreatives") {
      if (!body.data.source || !body.data.start || !body.data.end || body.data.start > body.data.end) return Response.json({ error: "Invalid range" }, { status: 400 });
      const run = body.data.action === "ads" ? sync.syncAds : body.data.action === "postAds" ? sync.syncPostAds : body.data.action === "adCreatives" ? sync.syncAdCreatives : sync.syncSource;
      return Response.json(await run(body.data.source as WindsorSource, { start: body.data.start, end: body.data.end }, key));
    }
    if (body.data.action === "enqueue") return Response.json({ jobs: await sync.enqueueImport() });
    if (body.data.action === "nightly") return Response.json(await sync.nightlySync(key, body.data.source as WindsorSource | undefined));
    return Response.json(await sync.processImport(key));
  } } },
});