import { supabaseAdmin as db } from "@/integrations/supabase/client.server";
import { HISTORY_START, THUMBNAIL_BUCKET, type WindsorSource } from "@/lib/windsor-config";
import { activeSources, sourceAccount } from "@/lib/windsor-accounts.server";
import { client } from "@/lib/client";
import { dayNumber, isoFromDay, lastDays, EDITIONS, type Period } from "@/lib/dashboard-periods";
import { paidMetrics, organicMetrics, mapPost, isVideoType, numberValue, SOURCE_PLATFORMS, AUDIENCE_SPECS, audienceFields, audienceValues, postRefFromAd, postIdFromAd, STORY_FIELDS, STORY_CORE_FIELDS, mapStory, mergeStory, type MappedStory, type RawRow, type Metrics } from "@/lib/windsor-mapping";
import { STORY_MAX_GAP_MINUTES } from "@/lib/social-stories";
import type { Json } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

const DAILY: Record<WindsorSource, string[][]> = {
  facebook: [["publisher_platform", "spend", "impressions", "actions_video_view", "actions_post_reaction", "actions_comment", "actions_post", "outbound_clicks_outbound_click"]],
  facebook_organic: [["page_follows", "page_daily_follows_unique", "page_impressions_organic", "page_video_views_organic"]],
  instagram: [["views", "likes", "comments", "shares"], ["followers_count", "follower_count_1d"]],
  tiktok: [["spend", "impressions", "play_duration_2s", "likes", "comments", "shares", "clicks"]],
  tiktok_organic: [["total_followers_count", "daily_total_followers"], ["bio_link_clicks"]],
  linkedin: [["spend", "impressions", "video_views", "likes", "comments", "shares", "landing_page_clicks"]],
  linkedin_organic: [["account_analytics_impression_count", "account_analytics_like_count", "account_analytics_comment_count", "account_analytics_share_count"], ["followers_gain_organic", "followers_gain_paid"]],
};
const POSTS: Partial<Record<WindsorSource, string>> = {
  facebook_organic: "post_id,post_created_time,post_message,permalink_url,full_picture,post_type,post_impressions,post_reactions_total,post_comments_total,post_activity_by_action_type_share,post_clicks_by_type_link_clicks",
  instagram: "media_id,timestamp,media_caption,media_permalink,media_url,media_thumbnail_url,media_type,media_views,media_like_count,media_comments_count,media_shares",
  tiktok_organic: "video_id,video_create_datetime,video_caption,video_share_url,video_thumbnail_url,video_views_count,video_likes,video_comments,video_shares",
  linkedin_organic: "share_id,share_published_time,share_text,share_url,share_image_url,share_thumbnail,share_post_type,share_impression_count,share_like_count,share_comment_count,share_count,share_video_views",
};
const paid = (s: WindsorSource) => s === "facebook" || s === "tiktok" || s === "linkedin";
function parisDay() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }

async function fetchRows(source: WindsorSource, period: Period, fields: string, key: string): Promise<RawRow[]> {
  const url = new URL(`https://connectors.windsor.ai/${source}`);
  url.search = new URLSearchParams({ api_key: key, date_from: period.start, date_to: period.end, fields, select_accounts: sourceAccount(source) }).toString();
  let response: Response;
  try { response = await fetch(url, { signal: AbortSignal.timeout(90000) }); }
  catch { throw new Error("Windsor : délai dépassé ou connexion interrompue"); }
  const payload = await response.json() as { data?: RawRow[]; error?: unknown; message?: unknown };
  if (!response.ok || payload.error) {
    // Ne conserver ni URL ni texte arbitraire du fournisseur : ils peuvent contenir la clé.
    throw new Error(`Windsor : requête refusée (HTTP ${response.status})`);
  }
  if (!Array.isArray(payload.data)) throw new Error("Windsor : réponse invalide");
  // select_accounts est imposé serveur. account_id n'est pas disponible à tous les niveaux organiques.
  return payload.data.filter((row) => row['account_id'] == null || String(row['account_id']) === sourceAccount(source));
}

/** Une adresse d'image : rend le chemin stocké, ou la raison de l'échec (jamais l'adresse elle-même : elle porte une signature). */
async function storeThumbnail(source: WindsorSource, path: string, remote: string): Promise<{ path: string } | { reason: string }> {
  let url: URL;
  try { url = new URL(remote); } catch { return { reason: "adresse invalide" }; }
  const allowed = ["fbcdn.net", "cdninstagram.com", "tiktokcdn.com", "tiktokcdn-us.com", "tiktokcdn-eu.com", "byteoversea.com", "licdn.com", "tiktok.com", "ibytedtos.com"];
  if (url.protocol !== "https:" || !allowed.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) return { reason: `hôte non autorisé (${url.hostname})` };
  let result: Response;
  try { result = await fetch(url, { signal: AbortSignal.timeout(12000), redirect: "manual" }); } catch (error) { return { reason: `${url.hostname} : ${failureText(error)}` }; }
  const type = result.headers.get("content-type") ?? "";
  if (!result.ok || !type.startsWith("image/")) return { reason: `${url.hostname} HTTP ${result.status} ${type || "sans type"}` };
  try {
    const data = await result.arrayBuffer();
    if (data.byteLength > 10_000_000) return { reason: "image de plus de 10 Mo" };
    const saved = await db.storage.from(THUMBNAIL_BUCKET).upload(path, data, { contentType: type, upsert: true });
    return saved.error ? { reason: `stockage refusé : ${failureText(saved.error)}` } : { path };
  } catch (error) { return { reason: `${url.hostname} : ${failureText(error)}` }; }
}

