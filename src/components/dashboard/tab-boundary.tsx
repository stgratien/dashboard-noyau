import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

/**
 * Garde-fou des onglets chargés à la demande : si leur code ne se charge pas (nouvelle version publiée pendant que la page
 * était ouverte), le message reste dans l'onglet au lieu de remplacer toute la page ; un rechargement complet règle le cas.
 * `resetKey` (l'onglet courant) efface l'erreur quand l'utilisateur change d'onglet.
 */
export class TabBoundary extends Component<{ resetKey: string; children: ReactNode }, { failedKey: string | null }> {
  override state = { failedKey: null as string | null };
  static getDerivedStateFromError(): { failedKey: string | null } {
    return { failedKey: "failed" };
  }
  override componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failedKey) this.setState({ failedKey: null });
  }
  override render() {
    if (!this.state.failedKey) return this.props.children;
    return (
      <div className="space-y-3 rounded-lg border bg-card p-4 text-sm" role="alert">
        <p>Cet onglet n’a pas pu se charger : une nouvelle version du tableau de bord vient peut-être d’être publiée.</p>
        <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
          Recharger la page
        </Button>
      </div>
    );
  }
}
