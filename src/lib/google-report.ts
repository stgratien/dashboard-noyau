import { GOOGLE_REPORT, GOOGLE_SCOPE, googleReportConfigured } from './google-report-config';
import { nativeCardPlacements } from './report-cards';
import type { Period } from './dashboard-periods';
import { client } from './client';

/**
 * Génération du rapport Google Slides depuis le navigateur : connexion Google (accès par fichier uniquement), copie du modèle
 * dans le Drive de la personne, remplacement des marqueurs {{réseau.chiffre}} par les chiffres du tableau de bord.
 * Aucun secret ni jeton côté serveur : le jeton Google reste en mémoire dans l'onglet.
 */
export class ReportError extends Error {}

export type ReportStep = 'figures' | 'google' | 'template' | 'copy' | 'fill' | 'images' | 'check';
export type Leftover = { marker: string; slide: number };
export type ReportResult = { url: string; name: string; notes: string[]; imageNotes: string[]; leftovers: Leftover[]; missingFigures: string[]; checked: boolean };
/** Images capturées dans le tableau de bord : « réseau.bloc » → PNG (voir report-capture.tsx). */
export type CapturedReport = { images: Record<string, Blob>; failed: string[] };
/** `onImage` reçoit chaque PNG dès qu'il est prêt (les images partent vers Slides pendant que la capture continue) ; `signal` l'arrête au prochain bloc. */
export type CaptureHooks = { onImage?: (key: string, blob: Blob) => void; signal?: AbortSignal };
export type ReportRequest = {
  period: Period;
  comparison: { period: Period; label: string };
  onStep?: (step: ReportStep) => void;
  /** Capture les blocs du tableau de bord (graphiques, panneaux d'audience, cartes de publications) ; absent : le rapport n'a que les textes. */
  captureImages?: (hooks?: CaptureHooks) => Promise<CapturedReport>;
};

// ---- Parties pures (testées) ----

/** Une demande de remplacement par marqueur ; la mise en forme du texte remplacé est conservée par l'API. */
export const replaceRequests = (tokens: Record<string, string>) =>
  Object.entries(tokens).map(([key, value]) => ({ replaceAllText: { containsText: { text: `{{${key}}}`, matchCase: true }, replaceText: value } }));

type TextRuns = { textElements?: { textRun?: { content?: string } }[] };
type PageElement = {
  objectId?: string;
  shape?: { text?: TextRuns };
  table?: { tableRows?: { tableCells?: { text?: TextRuns }[] }[] };
  elementGroup?: { children?: PageElement[] };
};
const textOf = (text?: TextRuns) => (text?.textElements ?? []).map((e) => e.textRun?.content ?? '').join('');
function elementTexts(element: PageElement): string[] {
  return [
    textOf(element.shape?.text),
    ...(element.table?.tableRows ?? []).flatMap((row) => (row.tableCells ?? []).map((cell) => textOf(cell.text))),
    ...(element.elementGroup?.children ?? []).flatMap(elementTexts),
  ];
}
/** Marqueurs {{…}} encore présents dans une présentation (formes, cellules de tableau, groupes), avec le numéro de diapositive. */
export function leftoverMarkers(presentation: { slides?: { pageElements?: PageElement[] }[] }): Leftover[] {
  return (presentation.slides ?? []).flatMap((slide, index) =>
    (slide.pageElements ?? []).flatMap(elementTexts).flatMap((t) => [...t.matchAll(/\{\{([^}]*)\}\}/g)].map((m) => ({ marker: m[1]!, slide: index + 1 }))),
  );
}

/** Identifiants de tous les éléments d'une présentation (groupes compris). */
export function shapeIds(presentation: { slides?: { pageElements?: PageElement[] }[] }): Set<string> {
  const walk = (element: PageElement): string[] => [...(element.objectId ? [element.objectId] : []), ...(element.elementGroup?.children ?? []).flatMap(walk)];
  return new Set((presentation.slides ?? []).flatMap((slide) => (slide.pageElements ?? []).flatMap(walk)));
}

/** La présentation sans les éléments donnés (groupes compris) : l'état attendu après leur suppression, sans relire le fichier. */
export function withoutObjects<P extends { slides?: { pageElements?: PageElement[] }[] }>(presentation: P, ids: Iterable<string>): P {
  const dropped = new Set(ids);
  const keep = (elements: PageElement[]): PageElement[] =>
    elements
      .filter((element) => !(element.objectId && dropped.has(element.objectId)))
      .map((element) => (element.elementGroup?.children ? { ...element, elementGroup: { ...element.elementGroup, children: keep(element.elementGroup.children) } } : element));
  if (!presentation.slides) return presentation;
  return { ...presentation, slides: presentation.slides.map((slide) => (slide.pageElements ? { ...slide, pageElements: keep(slide.pageElements) } : slide)) };
}