/** Résume les vignettes absentes d'un passage : les trois raisons les plus fréquentes avec leur nombre (la forme d'une entrée est « identifiant : raison »). */
const summarizeGaps = (gaps: string[]) => {
  const counts = new Map<string, number>();
  for (const gap of gaps) {
    const reason = gap.slice(gap.indexOf(" : ") + 3);
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([reason, n]) => `${n} × ${reason}`).join(" ; ");
};

/** Cause d'un échec sans jamais citer d'adresse (elle porte une signature) : nom de l'erreur et début du message, toute URL remplacée. */
const failureText = (error: unknown) => (error instanceof Error ? `${error.name} ${error.message.replace(/https?:\/\/\S+/g, "<url>").slice(0, 100)}`.trim() : "erreur inconnue");

/** Vignette d'une publication : celle déjà stockée, sinon la première adresse fournie qui se télécharge ; la raison de chaque échec est journalisée (sans l'adresse). */
async function thumbnail(source: WindsorSource, postId: string, remotes: string[], gaps?: string[]) {
  const path = `${source}/${encodeURIComponent(postId)}.image`;
  const old = await db.from("social_posts").select("thumbnail_path").eq("platform", SOURCE_PLATFORMS[source][0] ?? "facebook").eq("post_id", postId).maybeSingle();
  if (old.data?.thumbnail_path) return old.data.thumbnail_path;
  const reasons: string[] = [];
  for (const remote of remotes) {
    const stored = await storeThumbnail(source, path, remote);
    if ("path" in stored) return stored.path;
    reasons.push(stored.reason);
  }
  const why = reasons.length ? reasons.join(" ; ") : "aucune adresse d'image fournie par le connecteur";
  console.warn(`Vignette absente (${source}) : publication ${postId} — ${why}`);
  gaps?.push(`${postId} : ${why}`);
  return null;
}

