import { cardObjectId, changeObjectId, type CardPlacement } from './google-report';
import { REPORT_NETWORKS } from './report-tokens';
import { client } from './client';

/**
 * Cartes natives du modèle (formes et textes Google Slides au style des cartes du dashboard) : la sous-ligne « vs … (+x%) » de chaque
 * carte porte l'identifiant kpi_<réseau>_<chiffre>_vs et reçoit, au remplissage, la couleur verte ou rouge de la variation.
 * Un réseau n'est listé qu'une fois sa diapositive refaite avec ces cartes.
 */
const STANDARD_CARDS = ['publications', 'ads', 'impressions', 'impressionsPerPost', 'videoViews', 'interactions', 'clicks', 'engagementRate', 'spend', 'cpe', 'cpm'];
export const NATIVE_CARD_NETWORKS: Record<string, string[]> = {
  global: STANDARD_CARDS,
  linkedin: STANDARD_CARDS,
  facebook: STANDARD_CARDS,
  // Instagram : les quatre cartes Stories de sa diapositive « Stories ».
  instagram: [...STANDARD_CARDS, 'stories', 'storyViews', 'storyViewsPerStory', 'storyInteractions'],
  // TikTok : pas de clics sur les liens, et le CPV remplace le CPE.
  tiktok: ['publications', 'ads', 'impressions', 'impressionsPerPost', 'videoViews', 'interactions', 'engagementRate', 'spend', 'cpv', 'cpm'],
};

/** Zones d'écart seules (« +28% » entre deux colonnes), colorées en entier : diapositive YouTube (51), budget des campagnes Google Ads « YouTube ». */
export const CHANGE_CARD_NETWORKS: Record<string, string[]> = { youtube: ['spend'] };

/**
 * Cartes du client : ses réseaux (le Global seulement s'il affiche l'onglet Global) et la zone du budget YouTube seulement avec Google Ads. Sans ce tri, le modèle d'un client à un seul
 * réseau ne contient pas les identifiants des autres réseaux, et si la lecture du modèle échoue la coloration (un seul lot, atomique) serait refusée en entier.
 */
const clientCardNetworks = (): Record<string, string[]> =>
  Object.fromEntries(Object.entries(NATIVE_CARD_NETWORKS).filter(([prefix]) => (prefix === 'global' ? client.features.global : (REPORT_NETWORKS as readonly string[]).includes(prefix))));
const clientChangeCards = (): Record<string, string[]> => (client.features.googleAds ? CHANGE_CARD_NETWORKS : {});

export const nativeCardPlacements = (networks: Record<string, string[]> = clientCardNetworks(), changes: Record<string, string[]> = clientChangeCards()): CardPlacement[] => [
  ...Object.entries(networks).flatMap(([prefix, metrics]) => metrics.map((metric) => ({ objectId: cardObjectId(prefix, metric), prefix, metric }))),
  ...Object.entries(changes).flatMap(([prefix, metrics]) => metrics.map((metric) => ({ objectId: changeObjectId(prefix, metric), prefix, metric, whole: true }))),
];