/** Couleurs des variations, celles du tableau de bord : vert « success » et rouge « destructive ». */
const TONE_COLORS = { good: { red: 0.082, green: 0.502, blue: 0.239 }, bad: { red: 0.863, green: 0.149, blue: 0.149 } } as const;
/** `whole` : zone d'écart seule (« +28% » entre deux colonnes), colorée en entier ; sinon sous-ligne « vs … (+28%) », colorée à partir de la parenthèse. */
export type CardPlacement = { objectId: string; prefix: string; metric: string; whole?: boolean };
/** Identifiant de la sous-ligne « vs … (+x%) » d'une carte dans le modèle : kpi_<réseau>_<chiffre>_vs. */
export const cardObjectId = (prefix: string, metric: string) => `kpi_${prefix}_${metric}_vs`;
/** Identifiant de la zone d'écart seule d'une ligne (diapositive YouTube) : kpi_<réseau>_<chiffre>_change. */
export const changeObjectId = (prefix: string, metric: string) => `kpi_${prefix}_${metric}_change`;

/**
 * Colore la partie « (+28%) » de la sous-ligne de chaque carte (vert si bon, rouge sinon, rien si neutre), une fois les marqueurs
 * remplacés : le texte final de la sous-ligne est celui du marqueur « _vs », donc la position est connue.
 */
export function toneRequests(tokens: Record<string, string>, placements: CardPlacement[]) {
  return placements.flatMap(({ objectId, prefix, metric, whole }) => {
    const tone = tokens[`${prefix}.${metric}_tone`];
    if (whole) {
      if (!tokens[`${prefix}.${metric}_change`] || (tone !== 'good' && tone !== 'bad')) return [];
      return [{ updateTextStyle: { objectId, textRange: { type: 'ALL' }, style: { foregroundColor: { opaqueColor: { rgbColor: TONE_COLORS[tone] } }, bold: true }, fields: 'foregroundColor,bold' } }];
    }
    const vs = tokens[`${prefix}.${metric}_vs`];
    const open = vs?.indexOf('(') ?? -1;
    if (!vs || open < 0 || (tone !== 'good' && tone !== 'bad')) return [];
    return [{
      updateTextStyle: {
        objectId,
        textRange: { type: 'FIXED_RANGE', startIndex: open, endIndex: vs.length },
        style: { foregroundColor: { opaqueColor: { rgbColor: TONE_COLORS[tone] } }, bold: true },
        fields: 'foregroundColor,bold',
      },
    }];
  });
}

/** Emplacement d'une image dans le modèle : une forme dont le texte est « {{image.linkedin.formats}} ». */
export const imageTag = (key: string) => `{{image.${key}}}`;
/** Remplace chaque forme portant ce texte par l'image, contenue dans la forme (jamais déformée ni rognée). */
export const imageRequest = (url: string, key: string) => ({
  replaceAllShapesWithImage: { imageUrl: url, imageReplaceMethod: 'CENTER_INSIDE', containsText: { text: imageTag(key), matchCase: true } },
});
/** Formes de la présentation dont le texte est encore un emplacement d'image (pas d'image pour ce bloc) : à supprimer du rapport. */
export function imageTagShapes(presentation: { slides?: { pageElements?: (PageElement & { objectId?: string })[] }[] }): { objectId: string; tag: string }[] {
  const walk = (element: PageElement & { objectId?: string }): { objectId: string; tag: string }[] => {
    const text = textOf(element.shape?.text).trim();
    const own = element.objectId && /^\{\{image\.[^}]+\}\}$/.test(text) ? [{ objectId: element.objectId, tag: text }] : [];
    return [...own, ...(element.elementGroup?.children ?? []).flatMap(walk)];
  };
  return (presentation.slides ?? []).flatMap((slide) => (slide.pageElements ?? []).flatMap(walk));
}

/** Nombre de remplacements réellement faits, d'après la réponse de batchUpdate. Zéro = le fichier n'est pas un modèle balisé. */
export const countReplacements = (response: { replies?: { replaceAllText?: { occurrencesChanged?: number } }[] }) =>
  (response.replies ?? []).reduce((total, reply) => total + (reply.replaceAllText?.occurrencesChanged ?? 0), 0);