export async function syncSource(source: WindsorSource, period: Period, key: string) {
  const now = new Date().toISOString();
  const today = parisDay();
  const isPaid = paid(source);
  // Publications restées sans vignette pendant ce passage, avec la raison : renvoyées dans le résultat (lisible dans la réponse du cron) pour comprendre un visuel qui ne remonte pas.
  const thumbnailGaps: string[] = [];
  const daily = new Map<string, { platform: string; day: string; source: string; metrics: Metrics; followers_estimated: boolean; synced_at: string }>();
  const merge = (platform: string, day: string, metrics: Metrics, additive = false) => {
    if ((day < period.start || day > period.end) && day !== today) return;
    const id = `${platform}:${day}`;
    const item = daily.get(id) ?? { platform, day, source, metrics: {}, followers_estimated: false, synced_at: now };
    for (const [field, value] of Object.entries(metrics)) {
      if (value == null) continue;
      item.metrics[field] = additive ? (item.metrics[field] ?? 0) + value : value;
    }
    daily.set(id, item);
  };
  let audience: Awaited<ReturnType<typeof syncAudience>> | null = null;
  try {
    for (const fields of DAILY[source]) {
      let range = period;
      if (source === "tiktok_organic") range = { ...range, start: range.start < lastDays(60, today).start ? lastDays(60, today).start : range.start };
      if (source === "instagram" && fields.includes("follower_count_1d")) range = { ...range, start: range.start < lastDays(30, today).start ? lastDays(30, today).start : range.start };
      if (range.start > range.end) continue;
      // Séparer niveaux ANALYTICS/ORGANIZATION/SHARE et instantanés : Windsor interdit leur mélange.
      const rows = await fetchRows(source, range, `date${isPaid || source === "facebook_organic" ? ",account_id" : ""},${fields.join(",")}`, key);
      for (const row of rows) {
        const day = String(row['date'] ?? "").slice(0, 10);
        const platform = source === "facebook" ? String(row['publisher_platform']) : SOURCE_PLATFORMS[source][0];
        if (!platform || !SOURCE_PLATFORMS[source].includes(platform as "facebook" | "instagram" | "tiktok" | "linkedin")) continue;
        const metrics = isPaid ? paidMetrics(source, row) : organicMetrics(source, row);
        // Followers_count/total_followers_count sont uniquement des instantanés actuels.
        if (source === "instagram" || source === "tiktok_organic" || source === "linkedin_organic") {
          if (metrics['followers'] != null) merge(platform, today, { followers: metrics['followers'] });
          delete metrics['followers'];
        }
        merge(platform, day, metrics, isPaid);
      }
      if (isPaid) {
        // Une réponse paid réussie sans ligne représente une absence de diffusion, pas une panne.
        for (let d = dayNumber(range.start); d <= dayNumber(range.end); d++) for (const platform of SOURCE_PLATFORMS[source]) {
          const day = isoFromDay(d);
          if (!daily.has(`${platform}:${day}`)) merge(platform, day, { spend: 0, impressions: 0, videoViews: 0, likes: 0, comments: 0, shares: 0, linkClicks: 0 });
        }
      }
    }
    const postFields = POSTS[source];
    if (postFields) {
      // TikTok video lifetime data has full history; account-level retention does not apply.
      const range = source === "tiktok_organic" ? { start: HISTORY_START, end: today } : period;
      // Les vues et interactions cumulées d'une publication bougent pendant des semaines : un passage récent (nuit) relit les publications des 30 derniers jours, pas seulement des 7.
      const recent = lastDays(30, today).start;
      const postRange = source !== "tiktok_organic" && period.end >= lastDays(7, today).start && period.start > recent ? { start: recent, end: period.end } : range;
      const rows = await fetchRows(source, postRange, postFields, key);
      const unique = new Map<string, NonNullable<ReturnType<typeof mapPost>>>();
      for (const row of rows) { const post = mapPost(source, row); if (post) unique.set(post.post_id, post); }
      for (const post of unique.values()) {
        const { remoteThumbnail: _single, remoteThumbnails, ...stored } = post;
        const saved = await db.from("social_posts").upsert({ ...stored, metrics: stored.metrics as Json, thumbnail_path: await thumbnail(source, post.post_id, remoteThumbnails, thumbnailGaps), synced_at: now });
        if (saved.error) throw new Error("Enregistrement des publications impossible");
      }
      // Les métriques lifetime des publications ne sont pas des interactions journalières.
      // Demander date + post_id pour les métriques de période, sans répliquer les totaux de page.
      if (source === "facebook_organic" || source === "instagram" || source === "linkedin_organic") {
        const dailyFields = source === "facebook_organic" ? "date,post_id,post_reactions_total,post_comments_total,post_activity_by_action_type_share,post_clicks_by_type_link_clicks" : source === "instagram" ? "date,media_id,media_type,media_views" : "date,share_id,share_video_views";
        const dated = await fetchRows(source, range, dailyFields, key);
        // A successful dated-publication response establishes zero on days with no activity;
        // absent account analytics are still unavailable, never filled with fabricated zero.
        for (const item of daily.values()) if (item.day >= range.start && item.day <= range.end) {
          const zeros = source === "facebook_organic" ? { likes: 0, comments: 0, shares: 0, linkClicks: 0 } : { videoViews: 0 };
          Object.assign(item.metrics, zeros);
        }
        for (const row of dated) {
          const metrics: Metrics = source === "facebook_organic" ? { likes: Number(row['post_reactions_total'] ?? 0), comments: Number(row['post_comments_total'] ?? 0), shares: Number(row['post_activity_by_action_type_share'] ?? 0), linkClicks: Number(row['post_clicks_by_type_link_clicks'] ?? 0) }
            : { videoViews: source === "instagram" ? isVideoType(String(row['media_type'])) ? Number(row['media_views'] ?? 0) : 0 : Number(row['share_video_views'] ?? 0) };
          merge(SOURCE_PLATFORMS[source][0] ?? "facebook", String(row['date']).slice(0, 10), metrics, true);
        }
      }
      for (let d = dayNumber(range.start); d <= dayNumber(range.end); d++) {
        const day = isoFromDay(d), platform = SOURCE_PLATFORMS[source][0] ?? "facebook";
        merge(platform, day, { postsAvailable: 1 });
      }
    }
    // Always fetch the current follower snapshot separately, even during historical imports.
    if (source === "instagram" || source === "tiktok_organic") {
      const field = source === "instagram" ? "followers_count" : "total_followers_count";
      const snapshots = await fetchRows(source, { start: today, end: today }, `date,${field},${source === "instagram" ? "follower_count_1d" : "daily_total_followers"}`, key);
      for (const row of snapshots) {
        const growth = organicMetrics(source, row)['newFollowers'];
        if (growth != null) merge(SOURCE_PLATFORMS[source][0] ?? "instagram", today, { newFollowers: growth });
      }
      const value = snapshots.map(row => organicMetrics(source, row)['followers']).find(v => v != null);
      if (value != null) merge(SOURCE_PLATFORMS[source][0] ?? "instagram", today, { followers: value });
    }
    // Reconstitution uniquement sur les jours dont la variation est effectivement connue.
    if (source === "instagram" || source === "tiktok_organic") {
      const platform = SOURCE_PLATFORMS[source][0] ?? "instagram";
      const snapshot = daily.get(`${platform}:${today}`)?.metrics['followers'];
      if (snapshot != null) {
        let followers = snapshot;
        for (let d = dayNumber(today) - 1; d >= dayNumber(period.start); d--) {
          const variation = daily.get(`${platform}:${isoFromDay(d + 1)}`)?.metrics['newFollowers'];
          if (variation == null) break;
          followers -= variation;
          const item = daily.get(`${platform}:${isoFromDay(d)}`);
          if (item) { item.metrics['followers'] = followers; item.followers_estimated = true; }
        }
      }
    }
    // Merge avec les métriques déjà connues : une donnée manquante ne détruit jamais un instantané.
    const existing = await db.from("social_daily").select("platform,day,metrics,followers_estimated").eq("source", source).gte("day", period.start).lte("day", today > period.end ? today : period.end);
    for (const old of existing.data ?? []) {
      const item = daily.get(`${old.platform}:${old.day}`);
      if (item) item.metrics = { ...(old.metrics as Metrics), ...item.metrics };
    }
    const values = [...daily.values()].map((row) => ({ ...row, metrics: row.metrics as Json }));
    for (let i = 0; i < values.length; i += 200) {
      const result = await db.from("social_daily").upsert(values.slice(i, i + 200));
      if (result.error) throw new Error("Enregistrement des données impossible");
    }
    if (source === "linkedin_organic") await syncLinkedInFollowers(key);
    if (isPaid) {
      const ads = await syncAds(source, period, key);
      if (!ads.success) throw new Error(ads.message ?? "Synchronisation des annonces impossible");
      const sponsored = await syncPostAds(source, period, key);
      if (!sponsored.success) throw new Error(sponsored.message ?? "Synchronisation des publications sponsorisées impossible");
      const creatives = await syncAdCreatives(source, period, key);
      if (!creatives.success) throw new Error(creatives.message ?? "Synchronisation des publicités impossible");
    } else if (period.end >= lastDays(7, today).start) audience = await syncAudience(source, key);
    // La source reste « ok » : seule l'audience ou des vignettes ont échoué ; le détail est gardé dans le message (lisible en base, jamais affiché).
    const notes = [audience?.failed.length ? `Audience non mise à jour : ${audience.failed.join(", ")}` : null, thumbnailGaps.length ? `Vignettes absentes : ${summarizeGaps(thumbnailGaps)}` : null].filter(Boolean);
    await db.from("social_sync_status").upsert({ source, last_attempt_at: now, last_success_at: now, state: "ok", message: notes.length ? notes.join(" · ").slice(0, 600) : null });
    return { source, days: values.length, success: true, ...(thumbnailGaps.length ? { thumbnailGapCount: thumbnailGaps.length, thumbnailGaps: thumbnailGaps.slice(0, 12) } : {}) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Synchronisation interrompue";
    const historical = period.end < lastDays(90, today).start;
    await db.from("social_sync_status").upsert({ source, last_attempt_at: now, ...(historical ? {} : { state: "error" }), message });
    return { source, days: 0, success: false, message };
  }
}

export async function syncLinkedInFollowers(key: string) {
  const today = parisDay(), now = new Date().toISOString();
  const rows = await fetchRows('linkedin_organic', lastDays(7, today), 'date,organization_follower_count', key);
  const value = rows.map(r => numberValue(r['organization_follower_count'])).find(v => v != null);
  if (value == null) throw new Error('Instantané LinkedIn indisponible');
  const history: { day: string; metrics: Metrics }[] = [];
  for (let offset=0;;offset+=1000) {
    const r = await db.from('social_daily').select('day,metrics').eq('source','linkedin_organic').eq('platform','linkedin').lte('day',today).order('day',{ascending:false}).range(offset,offset+999);
    if (r.error) throw new Error('Historique LinkedIn indisponible');
    history.push(...r.data.map(d => ({ day:d.day,metrics:d.metrics as Metrics })));
    if (r.data.length<1000) break;
  }
  const byDay = new Map(history.map(d => [d.day,d.metrics]));
  const snapshotMetrics = byDay.get(today) ?? {};
  const values = [{ platform:'linkedin',source:'linkedin_organic',day:today,metrics:{...snapshotMetrics,followers:value} as Json,followers_estimated:false,synced_at:now }];
  let followers: number | null = value;
  for (let d=dayNumber(today)-1; d>=dayNumber(HISTORY_START);d--) {
    const next = byDay.get(isoFromDay(d+1))?.['newFollowers'];
    followers = followers == null || next == null ? null : followers-next;
    const day=isoFromDay(d), metrics=byDay.get(day);
    // Une valeur inconnue (null) n'est jamais écrite : elle effacerait l'instantané relevé la nuit où il était connu.
    if (metrics && followers != null) values.push({platform:'linkedin',source:'linkedin_organic',day,metrics:{...metrics,followers} as Json,followers_estimated:true,synced_at:now});
  }
  for (let i=0;i<values.length;i+=200) {
    const r=await db.from('social_daily').upsert(values.slice(i,i+200));
    if(r.error) throw new Error('Enregistrement des abonnés LinkedIn impossible');
  }
  return { success:true, days:values.length, followers:value };
}

/** Separate ad×day facts; a successful empty response establishes coverage, not a missing source. */
export async function syncAds(source: WindsorSource, period: Period, key: string) {
  if (!paid(source)) return { success: false, message: "Source publicitaire requise" };
  try {
    const idField = source === "linkedin" ? "creative_id" : "ad_id";
    const fields = `date,account_id,${idField},${source === "facebook" ? "publisher_platform," : ""}impressions`;
    const rows = await fetchRows(source, period, fields, key);
    const now = new Date().toISOString();
    const deliveries = new Map<string, { source: string; platform: string; ad_id: string; day: string; impressions: number; synced_at: string }>();
    for (const row of rows) {
      const platform = source === "facebook" ? String(row['publisher_platform']) : SOURCE_PLATFORMS[source][0];
      if (!platform || !SOURCE_PLATFORMS[source].includes(platform as "facebook" | "instagram" | "linkedin" | "tiktok")) continue;
      const day = String(row['date'] ?? "").slice(0, 10), ad_id = String(row[idField] ?? ""), impressions = numberValue(row['impressions']);
      if (day < period.start || day > period.end) continue;
      if (!ad_id || impressions == null || impressions < 0) throw new Error("Données d'annonces incomplètes");
      const id = `${platform}:${ad_id}:${day}`;
      const old = deliveries.get(id);
      deliveries.set(id, { source, platform, ad_id, day, impressions: (old?.impressions ?? 0) + impressions, synced_at: now });
    }
    // Clear disappeared deliveries only after a successful provider response; preserve them on failure.
    for (let offset = 0; ; offset += 1000) {
      const old = await db.from("social_ad_daily").select("source,platform,ad_id,day").eq("source", source).gte("day", period.start).lte("day", period.end).order("platform").order("ad_id").order("day").range(offset, offset + 999);
      if (old.error) throw new Error("Lecture des annonces impossible");
      for (const row of old.data) {
        const id = `${row.platform}:${row.ad_id}:${row.day}`;
        if (!deliveries.has(id)) deliveries.set(id, { ...row, impressions: 0, synced_at: now });
      }
      if (old.data.length < 1000) break;
    }
    const values = [...deliveries.values()];
    for (let i = 0; i < values.length; i += 500) {
      const saved = await db.from("social_ad_daily").upsert(values.slice(i, i + 500));
      if (saved.error) throw new Error("Enregistrement des annonces impossible");
    }
    const coverage = Array.from({ length: dayNumber(period.end) - dayNumber(period.start) + 1 }, (_, i) => ({ source, day: isoFromDay(dayNumber(period.start) + i), synced_at: now }));
    const saved = await db.from("social_ad_coverage").upsert(coverage);
    if (saved.error) throw new Error("Enregistrement de la couverture impossible");
    return { success: true, source, days: coverage.length, deliveries: values.length };
  } catch (error) {
    return { success: false, source, message: error instanceof Error ? error.message : "Synchronisation des annonces interrompue" };
  }
}

export async function enqueueImport() {
  const today = parisDay(), end = isoFromDay(dayNumber(today) - 1);
  const ranges: (Period & { priority: number })[] = [{ ...lastDays(90, end), priority: 0 }, ...EDITIONS.filter((e) => e.end < today && e.end >= HISTORY_START).map((e) => ({ ...e, priority: 1 }))];
  for (let start = dayNumber(HISTORY_START); start <= dayNumber(end); start += 30) ranges.push({ start: isoFromDay(start), end: isoFromDay(Math.min(start + 29, dayNumber(end))), priority: 10 });
  const jobs = ranges.flatMap((range) => activeSources().map((source) => ({ source, date_from: range.start, date_to: range.end, priority: range.priority })));
  const result = await db.from("social_import_jobs").upsert(jobs, { onConflict: "source,date_from,date_to", ignoreDuplicates: true });
  if (result.error) throw new Error("Préparation de l’import impossible");
  return jobs.length;
}
export async function processImport(key: string) {
  const claim = await db.rpc("claim_social_import_job");
  const job = claim.data?.[0];
  // Aucune importation en attente : le passage (toutes les 3 minutes) relève les stories Instagram si le dernier relevé date de plus de 3 h.
  if (!job) return { done: true, stories: await syncStoriesWhenDue(key) };
  // Source retirée de la configuration depuis la mise en file : le job est clos sans appel à Windsor (aucun statut d'erreur durable).
  if (!(client.sources as string[]).includes(job.source)) {
    await db.from("social_import_jobs").update({ state: "done", finished_at: new Date().toISOString(), error_message: "Source désactivée" }).eq("id", job.id);
    return { done: false, skipped: true, source: job.source };
  }
  const result = await syncSource(job.source as WindsorSource, { start: job.date_from, end: job.date_to }, key);
  await db.from("social_import_jobs").update({ state: result.success ? "done" : "failed", finished_at: new Date().toISOString(), error_message: result.success ? null : result.message ?? "Synchronisation interrompue" }).eq("id", job.id);
  return { done: false, ...result };
}

export async function nightlySync(key: string, source?: WindsorSource) {
  const hour = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(new Date());
  if (hour !== "06") return { skipped: true };
  const end = isoFromDay(dayNumber(parisDay()) - 1);
  if (source) return syncSource(source, lastDays(7, end), key);
  const jobs = activeSources().map((source) => ({ source, date_from: lastDays(7, end).start, date_to: end, priority: -1 }));
  const result = await db.from("social_import_jobs").upsert(jobs, { onConflict: "source,date_from,date_to" });
  if (result.error) throw new Error("Préparation de la synchronisation impossible");
  return { enqueued: jobs.length };
}
/** Intervalle entre deux relevés de stories : une story vit 24 h, ses chiffres croissent jusqu'à l'expiration. */
const STORY_PULL_MS = 3 * 3_600_000;
/** Tant qu'aucun relevé réussi n'a eu lieu dans la journée (minuit passé, panne, connecteur muet), on réessaie plus souvent, sans jamais battre le rappel à chaque passage. */
const STORY_RETRY_MS = 30 * 60_000;
const STORY_MAX_GAP_MS = STORY_MAX_GAP_MINUTES * 60_000;
const STORY_PLATFORM = "instagram";
/** Tables optionnelles (migration 0013) : hors des types générés, comme social_ad_post_links. */
const optionalDb = () => db as unknown as SupabaseClient;

/** Jour de Paris (AAAA-MM-JJ) d'un instant donné. */
const parisDayOf = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));

