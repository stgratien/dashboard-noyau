/** Domaines autorisés pour les liens de publications, par réseau (sous-domaines compris). */
const DOMAINS: Record<string, string[]> = {
  facebook: ['facebook.com', 'fb.com'],
  instagram: ['instagram.com'],
  linkedin: ['linkedin.com', 'lnkd.in'],
  tiktok: ['tiktok.com'],
};

/**
 * Lien de publication sûr : https uniquement, domaine du réseau, sinon chaîne vide (pas de lien).
 * TikTok : les paramètres utm_* ajoutés par l'API sont retirés. Ne lève jamais d'exception.
 */
export function safePostUrl(platform: string, raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const text = raw.trim();
  if (!text) return '';
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:') return '';
  const host = url.hostname.toLowerCase();
  const allowed = DOMAINS[platform] ?? [];
  if (!allowed.some((domain) => host === domain || host.endsWith(`.${domain}`))) return '';
  if (platform === 'tiktok') {
    for (const key of [...url.searchParams.keys()]) if (key.startsWith('utm_')) url.searchParams.delete(key);
  }
  return url.toString();
}

/** Lien d'une publication Facebook depuis son identifiant « page_publication » (forme : <identifiant de la Page>_<identifiant de la publication>). */
export function facebookPostUrl(storyId: string | null | undefined): string {
  const match = /^(\d+)_(\d+)$/.exec((storyId ?? '').trim());
  return match ? `https://www.facebook.com/${match[1]}/posts/${match[2]}` : '';
}