/** Masque de champs de la lecture de contrôle : le texte uniquement, groupes imbriqués sur trois niveaux. */
export function textFieldMask(depth = 3): string {
  const text = 'text(textElements(textRun(content)))';
  const base = `objectId,shape(${text}),table(tableRows(tableCells(${text})))`;
  let inner = base;
  for (let i = 0; i < depth; i++) inner = `${base},elementGroup(children(${inner}))`;
  return `slides(pageElements(${inner}))`;
}

/** « Bilan Social Media T1 2026 », « Bilan Social Media septembre 2026 » : le nom de la période choisie. */
export const reportFileName = (periodName: string) => `${client.report.fileNamePrefix} ${periodName}`.replace(/[\\/:*?"<>|]/g, '').slice(0, 100);

/** Longueur de la période en jours, bornes comprises (le point d'accès en refuse plus de 400). */
export const MAX_REPORT_DAYS = 400;
export const periodLength = (p: Period) => (Date.parse(`${p.end}T00:00:00Z`) - Date.parse(`${p.start}T00:00:00Z`)) / 86_400_000 + 1;

/** Limite de requêtes de Google (429, ou 403 avec l'une de ces raisons). */
export const isRateLimited = (status: number | undefined, reason: string | undefined) => status === 429 || reason === 'userRateLimitExceeded' || reason === 'rateLimitExceeded';

/** Message en français pour une erreur Google, d'après sa raison (Drive et Slides renvoient des textes anglais). */
export function describeGoogleError(status: number, reason: string | undefined, fallback: string) {
  if (reason === 'storageQuotaExceeded') return 'Votre Drive est plein : libérez de l’espace, puis réessayez.';
  if (isRateLimited(status, reason)) return 'Google limite temporairement les requêtes : réessayez dans une minute.';
  if (reason === 'domainPolicy') return 'L’administrateur de votre compte Google bloque l’accès à Drive pour cette application.';
  if (reason === 'insufficientFilePermissions') return 'Votre compte n’a pas le droit de copier ce modèle : demandez l’accès en lecture au propriétaire.';
  if (status === 401) return 'La connexion Google a expiré : cliquez de nouveau sur le bouton.';
  return fallback;
}

export function reportQuery(request: Pick<ReportRequest, 'period' | 'comparison'>) {
  const q = new URLSearchParams({
    start: request.period.start,
    end: request.period.end,
    compare_start: request.comparison.period.start,
    compare_end: request.comparison.period.end,
    compare_label: request.comparison.label,
  });
  return q.toString();
}

// ---- Navigateur ----

type Win = Window & { google?: any; gapi?: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const win = () => window as Win;
const scripts = new Map<string, Promise<void>>();
function loadScript(src: string) {
  let promise = scripts.get(src);
  if (!promise) {
    promise = new Promise<void>((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src; el.async = true;
      el.onload = () => resolve();
      el.onerror = () => { scripts.delete(src); reject(new ReportError('Impossible de charger les services Google (réseau ou bloqueur de contenu).')); };
      document.head.append(el);
    });
    scripts.set(src, promise);
  }
  return promise;
}
/** À appeler tôt (au survol, à l'affichage) : la fenêtre de connexion doit s'ouvrir dans le geste du clic, sans attendre un chargement. */
export const preloadGoogle = () => { void loadScript('https://accounts.google.com/gsi/client').catch(() => undefined); void loadScript('https://apis.google.com/js/api.js').catch(() => undefined); };

let cached: { token: string; expiresAt: number } | null = null;
/** Un jeton réutilisé doit encore valoir longtemps : la pose des images (capture, dépôts, Slides) dure plusieurs minutes. */
const TOKEN_MARGIN_MS = 15 * 60_000;
export function requestGoogleToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + TOKEN_MARGIN_MS) return Promise.resolve(cached.token);
  const start = () => new Promise<string>((resolve, reject) => {
    const client = win().google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_REPORT.clientId,
      scope: GOOGLE_SCOPE,
      callback: (r: { access_token?: string; expires_in?: number | string; error?: string }) => {
        if (!r.access_token) return reject(new ReportError(r.error === 'access_denied' ? 'Accès Google refusé.' : 'Connexion Google impossible.'));
        cached = { token: r.access_token, expiresAt: Date.now() + Number(r.expires_in ?? 3600) * 1000 };
        resolve(r.access_token);
      },
      error_callback: (e: { type?: string }) =>
        reject(new ReportError(e.type === 'popup_closed' ? 'Connexion Google annulée.' : e.type === 'popup_failed_to_open' ? 'Le navigateur a bloqué la fenêtre Google : autorise les fenêtres surgissantes pour ce site, puis réessaie.' : 'Connexion Google impossible.')),
    });
    client.requestAccessToken();
  });
  // Déjà chargé : la fenêtre s'ouvre dans le geste du clic. Sinon, on la demande dès que le script est prêt.
  return win().google?.accounts?.oauth2 ? start() : loadScript('https://accounts.google.com/gsi/client').then(start);
}

