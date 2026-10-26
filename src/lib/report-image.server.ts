import { supabaseAdmin as db } from '@/integrations/supabase/client.server';
import { THUMBNAIL_BUCKET } from './windsor-config';
import { REPORT_IMAGE_TTL_SECONDS, googleTokenAllowed } from './report-image-auth';

export { REPORT_IMAGE_MAX_BYTES, REPORT_IMAGE_TTL_SECONDS, googleTokenAllowed, isPng } from './report-image-auth';

/** Images du rapport : stockage temporaire (même seau privé que les vignettes), adresse signée de courte durée, jamais publique. */
const PREFIX = 'report-temp/';
const MAX_AGE_MS = 60 * 60 * 1000;
/** Le nettoyage n'a pas à tourner à chaque dépôt : une fois toutes les 5 minutes par instance suffit (les objets durent une heure). */
const SWEEP_EVERY_MS = 5 * 60 * 1000;
let lastSweepAt = 0;

/** Supprime les images temporaires de plus d'une heure (appelé depuis les dépôts : pas de tâche planifiée à prévoir). */
async function sweep(now = Date.now()) {
  const listed = await db.storage.from(THUMBNAIL_BUCKET).list(PREFIX.slice(0, -1), { limit: 200, sortBy: { column: 'created_at', order: 'asc' } });
  const old = (listed.data ?? []).filter((o) => o.created_at && now - Date.parse(o.created_at) > MAX_AGE_MS).map((o) => `${PREFIX}${o.name}`);
  if (old.length) await db.storage.from(THUMBNAIL_BUCKET).remove(old);
}

/**
 * `googleTokenAllowed` avec mémoire : un rapport dépose une soixantaine d'images, plusieurs à la fois, avec le même jeton ; sans mémoire chacune
 * interrogerait Google (et un refus de Google pour excès de requêtes deviendrait une image perdue). Seules les réponses positives sont gardées,
 * 2 minutes au plus ; deux dépôts simultanés partagent la même vérification. Les règles de `googleTokenAllowed` sont appliquées en entier à la première.
 */
const TOKEN_MEMO_MS = 2 * 60 * 1000;
const TOKEN_MEMO_MAX = 20;
const tokenMemo = new Map<string, { at: number; allowed: Promise<boolean> }>();
function sharedTokenCheck(token: string, clientId: string): Promise<boolean> {
  if (!token || !clientId) return Promise.resolve(false);
  const now = Date.now();
  const key = `${clientId}\n${token}`;
  const hit = tokenMemo.get(key);
  if (hit && now - hit.at < TOKEN_MEMO_MS) return hit.allowed;
  for (const [k, v] of tokenMemo) if (now - v.at >= TOKEN_MEMO_MS) tokenMemo.delete(k);
  while (tokenMemo.size >= TOKEN_MEMO_MAX) tokenMemo.delete(tokenMemo.keys().next().value as string);
  const allowed = googleTokenAllowed(token, clientId);
  tokenMemo.set(key, { at: now, allowed });
  // Un refus ou un échec n'est jamais gardé.
  void allowed.then((ok) => { if (!ok && tokenMemo.get(key)?.allowed === allowed) tokenMemo.delete(key); });
  return allowed;
}

/** Réponse de tokeninfo partagée entre les dépôts simultanés ; un refus, qui peut n'être qu'un incident passager de tokeninfo, est revérifié une fois par chaque dépôt. */
export async function googleTokenAllowedCached(token: string, clientId: string): Promise<boolean> {
  if (await sharedTokenCheck(token, clientId)) return true;
  return googleTokenAllowed(token, clientId);
}

/** `timings` : durées déjà mesurées par l'appelant (vérification du jeton), reprises dans la ligne de journal (durées seulement, jamais d'adresse ni de jeton). */
export async function storeReportImage(bytes: Uint8Array, timings: Record<string, number> = {}) {
  const began = Date.now();
  // Nettoyage espacé, lancé en même temps que le dépôt ; l'heure est notée avant d'attendre pour que les dépôts simultanés ne le relancent pas.
  const sweeping = began - lastSweepAt >= SWEEP_EVERY_MS;
  if (sweeping) lastSweepAt = began;
  const path = `${PREFIX}${crypto.randomUUID()}.png`;
  const [sweepMs, saved] = await Promise.all([
    sweeping ? sweep().then(() => Date.now() - began, () => -1) : Promise.resolve(null),
    db.storage.from(THUMBNAIL_BUCKET).upload(path, bytes, { contentType: 'image/png', upsert: false }).then((result) => ({ result, ms: Date.now() - began })),
  ]);
  if (saved.result.error) throw new Error('Dépôt de l’image impossible');
  const signBegan = Date.now();
  const signed = await db.storage.from(THUMBNAIL_BUCKET).createSignedUrl(path, REPORT_IMAGE_TTL_SECONDS);
  if (signed.error || !signed.data?.signedUrl) throw new Error('Adresse de l’image impossible');
  console.info('report-image: durées', { ...timings, sweepMs, uploadMs: saved.ms, signMs: Date.now() - signBegan, bytes: bytes.length });
  return signed.data.signedUrl;
}
