/**
 * En-têtes de sécurité ajoutés à chaque réponse du serveur (src/server.ts). Le tableau de bord n'a pas à être indexé, ni affiché dans le cadre d'un autre site, ni à demander la caméra,
 * le micro ou la position. Pas de Content-Security-Policy de scripts ici : le site charge Google (connexion, sélecteur de fichiers, polices) et un jeu de règles trop strict le casserait ;
 * `frame-ancestors` seul bloque l'affichage dans un cadre, sauf pour l'éditeur et l'aperçu de l'hébergeur.
 */
export const FRAME_ANCESTORS = "frame-ancestors 'self' https://*.lovable.app https://*.lovable.dev https://*.lovableproject.com https://*.lovable.com";

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  "Content-Security-Policy": FRAME_ANCESTORS,
};

/** La réponse avec les en-têtes ci-dessus (ceux déjà posés par l'application gardent leur valeur). Ne lève jamais : une réponse aux en-têtes figés est recopiée. */
export function withSecurityHeaders(response: Response): Response {
  const apply = (headers: Headers) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) if (!headers.has(name)) headers.set(name, value);
  };
  try {
    apply(response.headers);
    return response;
  } catch {
    const copy = new Response(response.body, { status: response.status, statusText: response.statusText, headers: new Headers(response.headers) });
    apply(copy.headers);
    return copy;
  }
}