const TEMPLATE_KEY = client.report.templateStorageKey;
const readTemplate = () => { try { return localStorage.getItem(TEMPLATE_KEY); } catch { return null; } };
const saveTemplate = (id: string | null) => { try { id ? localStorage.setItem(TEMPLATE_KEY, id) : localStorage.removeItem(TEMPLATE_KEY); } catch { /* stockage indisponible : on redemandera */ } };
/** Oublie le modèle mémorisé : la prochaine génération rouvre le sélecteur de fichiers. */
export const forgetTemplate = () => saveTemplate(null);

/** Sélecteur de fichiers Google : donne à l'application l'accès au modèle choisi (et à lui seul). */
async function pickTemplate(token: string): Promise<string> {
  await loadScript('https://apis.google.com/js/api.js');
  const unavailable = () => new ReportError('Le sélecteur de fichiers Google n’a pas pu s’ouvrir (réseau ou bloqueur de contenu). Réessayez.');
  await new Promise<void>((resolve, reject) => win().gapi.load('picker', { callback: resolve, onerror: () => reject(unavailable()), timeout: 10_000, ontimeout: () => reject(unavailable()) }));
  const { picker } = win().google;
  const view = new picker.DocsView(picker.ViewId.PRESENTATIONS).setIncludeFolders(false);
  if (GOOGLE_REPORT.templateId) view.setFileIds(GOOGLE_REPORT.templateId);
  return new Promise<string>((resolve, reject) => {
    new picker.PickerBuilder()
      .setAppId(GOOGLE_REPORT.appId)
      .setOAuthToken(token)
      .setDeveloperKey(GOOGLE_REPORT.apiKey)
      .setLocale('fr')
      .setTitle('Choisir le modèle du rapport')
      .addView(view)
      .setCallback((data: { action: string; docs?: { id: string }[] }) => {
        if (data.action === picker.Action.PICKED && data.docs?.[0]) resolve(data.docs[0].id);
        else if (data.action === picker.Action.CANCEL) reject(new ReportError('Aucun modèle choisi.'));
        else if (data.action === picker.Action.ERROR) reject(unavailable());
      })
      .build()
      .setVisible(true);
  });
}

type GoogleError = ReportError & { status: number; reason?: string };
async function google<T>(token: string, url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init?.headers } });
  if (response.ok) return (await response.json()) as T;
  const body = (await response.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } };
  const reason = body.error?.errors?.[0]?.reason;
  const error = new ReportError(describeGoogleError(response.status, reason, `Google a répondu une erreur (${response.status}). Réessayez.`)) as GoogleError;
  error.status = response.status;
  if (reason) error.reason = reason;
  throw error;
}