/**
 * Relève les stories toutes les 3 h. Le rythme est plus serré (30 min) quand la continuité des relevés est en jeu : aucun relevé réussi aujourd'hui
 * (minuit passé, panne, connecteur muet : la veille devient « couverte » dès le premier relevé du jour), ou dernier essai raté alors que le dernier relevé
 * réussi date de moins de 6 h (un essai raté ne doit pas creuser un trou de plus de 6 h entre deux relevés). Sans les tables Stories (migration non passée) rien n'est tenté.
 */
export async function syncStoriesWhenDue(key: string) {
  // Les stories sont Instagram : sans source Instagram pour ce client, rien à relever.
  if (!client.sources.includes("instagram")) return { skipped: true, reason: "Instagram non configuré" };
  try {
    const table = optionalDb();
    const [attempt, pull] = await Promise.all([
      table.from("social_story_coverage").select("last_attempt_at").eq("platform", STORY_PLATFORM).not("last_attempt_at", "is", null).order("last_attempt_at", { ascending: false }).limit(1),
      table.from("social_story_coverage").select("last_pull_at").eq("platform", STORY_PLATFORM).not("last_pull_at", "is", null).order("last_pull_at", { ascending: false }).limit(1),
    ]);
    if (attempt.error || pull.error) return { skipped: true, reason: "tables Stories absentes" };
    const time = (value: unknown) => (value ? Date.parse(String(value)) : 0);
    const attemptAt = time(attempt.data?.[0]?.last_attempt_at), pullAt = time(pull.data?.[0]?.last_pull_at), now = Date.now();
    const pulledToday = pullAt > 0 && parisDayOf(pullAt) === parisDay();
    const failedSince = attemptAt > pullAt && now - pullAt < STORY_MAX_GAP_MS;
    if (now - attemptAt < (!pulledToday || failedSince ? STORY_RETRY_MS : STORY_PULL_MS)) return { skipped: true, reason: "relevé récent" };
    return await syncStories(key);
  } catch (error) {
    console.warn(`Stories : relevé impossible (${error instanceof Error ? error.message : "erreur"})`);
    return { skipped: true, reason: "erreur" };
  }
}

