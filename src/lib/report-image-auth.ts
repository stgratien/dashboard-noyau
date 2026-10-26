/** Contrôles purs du dépôt d'images du rapport (sans accès à la base) : taille, PNG, jeton Google. */
export const REPORT_IMAGE_TTL_SECONDS = 900;
export const REPORT_IMAGE_MAX_BYTES = 6 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export const isPng = (bytes: Uint8Array) => bytes.length > PNG_SIGNATURE.length && PNG_SIGNATURE.every((b, i) => bytes[i] === b);

/**
 * Le jeton Google envoyé par le navigateur doit avoir été délivré à l'identifiant client OAuth du tableau de bord avec l'accès par fichier :
 * seules les personnes passées par la connexion du bouton (utilisateurs de test) peuvent déposer une image.
 */
export async function googleTokenAllowed(token: string, clientId: string, fetcher: typeof fetch = fetch) {
  if (!token || !clientId) return false;
  try {
    const response = await fetcher(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);
    if (!response.ok) return false;
    const info = (await response.json()) as { aud?: string; azp?: string; scope?: string; expires_in?: string | number };
    return (info.aud === clientId || info.azp === clientId) && (info.scope ?? '').split(' ').includes('https://www.googleapis.com/auth/drive.file') && Number(info.expires_in ?? 0) > 0;
  } catch {
    return false;
  }
}