async function copyTemplate(token: string, templateId: string, name: string) {
  return google<{ id: string; name: string }>(token, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(templateId)}/copy?supportsAllDrives=true&fields=id,name`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

/** Mesures de durée du rapport : console.info seulement (jamais affichées ni envoyées), durées et nombres, sans jeton, adresse ni chiffre. */
const now = () => { try { return performance.now(); } catch { return Date.now(); } };
type Timings = ReturnType<typeof createTimings>;
function createTimings() {
  const start = now();
  const ms: Record<string, number> = {};
  const chunks: { images: number; uploadMs: number; slidesMs: number }[] = [];
  return {
    /** Moment (en ms depuis le clic) où l'étape est atteinte. */
    mark: (name: string) => { ms[name] = Math.round(now() - start); },
    /** Durée écoulée depuis `began` (relevé avec now()). */
    span: (name: string, began: number) => { ms[name] = Math.round(now() - began); },
    /** Durée d'un appel, même quand il échoue. */
    time: async <T>(name: string, work: () => Promise<T>): Promise<T> => {
      const began = now();
      try { return await work(); } finally { ms[name] = Math.round(now() - began); }
    },
    chunk: (images: number, uploadMs: number, slidesMs: number) => { chunks.push({ images, uploadMs: Math.round(uploadMs), slidesMs: Math.round(slidesMs) }); },
    log: () => { try { console.info('[rapport] durées', { ...ms, chunks, total: Math.round(now() - start) }); } catch { /* journal indisponible */ } },
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Délais (ms) des reprises d'un dépôt qui échoue par le réseau ou par une erreur du serveur ; un refus (401, 413, 415) n'est jamais repris. */
const UPLOAD_RETRY_DELAYS = [400, 1200];

/** Dépose un PNG sur le serveur du tableau de bord (jeton Google en preuve) et rend son adresse signée, lisible par Google Slides. */
async function uploadImage(token: string, image: Blob): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    let response: Response | null = null;
    try {
      response = await fetch('/api/public/report-image', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' }, body: image });
    } catch { /* réseau coupé : repris ci-dessous */ }
    const delay = UPLOAD_RETRY_DELAYS[attempt];
    if (delay !== undefined && (!response || response.status >= 500)) { await sleep(delay); continue; }
    if (!response) throw new ReportError('dépôt impossible (réseau)');
    if (!response.ok) throw new ReportError(response.status === 413 ? 'image trop lourde' : response.status === 401 ? 'dépôt refusé' : `dépôt impossible (${response.status})`);
    const body = (await response.json()) as { url?: string };
    if (!body.url) throw new ReportError('adresse manquante');
    return body.url;
  }
}

/** Images par requête Slides (batchUpdate) ; 1 = une requête par image, comme à l'origine. */
const IMAGE_CHUNK = 8;
/** Dépôts simultanés d'un lot (le navigateur ouvre au plus 6 connexions par serveur). */
const UPLOAD_CONCURRENCY = 4;
type SlidesReply = { replies?: { replaceAllShapesWithImage?: { occurrencesChanged?: number } }[] };
const slidesWrite = (token: string, presentationId: string, requests: unknown[]) =>
  google<SlidesReply>(token, `https://slides.googleapis.com/v1/presentations/${presentationId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) });

/**
 * Pose les images dans les emplacements du modèle pendant que la capture continue. Les PNG reçus attendent (rien ne part avant `release()`, une fois le
 * texte rempli et coloré), puis partent par lots de IMAGE_CHUNK : dépôts en parallèle, puis UNE requête Slides par lot, jamais deux écritures à la fois sur
 * le fichier. L'adresse signée (15 minutes) est donc utilisée quelques secondes après sa création. batchUpdate est atomique : un lot refusé est rejoué image
 * par image, ce qui redonne le résultat d'origine (une adresse que Google ne peut pas lire n'annule ni les autres images ni les textes déjà remplis).
 * `failed` : images non posées ; `missing` : images dont l'emplacement n'existe pas dans le modèle choisi ; `total` : images reçues.
 */
function createImagePipeline(token: string, presentationId: string, timings: Timings) {
  const order = new Map<string, number>();
  const queue: [string, Blob][] = [];
  const failed: string[] = [];
  const missing: string[] = [];
  let released = false;
  let ended = false;
  let cancelled = false;
  let writer: Promise<void> | null = null;
  const due = () => !cancelled && released && queue.length > 0 && (queue.length >= IMAGE_CHUNK || ended);

  /** Une image seule, avec la requête d'origine. `unsure` : le lot a pu être appliqué avant l'erreur, un 0 remplacement ne prouve donc pas un emplacement absent. */
  const placeOne = async ({ key, url }: { key: string; url: string }, unsure: boolean) => {
    try {
      const reply = await slidesWrite(token, presentationId, [imageRequest(url, key)]);
      if (!reply.replies?.[0]?.replaceAllShapesWithImage?.occurrencesChanged && !unsure) missing.push(key);
    } catch {
      failed.push(key);
    }
  };
  const place = async (items: { key: string; url: string }[]) => {
    for (let attempt = 0; ; attempt++) {
      try {
        const reply = await slidesWrite(token, presentationId, items.map(({ key, url }) => imageRequest(url, key)));
        // Les réponses suivent l'ordre des requêtes. Un emplacement absent n'est pas une erreur pour Google (0 remplacement) : on le relève ici.
        items.forEach(({ key }, i) => { if (!reply.replies?.[i]?.replaceAllShapesWithImage?.occurrencesChanged) missing.push(key); });
        return;
      } catch (error) {
        const { status, reason } = error as { status?: number; reason?: string };
        if (isRateLimited(status, reason)) {
          // Limite de requêtes : une seule reprise après une pause, puis les images du lot sont déclarées non posées.
          if (attempt === 0) { await sleep(10_000 + Math.random() * 2_000); continue; }
        } else if (items.length > 1 && status !== 401 && status !== 403) {
          // Autre refus : le lot est atomique (rien d'appliqué), on le rejoue image par image. Réseau coupé ou erreur 5xx : il a pu être appliqué.
          for (const item of items) await placeOne(item, status === undefined || status >= 500);
          return;
        }
        failed.push(...items.map(({ key }) => key));
        return;
      }
    }
  };
  const handle = async (chunk: [string, Blob][]) => {
    try {
      const uploadBegan = now();
      const urls: (string | null)[] = chunk.map(() => null);
      let next = 0;
      const worker = async () => {
        while (next < chunk.length) {
          const i = next++;
          const [key, blob] = chunk[i]!;
          try { urls[i] = await uploadImage(token, blob); } catch { failed.push(key); }
        }
      };
      await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, chunk.length) }, worker));
      const uploaded = chunk.flatMap(([key], i) => { const url = urls[i]; return url ? [{ key, url }] : []; });
      const slidesBegan = now();
      if (uploaded.length && !cancelled) await place(uploaded);
      timings.chunk(chunk.length, slidesBegan - uploadBegan, now() - slidesBegan);
    } catch {
      // Jamais d'exception vers l'appelant : les images du lot sans résultat sont déclarées non posées.
      for (const [key] of chunk) if (!failed.includes(key) && !missing.includes(key)) failed.push(key);
    }
  };
  const run = async () => {
    while (due()) await handle(queue.splice(0, IMAGE_CHUNK));
    writer = null;
  };
  const kick = () => { if (!writer && due()) writer = run(); };

  return {
    add: (key: string, blob: Blob) => {
      if (cancelled || order.has(key)) return;
      order.set(key, order.size);
      queue.push([key, blob]);
      kick();
    },
    /** Le texte est rempli et coloré : les images reçues peuvent partir. */
    release: () => { released = true; kick(); },
    /** Plus rien ne part (échec du rapport) : les images en attente sont abandonnées. */
    cancel: () => { cancelled = true; queue.length = 0; },
    /** Capture terminée : pose aussi les images reçues autrement que par `add`, vide la file, puis rend le bilan (dans l'ordre de capture). */
    finish: async (images: Record<string, Blob>) => {
      for (const [key, blob] of Object.entries(images)) if (!order.has(key)) { order.set(key, order.size); queue.push([key, blob]); }
      released = true;
      ended = true;
      kick();
      while (writer) await writer;
      const byOrder = (a: string, b: string) => (order.get(a) ?? 0) - (order.get(b) ?? 0);
      return { failed: [...failed].sort(byOrder), missing: [...missing].sort(byOrder), total: order.size };
    },
  };
}

