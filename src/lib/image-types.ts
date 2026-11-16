/** Types d'image acceptés pour les vignettes téléchargées chez les réseaux : jamais SVG (il peut contenir du script) ni un autre `image/*` imprévu. */
export const THUMBNAIL_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"] as const;

/** Le type de contenu (sans ses paramètres, en minuscules) s'il est autorisé, sinon `null`. */
const ALIASES: Record<string, string> = { "image/jpg": "image/jpeg", "image/pjpeg": "image/jpeg" };

export function allowedImageType(header: string | null | undefined): string | null {
  const raw = (header ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const type = ALIASES[raw] ?? raw;
  return (THUMBNAIL_IMAGE_TYPES as readonly string[]).includes(type) ? type : null;
}
