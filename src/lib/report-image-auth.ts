/** Contrôles purs du dépôt d'images du rapport (sans accès à la base) : taille, PNG, jeton Google. */
export const REPORT_IMAGE_TTL_SECONDS = 900;
export const REPORT_IMAGE_MAX_BYTES = 6 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Forme d'un jeton d'accès OAuth de Google (« ya29. » puis des caractères d'URL) : 2 500 caractères au plus. */
const GOOGLE_ACCESS_TOKEN = /^ya29\.[A-Za-z0-9._~+/=-]{10,2500}$/;

export const isPng = (bytes: Uint8Array) => bytes.length > PNG_SIGNATURE.length && PNG_SIGNATURE.every((b, i) => bytes[i] === b);

/**
 * Le jeton Google envoyé par le navigateur doit avoir été délivré à l'identifiant client OAuth du tableau de bord avec l'accès par fichier :
 * seules les personnes passées par la connexion du bouton (utilisateurs de test) peuvent déposer une image.
 */
export async function googleTokenAllowed(token: string, clientId: string, fetcher: typeof fetch = fetch) {
  if (!token || !clientId) return false;
  // Une forme qui n'est pas celle d'un jeton d'accès Google est refusée sans appeler Google (un inconnu ne fait pas travailler tokeninfo).
  if (!GOOGLE_ACCESS_TOKEN.test(token)) return false;
  try {
    // Le jeton voyage dans le corps de la requête, jamais dans une adresse (que des journaux pourraient garder).
    const response = await fetcher('https://oauth2.googleapis.com/tokeninfo', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ access_token: token }),
    });
    if (!response.ok) return false;
    const info = (await response.json()) as { aud?: string; azp?: string; scope?: string; expires_in?: string | number };
    return (info.aud === clientId || info.azp === clientId) && (info.scope ?? '').split(' ').includes('https://www.googleapis.com/auth/drive.file') && Number(info.expires_in ?? 0) > 0;
  } catch {
    return false;
  }
}