/**
 * Relevé des stories Instagram en vie (dernières 24 h) : les chiffres connus sont fusionnés avec ceux déjà gardés (jamais de baisse ni d'effacement),
 * puis le jour est compté comme relevé. L'essai est noté avant l'appel à Windsor (pas de rafale si Windsor échoue). Un relevé qui ne renvoie aucune story
 * n'est compté que si des stories ont déjà été vues ou importées (social_story_history) : sinon rien ne prouve que le compte en publie ni que le connecteur les fournit, et « 0 story » serait inventé.
 * Ne fait jamais échouer la synchronisation des comptes.
 */
export async function syncStories(key: string) {
  if (!client.sources.includes("instagram")) return { skipped: true, reason: "Instagram non configuré" };
  const table = optionalDb();
  const now = new Date().toISOString(), today = parisDay();
  try {
    const day = await table.from("social_story_coverage").select("pulls,max_gap_minutes").eq("platform", STORY_PLATFORM).eq("day", today).maybeSingle();
    if (day.error) throw new Error("Tables Stories absentes (migration 0013)");
    const pulls = Number(day.data?.pulls ?? 0);
    const attempt = await table.from("social_story_coverage").upsert({ platform: STORY_PLATFORM, day: today, pulls, last_attempt_at: now }, { onConflict: "platform,day" });
    if (attempt.error) throw new Error("Enregistrement de l’essai impossible");
    const range = lastDays(2, today);
    let rows: RawRow[];
    try { rows = await fetchRows("instagram", range, STORY_FIELDS.join(","), key); }
    catch { rows = await fetchRows("instagram", range, STORY_CORE_FIELDS.join(","), key); }
    const incoming = new Map<string, MappedStory>();
    for (const row of rows) { const story = mapStory(row); if (story) incoming.set(story.story_id, mergeStory(incoming.get(story.story_id), story)); }
    const ids = [...incoming.keys()];
    const known = new Map<string, Pick<MappedStory, "views" | "reach" | "replies" | "shares" | "interactions">>();
    for (let i = 0; i < ids.length; i += 150) {
      const old = await table.from("social_stories").select("story_id,views,reach,replies,shares,interactions").eq("platform", STORY_PLATFORM).in("story_id", ids.slice(i, i + 150));
      if (old.error) throw new Error("Lecture des stories impossible");
      for (const r of old.data ?? []) known.set(String(r.story_id), { views: numberValue(r.views), reach: numberValue(r.reach), replies: numberValue(r.replies), shares: numberValue(r.shares), interactions: numberValue(r.interactions) });
    }
    const values = ids.map((id) => ({ platform: STORY_PLATFORM, ...mergeStory(known.get(id), incoming.get(id)!), synced_at: now }));
    for (let i = 0; i < values.length; i += 200) {
      const saved = await table.from("social_stories").upsert(values.slice(i, i + 200), { onConflict: "platform,story_id" });
      if (saved.error) throw new Error("Enregistrement des stories impossible");
    }
    let proven = values.length > 0;
    if (!proven) {
      const any = await table.from("social_stories").select("story_id").eq("platform", STORY_PLATFORM).limit(1);
      if (any.error) throw new Error("Lecture des stories impossible");
      proven = (any.data?.length ?? 0) > 0;
    }
    if (!proven) {
      // Des stories importées des exports Meta prouvent que le compte en publie : une liste vide un jour calme est alors une vraie liste vide, et le suivi en direct
      // prolonge l'historique sans trou. Table optionnelle : une erreur de lecture n'est pas une preuve.
      const history = await table.from("social_story_history").select("story_id").eq("platform", STORY_PLATFORM).limit(1);
      proven = !history.error && (history.data?.length ?? 0) > 0;
    }
    if (!proven) {
      console.warn("Stories : aucune story renvoyée et aucune déjà vue ni importée, relevé non compté");
      return { success: true, stories: 0, counted: false };
    }
    // Intervalle depuis le relevé réussi précédent (même la veille) : il est gardé sur le jour courant, la couverture exige qu'il reste court.
    const previous = await table.from("social_story_coverage").select("last_pull_at").eq("platform", STORY_PLATFORM).not("last_pull_at", "is", null).order("last_pull_at", { ascending: false }).limit(1);
    if (previous.error) throw new Error("Lecture du relevé précédent impossible");
    const before = previous.data?.[0]?.last_pull_at ? Date.parse(String(previous.data[0].last_pull_at)) : null;
    const gap = before == null ? 0 : Math.max(0, Math.round((Date.parse(now) - before) / 60_000));
    const counted = await table.from("social_story_coverage").upsert({ platform: STORY_PLATFORM, day: today, pulls: pulls + 1, max_gap_minutes: Math.max(Number(day.data?.max_gap_minutes ?? 0), gap), last_pull_at: now, last_attempt_at: now }, { onConflict: "platform,day" });
    if (counted.error) throw new Error("Enregistrement du relevé impossible");
    return { success: true, stories: values.length, counted: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Relevé des stories interrompu";
    console.warn(`Stories : ${message}`);
    return { success: false, message };
  }
}

/** Sponsored post spend/impressions at ad × post × day grain, used only for per-post budget and CPM. */
export async function syncPostAds(source: WindsorSource, period: Period, key: string) {
  if (!paid(source)) return { success: false, message: "Source publicitaire requise" };
  try {
    const fields = source === "facebook" ? "date,account_id,ad_id,publisher_platform,effective_object_story_id,effective_instagram_media__id,source_instagram_media_id,spend,impressions" : source === "tiktok" ? "date,account_id,ad_id,item_id,spend,impressions" : "date,account_id,creative_id,share_id,spend,impressions";
    const rows = await fetchRows(source, period, fields, key);
    const now = new Date().toISOString();
    const out = new Map<string, { source: string; platform: string; ad_id: string; post_id: string; day: string; spend: number; impressions: number; synced_at: string }>();
    for (const row of rows) {
      const platform = source === "facebook" ? String(row['publisher_platform']) : SOURCE_PLATFORMS[source][0] ?? "";
      if (!SOURCE_PLATFORMS[source].includes(platform as "facebook")) continue;
      const day = String(row['date'] ?? "").slice(0, 10), ad_id = String(row[source === "linkedin" ? "creative_id" : "ad_id"] ?? ""), ref = postRefFromAd(source, platform, row), post_id = ref.post_id;
      if (!ad_id || !post_id || day < period.start || day > period.end) continue;
      // La ligne est rangée sous la plateforme de la publication (une annonce issue d'un post Instagram diffusée sur Facebook compte pour ce post).
      const id = `${ref.platform}:${ad_id}:${post_id}:${day}`, old = out.get(id);
      out.set(id, { source, platform: ref.platform, ad_id, post_id, day, spend: (old?.spend ?? 0) + (numberValue(row['spend']) ?? 0), impressions: (old?.impressions ?? 0) + (numberValue(row['impressions']) ?? 0), synced_at: now });
    }
    const values = [...out.values()];
    for (let i = 0; i < values.length; i += 500) {
      const saved = await db.from("social_post_ad_daily").upsert(values.slice(i, i + 500));
      if (saved.error) throw new Error("Enregistrement des publications sponsorisées impossible");
    }
    return { success: true, source, rows: values.length };
  } catch (error) {
    return { success: false, source, message: error instanceof Error ? error.message : "Synchronisation des publications sponsorisées interrompue" };
  }
}

/**
 * Current follower demographics. A dimension is replaced only when the provider returns rows, and the old rows are
 * removed only after the new ones are saved (upsert, then delete what the last pull no longer contains).
 * One failing dimension never fails the source sync; it is reported in `failed`.
 */
export async function syncAudience(source: WindsorSource, key: string) {
  const specs = AUDIENCE_SPECS[source];
  if (!specs) return { success: true, rows: 0, dimensions: [] as string[], failed: [] as string[] };
  const platform = SOURCE_PLATFORMS[source][0] ?? "";
  const now = new Date().toISOString(), today = parisDay();
  let total = 0;
  const dimensions: string[] = [], failed: string[] = [];
  for (const spec of specs) {
    try {
      // Les découpages datés (Facebook) se lisent sur les derniers jours complets ; les autres sur 7 jours.
      const range = spec.extra?.includes("date") ? lastDays(3, isoFromDay(dayNumber(today) - 1)) : lastDays(7, today);
      const values = audienceValues(spec, await fetchRows(source, range, audienceFields(spec), key));
      if (!values.size) continue;
      const saved = await db.from("social_audience").upsert([...values].map(([label, value]) => ({ platform, dimension: spec.dimension, label, value, unit: spec.unit, synced_at: now })), { onConflict: "platform,dimension,label" });
      if (saved.error) throw new Error("Enregistrement de l’audience impossible");
      const stale = await db.from("social_audience").delete().eq("platform", platform).eq("dimension", spec.dimension).lt("synced_at", now);
      if (stale.error) throw new Error("Nettoyage de l’audience impossible");
      // Historique : un instantané par jour pour suivre l'évolution (table optionnelle : une erreur ici n'empêche rien).
      await (db as unknown as SupabaseClient).from("social_audience_history").upsert([...values].map(([label, value]) => ({ snapshot_date: today, platform, dimension: spec.dimension, label, value, unit: spec.unit })), { onConflict: "snapshot_date,platform,dimension,label" });
      total += values.size;
      dimensions.push(spec.dimension);
    } catch (error) {
      failed.push(spec.dimension);
      console.warn(`Audience ${source}/${spec.dimension} non mise à jour : ${error instanceof Error ? error.message : "erreur"}`);
    }
  }
  return { success: failed.length === 0, rows: total, dimensions, failed };
}

/** Ad × day delivery with creative name/visual; unlinked ads become "Paid" rows in Top publications. */
export async function syncAdCreatives(source: WindsorSource, period: Period, key: string) {
  if (!paid(source)) return { success: false, message: "Source publicitaire requise" };
  try {
    const fields = source === "facebook"
      ? "date,account_id,ad_id,ad_name,thumbnail_url,publisher_platform,effective_object_story_id,effective_instagram_media__id,source_instagram_media_id,spend,impressions,actions_post_reaction,actions_comment,actions_post"
      : source === "tiktok" ? "date,account_id,ad_id,ad_name,item_id,spend,impressions,likes,comments,shares"
      : "date,account_id,creative_id,creative_thumbnail,share_id,spend,impressions,likes,comments,shares";
    const rows = await fetchRows(source, period, fields, key);
    const now = new Date().toISOString(), meta = source === "facebook";
    const out = new Map<string, { source: string; platform: string; ad_id: string; day: string; post_id: string | null; spend: number; impressions: number; likes: number | null; comments: number | null; shares: number | null; synced_at: string }>();
    const creatives = new Map<string, { platform: string; ad_id: string; ad_name: string | null; remote: string }>();
    const add = (a: number | null, b: number | null) => a == null && b == null ? null : (a ?? 0) + (b ?? 0);
    for (const row of rows) {
      const platform = meta ? String(row['publisher_platform']) : SOURCE_PLATFORMS[source][0] ?? "";
      if (!SOURCE_PLATFORMS[source].includes(platform as "facebook")) continue;
      const day = String(row['date'] ?? "").slice(0, 10), ad_id = String(row[source === "linkedin" ? "creative_id" : "ad_id"] ?? "");
      if (!ad_id || day < period.start || day > period.end) continue;
      const id = `${platform}:${ad_id}:${day}`, o = out.get(id);
      out.set(id, { source, platform, ad_id, day, post_id: postIdFromAd(source, platform, row) || o?.post_id || null,
        spend: (o?.spend ?? 0) + (numberValue(row['spend']) ?? 0), impressions: (o?.impressions ?? 0) + (numberValue(row['impressions']) ?? 0),
        likes: add(o?.likes ?? null, numberValue(row[meta ? 'actions_post_reaction' : 'likes'])), comments: add(o?.comments ?? null, numberValue(row[meta ? 'actions_comment' : 'comments'])), shares: add(o?.shares ?? null, numberValue(row[meta ? 'actions_post' : 'shares'])), synced_at: now });
      const ck = `${platform}:${ad_id}`;
      if (!creatives.has(ck)) creatives.set(ck, { platform, ad_id, ad_name: row['ad_name'] == null ? null : String(row['ad_name']), remote: String(row[meta ? 'thumbnail_url' : 'creative_thumbnail'] ?? "") });
    }
    const values = [...out.values()];
    for (let i = 0; i < values.length; i += 500) {
      const saved = await db.from("social_ad_creative_daily").upsert(values.slice(i, i + 500));
      if (saved.error) throw new Error("Enregistrement des publicités impossible");
    }
    for (const c of creatives.values()) {
      const old = await db.from("social_ad_creatives").select("thumbnail_path").eq("platform", c.platform).eq("ad_id", c.ad_id).maybeSingle();
      const path = old.data?.thumbnail_path ?? await storeImage(`ads/${c.platform}/${encodeURIComponent(c.ad_id)}.image`, c.remote);
      await db.from("social_ad_creatives").upsert({ platform: c.platform, ad_id: c.ad_id, ad_name: c.ad_name, thumbnail_path: path, synced_at: now });
    }
    return { success: true, source, rows: values.length, creatives: creatives.size };
  } catch (error) {
    return { success: false, source, message: error instanceof Error ? error.message : "Synchronisation des publicités interrompue" };
  }
}

async function storeImage(path: string, remote: string) {
  if (!remote) return null;
  let url: URL;
  try { url = new URL(remote); } catch { return null; }
  const allowed = ["fbcdn.net", "cdninstagram.com", "tiktokcdn.com", "tiktokcdn-us.com", "tiktokcdn-eu.com", "byteoversea.com", "licdn.com", "tiktok.com", "ibytedtos.com"];
  if (url.protocol !== "https:" || !allowed.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) return null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(12000), redirect: "manual" });
    const type = r.headers.get("content-type") ?? "";
    if (!r.ok || !type.startsWith("image/")) return null;
    const data = await r.arrayBuffer();
    if (data.byteLength > 10_000_000) return null;
    const saved = await db.storage.from(THUMBNAIL_BUCKET).upload(path, data, { contentType: type, upsert: true });
    return saved.error ? null : path;
  } catch { return null; }
}
