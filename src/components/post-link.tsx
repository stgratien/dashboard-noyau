import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Lien vers une publication. Sans URL, rien n'est cliquable : un simple texte, sans soulignement ni survol,
 * pour ne pas faire croire à un lien (une balise <a> sans href en garde l'apparence).
 */
export function PostLink({
  href,
  children,
  className,
  linkClassName,
  label,
  title,
}: {
  href?: string | null | undefined;
  children: ReactNode;
  className?: string | undefined;
  /** Classes ajoutées seulement quand le lien existe (survol, soulignement). */
  linkClassName?: string | undefined;
  /** Libellé d'accessibilité du lien, par exemple « Voir <titre> ». */
  label?: string | undefined;
  /** Texte complet au survol (titre tronqué à l'écran), avec ou sans lien. */
  title?: string | undefined;
}) {
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={title} className={cn(className, linkClassName)}>
        {children}
      </a>
    );
  }
  return (
    <span className={className} title={title}>
      {children}
    </span>
  );
}