/** La capture tourne pendant le remplissage : son échec ne doit pas faire échouer le rapport (null, signalé plus bas). */
async function startCapture(capture: NonNullable<ReportRequest['captureImages']>, hooks: CaptureHooks): Promise<CapturedReport | null> {
  try { return await capture(hooks); } catch { return null; }
}

/**
 * Supprime les emplacements d'images restés vides (bloc sans donnée, image en échec) : ils ne doivent pas apparaître dans le rapport.
 * Rend aussi la présentation lue et les identifiants supprimés : l'état final s'en déduit sans relire le fichier (échec de lecture ou de suppression : exception).
 */
async function removeEmptyImageSlots(token: string, presentationId: string, timings: Timings) {
  const deck = await timings.time('slotsRead', () => google<Parameters<typeof leftoverMarkers>[0]>(token, `https://slides.googleapis.com/v1/presentations/${presentationId}?fields=${encodeURIComponent(textFieldMask())}`));
  const slots = imageTagShapes(deck);
  if (slots.length)
    await timings.time('slotsDelete', () => google(token, `https://slides.googleapis.com/v1/presentations/${presentationId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: slots.map((slot) => ({ deleteObject: { objectId: slot.objectId } })) }) }));
  return { tags: slots.map((slot) => slot.tag), deck, ids: slots.map((slot) => slot.objectId) };
}

async function fetchFigures(request: ReportRequest) {
  const response = await fetch(`/api/public/report-data?${reportQuery(request)}`, { cache: 'no-store' });
  if (response.status === 400) {
    const body = (await response.json().catch(() => ({}))) as { issues?: string[] };
    throw new ReportError(`Période refusée par le tableau de bord : ${body.issues?.[0] ?? 'dates invalides'}.`);
  }
  if (!response.ok) throw new ReportError('Le tableau de bord n’a pas pu calculer les chiffres du rapport. Réessayez dans une minute.');
  return (await response.json()) as { tokens: Record<string, string>; notes: string[] };
}

/** À appeler directement dans le gestionnaire du clic (la fenêtre de connexion Google dépend du geste de la personne). */
export async function generateSlidesReport(request: ReportRequest): Promise<ReportResult> {
  const timings = createTimings();
  try {
    // buildSlidesReport s'exécute de façon synchrone jusqu'à la demande de jeton : la fenêtre Google s'ouvre toujours dans le geste du clic.
    return await buildSlidesReport(request, timings);
  } finally {
    timings.log();
  }
}

async function buildSlidesReport(request: ReportRequest, timings: Timings): Promise<ReportResult> {
  if (!googleReportConfigured()) throw new ReportError('La connexion Google du tableau de bord n’est pas encore configurée.');
  const step = request.onStep ?? (() => undefined);
  // Contrôles locaux avant d'ouvrir la fenêtre Google : une période trop longue ne se règle pas en réessayant.
  if (periodLength(request.period) > MAX_REPORT_DAYS || periodLength(request.comparison.period) > MAX_REPORT_DAYS)
    throw new ReportError(`La période (ou la période comparée) dépasse ${MAX_REPORT_DAYS} jours : choisissez une période plus courte.`);
  const tokenPromise = requestGoogleToken();
  tokenPromise.then(() => timings.mark('token')).catch(() => undefined);
  step('figures');
  const figures = await timings.time('figures', () => fetchFigures(request));
  step('google');
  const token = await tokenPromise;
  const name = reportFileName(figures.tokens['trimestre'] ?? 'reporting');
  step('copy');
  // La durée « copy » comprend le sélecteur de fichiers quand le modèle n'est pas encore mémorisé (une seule fois).
  const copyBegan = now();
  let templateId = readTemplate() ?? GOOGLE_REPORT.templateId;
  let copy: { id: string; name: string };
  try {
    copy = await copyTemplate(token, templateId, name);
  } catch (error) {
    // 404 (ou 403 « appNotAuthorizedToFile ») : l'application n'a pas encore accès à ce fichier. On le fait choisir une fois, puis on réessaie.
    // Les autres refus (Drive plein, limite de requêtes, règle de l'administrateur) sont affichés tels quels.
    const { status, reason } = error as { status?: number; reason?: string };
    if (status !== 404 && !(status === 403 && reason === 'appNotAuthorizedToFile')) throw error;
    step('template');
    templateId = await pickTemplate(token);
    saveTemplate(templateId);
    step('copy');
    copy = await copyTemplate(token, templateId, name);
  }
  timings.span('copy', copyBegan);
  // Une génération qui échoue ne laisse pas de copie à moitié remplie dans le Drive.
  const discard = () => fetch(`https://www.googleapis.com/drive/v3/files/${copy.id}?supportsAllDrives=true`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
  // La capture des images ne dépend que des données de la page : elle démarre dès que la copie existe (modèle connu et accessible), tourne pendant le
  // remplissage, et chaque PNG part vers Slides par lots dès que le texte est rempli (createImagePipeline).
  const abort = new AbortController();
  const pipeline = request.captureImages ? createImagePipeline(token, copy.id, timings) : null;
  const capturing = pipeline && request.captureImages ? startCapture(request.captureImages, { onImage: pipeline.add, signal: abort.signal }) : null;
  try {
    step('fill');
    const requests = replaceRequests(figures.tokens);
    // Identifiants des cartes à colorer : replaceAllText n'ajoute ni ne retire aucune forme, la lecture se fait donc pendant le remplissage.
    const cardIds = timings
      .time('read', () => google<Parameters<typeof shapeIds>[0]>(token, `https://slides.googleapis.com/v1/presentations/${copy.id}?fields=${encodeURIComponent(textFieldMask())}`))
      .then((deck) => shapeIds(deck), () => null);
    let filled: Parameters<typeof countReplacements>[0];
    try {
      filled = await timings.time('fill', () => google<Parameters<typeof countReplacements>[0]>(token, `https://slides.googleapis.com/v1/presentations/${copy.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) }));
    } catch (error) {
      await discard();
      throw error;
    }
    if (countReplacements(filled) === 0) {
      // Ni marqueur ni chiffre remplacé : le fichier choisi n'est pas le modèle balisé. On ne laisse pas une copie inchangée dans le Drive.
      await discard();
      forgetTemplate();
      throw new ReportError(`Ce modèle ne contient aucun marqueur {{…}} : ce n’est pas le modèle balisé du tableau de bord. La copie a été supprimée ; au prochain essai, choisis « ${client.report.templateName} ».`);
    }
    // Couleurs des variations des cartes natives : un échec n'empêche pas le rapport, il est signalé.
    const notes = [...figures.notes];
    // Seules les cartes présentes dans la copie sont colorées : une carte absente (modèle plus ancien que le code, ou l'inverse) ferait refuser tout le lot.
    let placements = nativeCardPlacements();
    const present = await cardIds; // null : lecture impossible, on tente toutes les cartes, l'échec éventuel est signalé ci-dessous
    if (present) placements = placements.filter((p) => present.has(p.objectId));
    const tone = toneRequests(figures.tokens, placements);
    if (tone.length) {
      try {
        await timings.time('tone', () => google(token, `https://slides.googleapis.com/v1/presentations/${copy.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: tone }) }));
      } catch {
        notes.push('Les couleurs vert et rouge des variations n’ont pas pu être appliquées aux cartes.');
      }
    }
    // Le texte est rempli et coloré : les images déjà capturées peuvent partir.
    pipeline?.release();
    const imageNotes: string[] = [];
    // Présentation lue pour les emplacements vides, moins ces emplacements : le contrôle final s'en déduit sans relire le fichier.
    let deckAfterSlots: Parameters<typeof leftoverMarkers>[0] | null = null;
    if (pipeline && capturing) {
      step('images');
      const imagesBegan = now();
      const label = (keys: string[]) => keys.map((key) => key.replace('.', ' · ')).join(', ');
      const captured = await capturing;
      if (!captured) imageNotes.push('Les images du dashboard n’ont pas pu être préparées : le rapport ne contient que les textes et les cartes.');
      // Les images reçues pendant la capture sont déjà parties ; celles qui restent (dernier lot) sont posées ici.
      const placed = await pipeline.finish(captured?.images ?? {});
      timings.span('images', imagesBegan);
      const failed = [...(captured?.failed ?? []), ...placed.failed];
      if (placed.total && placed.missing.length === placed.total)
        imageNotes.push(`Le modèle choisi ne contient pas les emplacements d’image du tableau de bord : choisissez la dernière version de « ${client.report.templateName} ».`);
      else if (placed.missing.length) imageNotes.push(`Emplacements d’image absents du modèle : ${label(placed.missing)}.`);
      if (failed.length) imageNotes.push(`Images du dashboard non posées : ${label(failed)}.`);
      // Les emplacements restés vides sont retirés, même quand la capture ou une image a échoué.
      try {
        const empty = await removeEmptyImageSlots(token, copy.id, timings);
        deckAfterSlots = withoutObjects(empty.deck, empty.ids);
        if (empty.tags.length && !failed.length && captured) imageNotes.push(`${empty.tags.length} emplacement${empty.tags.length > 1 ? 's' : ''} d’image sans donnée (retiré${empty.tags.length > 1 ? 's' : ''} du rapport).`);
      } catch {
        imageNotes.push('Les emplacements d’image restés vides n’ont pas pu être retirés : supprimez à la main les rectangles « {{image… }} ».');
      }
    }
    step('check');
    // Le rapport est déjà rempli : si le contrôle des marqueurs restants échoue, on le dit sans perdre le rapport.
    let leftovers: Leftover[] = [];
    let checked = true;
    if (deckAfterSlots) {
      // Entre cette lecture et la fin, seule la suppression des emplacements vides a modifié le fichier : l'état final en est déduit exactement.
      leftovers = leftoverMarkers(deckAfterSlots);
    } else {
      try {
        const after = await timings.time('finalRead', () => google<Parameters<typeof leftoverMarkers>[0]>(token, `https://slides.googleapis.com/v1/presentations/${copy.id}?fields=${encodeURIComponent(textFieldMask())}`));
        leftovers = leftoverMarkers(after);
      } catch {
        checked = false;
      }
    }
    return { url: `https://docs.google.com/presentation/d/${copy.id}/edit`, name: copy.name, notes, imageNotes, leftovers, checked, missingFigures: Object.entries(figures.tokens).filter(([k, v]) => v === 'n.d.' && !k.endsWith('_prev')).map(([k]) => k) };
  } finally {
    // Échec du rapport (copie supprimée, jeton refusé…) : la capture s'arrête au prochain bloc et plus aucune image ne part. Sans effet après une réussite.
    abort.abort();
    pipeline?.cancel();
  }
}
