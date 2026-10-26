import { client } from "@/lib/client";

/**
 * Connexion Google du bouton « Générer un reporting » : valeurs publiques (identifiant client OAuth, clé d'API restreinte
 * aux domaines du tableau de bord, numéro du projet, modèle), jamais de secret. Elles viennent de la configuration du client
 * (src/client/config.ts) ; le bouton reste inactif tant que clientId et apiKey sont vides.
 */
export const GOOGLE_REPORT: { clientId: string; apiKey: string; appId: string; templateId: string } =
  client.report.google ?? { clientId: '', apiKey: '', appId: '', templateId: '' };

/** Accès par fichier : l'application ne voit que les fichiers qu'elle crée ou que la personne lui désigne dans le sélecteur. */
export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export const googleReportConfigured = () => GOOGLE_REPORT.clientId !== '' && GOOGLE_REPORT.apiKey !== '';
