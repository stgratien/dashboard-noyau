import { cn } from "@/lib/utils";
import { client } from "@/lib/client";

/**
 * Pied de page de toutes les pages : « Fait avec ♥️ par <signature du client> » (client.brand.footerCredit ; sans signature : « Fait avec ♥️ »).
 * Sur l'onglet Global, le cœur est le lien qui génère le reporting (`onGenerate`) ; ailleurs c'est un simple emoji.
 */
export function DashboardFooter({ onGenerate, generating = false, className }: { onGenerate?: (() => void) | undefined; generating?: boolean; className?: string }) {
  return (
    <footer data-export-hide className={cn("px-6 py-8 text-center text-xs text-muted-foreground", className)}>
      Fait avec{" "}
      {onGenerate ? (
        <button
          type="button"
          onClick={onGenerate}
          disabled={generating}
          aria-label="Générer un reporting"
          className={cn("cursor-pointer rounded-sm align-baseline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", generating && "animate-pulse cursor-wait")}
        >
          ♥️
        </button>
      ) : (
        <span aria-hidden="true">♥️</span>
      )}
      {client.brand.footerCredit ? ` par ${client.brand.footerCredit}` : null}
    </footer>
  );
}
