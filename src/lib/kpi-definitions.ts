import type { PlatformId } from './dashboard-data';
import { client } from './client';

/** Single source of truth for every KPI card and chart info tooltip. */
const BLENDED = 'Organique + payant (blended).';
const SOURCE = 'Source : Windsor.ai.';
const notes = client.kpiNotes;
/** Phrase propre à l'historique du client (voir kpiNotes) : absente par défaut. */
const HISTORY = notes.history ?? '';
const sentence = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');
const INSTAGRAM_TOTAL = 'Instagram : total du compte Windsor, payant compris (les impressions Meta Ads ne sont jamais ajoutées).';
const INSTAGRAM_INTERACTIONS = notes.instagramInteractions ?? 'Instagram : total du compte Windsor, payant compris. Les j’aime, commentaires et partages Meta Ads ne sont ajoutés que sur les jours repris d’un historique importé.';
const INSTAGRAM_VIDEO = 'Instagram : vues cumulées des reels et vidéos publiés sur la période, comptées à leur date de publication.';
const TIKTOK_COHORT ='TikTok organique : vues et interactions des vidéos publiées sur la période (cumul à date).';
const GA = 'Source : script Google Ads exécuté chaque nuit dans le compte (sans Windsor).';
const PAID_ONLY = 'Payant uniquement (connecteurs Ads).';
const STORIES = notes.stories ?? 'Stories Instagram, comptées à leur jour de publication (Paris). Instagram ne fournissant les chiffres d’une story que pendant ses 24 h de vie, elles sont relevées toutes les 3 h depuis la mise en service du suivi ; sans relevé, la période est « non disponible ». Une période couverte en partie est marquée « partiel » et sa variation n’est pas affichée. Source : Windsor.ai.';

export type KpiKey =
  | 'followers' | 'newFollowers' | 'posts' | 'adsDelivered' | 'impressions' | 'impressionsPerPost' | 'videoViews'
  | 'interactions' | 'clicks' | 'engagementRate' | 'spend' | 'cpm' | 'cpc' | 'cpe' | 'cpv'
  | 'stories' | 'storyViews' | 'storyViewsPerStory' | 'storyInteractions'
  | 'videosPublished' | 'chartFormats' | 'chartAudience' | 'chartInteractions' | 'topPosts' | 'topVisibility' | 'topEngagement' | 'topCpm' | 'flopVisibility' | 'flopEngagement'
  | 'audienceGender' | 'audienceAge' | 'audienceCountry' | 'audienceCity' | 'audienceIndustry' | 'audienceFunction' | 'audienceSeniority'
  | 'gaSpend' | 'gaImpressions' | 'gaClicks' | 'gaCtr' | 'gaCpc' | 'gaCpm' | 'gaConversions' | 'gaCostPerConversion' | 'gaVideoViews' | 'gaChart' | 'gaChannels' | 'gaCampaigns'
  | 'webSessions' | 'webUsers' | 'webPageviews' | 'webDuration' | 'webBounce' | 'webChart';

export function definition(key: KpiKey, p?: PlatformId | 'all'): string {
  const tk = p === 'tiktok';
  const all = p === 'all' || p == null;
  const ig = p === 'instagram';
  const mix = ig ? INSTAGRAM_TOTAL : BLENDED;
  const mixInteractions = ig ? INSTAGRAM_INTERACTIONS : BLENDED;
  switch (key) {
    case 'gaSpend': return `Coût Google Ads de la période, en euros. ${GA}`;
    case 'gaImpressions': return `Impressions des campagnes Google Ads. ${GA}`;
    case 'gaClicks': return `Clics sur les annonces Google Ads. ${GA}`;
    case 'gaCtr': return `CTR = clics / impressions. ${GA}`;
    case 'gaCpc': return `CPC = budget / clics. ${GA}`;
    case 'gaCpm': return `CPM = budget / impressions × 1 000. ${GA}`;
    case 'gaConversions': return `Conversions comptabilisées par Google Ads (actions de conversion du compte). ${GA}`;
    case 'gaCostPerConversion': return `Coût par conversion = budget / conversions. ${GA}`;
    case 'gaVideoViews': return `Vues vidéo des campagnes qui en renvoient (Vidéo, Demand Gen…) ; « Donnée non disponible » sinon. ${GA}`;
    case 'gaChart': return `Budget et clics par jour, par semaine (lundi) au-delà de 90 jours. ${GA}`;
    case 'gaChannels': return `Répartition du budget par type de campagne Google Ads. ${GA}`;
    case 'gaCampaigns': return `Campagnes actives sur la période, triées par budget. ${GA}`;
    case 'followers': return `Dernière valeur disponible à la fin de la période (instantané Windsor${notes.followersFallback ? `, sinon ${notes.followersFallback}` : ''}, sinon reconstitution marquée « Valeur estimée »). Variation = fin de période − veille du début.${all ? ' Total = somme des réseaux disponibles.' : ''}`;
    case 'newFollowers': return tk ? 'Variation nette des abonnés TikTok sur la période (gains − pertes). ' + SOURCE : p === 'linkedin' ? `Nouveaux abonnés gagnés sur la période. LinkedIn publie ces gains avec environ 2 jours de retard : quand la période inclut les derniers jours, le chiffre additionne les jours déjà publiés (provisoire, sans variation affichée). ${sentence(notes.newFollowersLinkedin, SOURCE)}` : sentence('Nouveaux abonnés gagnés sur la période.', SOURCE, HISTORY);
    case 'stories': return `Nombre de stories publiées sur la période. ${STORIES}`;
    case 'storyViews': return `Impressions des stories de la période : nombre de fois où elles ont été vues (Instagram « vues de story »), cumul au dernier relevé. Les impressions du compte (carte « Impressions totales ») comprennent déjà celles des stories. ${STORIES}`;
    case 'storyViewsPerStory': return `Impressions des stories ÷ stories publiées (les stories sans chiffre ne comptent pas). ${STORIES}`;
    case 'storyInteractions': return `Interactions sur les stories de la période : j’aime + réponses + partages (dans ${notes.storyHistory ?? 'l’historique importé'}) ou total fourni par Instagram via Windsor (j’aime, commentaires, enregistrements, partages) ; à défaut de ce total, réponses + partages. Une story sans chiffre n’est pas comptée et le total est alors marqué partiel ; il n’est donné que si au moins la moitié des stories de la période ont le chiffre. ${STORIES}`;
    case 'videosPublished': return `Vidéos et reels publiés sur la période (publications synchronisées au format vidéo ou reel).${all ? ` Somme des réseaux${client.features.youtube ? ', YouTube compris' : ''}.` : ''} Non disponible quand le format de certaines publications est inconnu. ${SOURCE}`;
    case 'posts': return `${tk ? 'Vidéos' : 'Publications organiques'} publiées sur la période.${all ? ` Somme des ${client.networks.length} réseaux.` : ''} ${notes.posts ?? 'Le nombre vient des publications synchronisées.'} ${SOURCE}`;
    case 'adsDelivered': return 'Nombre d\'annonces ayant eu au moins une impression sur la période.' + (all ? ' Une annonce Meta diffusée sur Facebook et Instagram n’est comptée qu’une fois.' : '');
    case 'impressions': return sentence(mix, tk ? TIKTOK_COHORT : HISTORY, SOURCE);
    case 'impressionsPerPost': return `Impressions ÷ publications de la période. ${mix}`;
    case 'videoViews': return ig ? `${INSTAGRAM_VIDEO} Le sous-titre indique le nombre de vidéos publiées sur la période. Une vidéo sans nombre de vues connu n’est pas comptée : le total est alors marqué partiel. Sans vidéo publiée, la variation n’est pas affichée. ${SOURCE}` : sentence(BLENDED, 'Le sous-titre indique le nombre de vidéos publiées sur la période.', tk ? TIKTOK_COHORT : HISTORY);
    case 'interactions': return sentence('J’aime (ou réactions) + commentaires + partages.', mixInteractions, tk ? TIKTOK_COHORT : HISTORY);
    case 'clicks': return p === 'linkedin' ? 'Clics sur les liens des publicités uniquement : les clics LinkedIn organiques (tous types de clics) sont exclus.' : p === 'instagram' ? 'Clics sur les liens des publicités uniquement (Instagram ne fournit pas de clics organiques sur liens).' : `Clics sur les liens externes. ${all ? `Somme des ${client.networks.length} réseaux ; LinkedIn et Instagram : publicité uniquement.` : BLENDED}`;
    case 'engagementRate': return `Interactions ÷ impressions × 100. ${mixInteractions}`;
    case 'spend': return `Budget média dépensé. ${PAID_ONLY}${p === 'facebook' || p === 'instagram' ? ' Budget Meta Ads réparti selon la plateforme de diffusion.' : ''}`;
    case 'cpm': return `Budget ÷ impressions payantes × 1 000. ${PAID_ONLY} Une baisse est favorable.`;
    case 'cpc': return `Budget ÷ clics payants sur les liens. ${PAID_ONLY} Une baisse est favorable.`;
    case 'cpe': return sentence('Budget média ÷ interactions totales (j’aime ou réactions + commentaires + partages, organique et payant confondus, comme la carte d’interactions).',
      all && 'Total : budget des réseaux sociaux ÷ interactions de ces mêmes réseaux (YouTube, dont le budget n’est pas compté ici, est exclu).',
      tk && TIKTOK_COHORT, 'Le budget est payant uniquement (connecteurs Ads). Sans budget sur la période, pas de CPE. Une baisse est favorable.');
    case 'cpv': return `Budget média ÷ vues des vidéos sponsorisées (2 secondes ou plus). ${PAID_ONLY} Une baisse est favorable.`;
    case 'chartFormats': return `Nombre de publications de la période par format (photo, vidéo / reel, ${p === 'facebook' ? 'album' : 'carrousel'}${p === 'linkedin' ? ', document' : ''}). ${SOURCE}`;
    case 'chartAudience': return 'Abonnés sur les dates du sélecteur, du premier au dernier jour de la période. Les boutons Semaine (période d’au moins 14 jours), Mois (au moins 60 jours) et Année (au moins 730 jours) choisissent le pas des points ; sous 14 jours, un point par jour. Par défaut, la vue la plus fine qui reste sous 30 points. Chaque point prend la dernière valeur disponible à sa date ou avant (jamais de date future ni de zéro inventé : vide avant le premier relevé) ; un point creux est une valeur estimée.';
    case 'chartInteractions': return `Répartition des interactions entre j’aime, commentaires et partages. ${BLENDED}`;
    case 'topPosts': return `Publications de la période triées par impressions, plus les publications plus anciennes promues pendant la période (leurs chiffres sont cumulés). « Paid » : publication soutenue par de la publicité (budget et CPE de ses annonces, toutes diffusions confondues)${p === 'facebook' || p === 'instagram' ? ', ou publicité sans publication correspondante sur le compte' : ''}. CPE = budget de ses annonces ÷ interactions totales de la publication (j’aime ou réactions + commentaires + partages, organique et payant confondus, comme les colonnes du tableau) ; il reste vide quand l’un de ces chiffres est inconnu ou que leur somme est nulle. Une ligne « Publicité » seule (sans publication du compte) divise par les interactions de l’annonce. ${p === 'facebook' || p === 'instagram' ? 'L’annonce est rattachée à sa publication par l’identifiant fourni par Meta quand il existe, sinon par la date et le titre de son nom (JJMMAAAA_titre_IG ou FB) ; en cas de doute elle reste « Paid » seule. ' : ''}Les liens ouvrent la publication sur le réseau (absents si le réseau n’en fournit pas). Les boutons Type et Format filtrent ce tableau seulement (formats présents dans le tableau, « Carrousel » ou « Album » selon le réseau) ; les cartes Top posts et Flops, les images du rapport et les exports ne changent pas.`;
    case 'topVisibility': return 'Publication de la période avec le plus d’impressions (ou de vues pour TikTok). Sans publication utilisable sur la période, la meilleure des publications plus anciennes promues pendant la période ; sa date est indiquée.';
    case 'topEngagement': return 'Publication de la période avec le plus d’interactions (j’aime + commentaires + partages). Sans publication utilisable sur la période, la meilleure des publications plus anciennes promues pendant la période ; sa date est indiquée.';
    case 'topCpm': return p === 'linkedin' ? 'Meilleur CPM parmi les posts sponsorisés de la période (publiés pendant la période ou promus pendant celle-ci, dépense d’au moins 5 €), via la publication référencée par la créative LinkedIn.' : p === 'instagram' || p === 'facebook' ? 'Meilleur (plus bas) CPM parmi les publications sponsorisées de la période (publiées pendant la période ou promues pendant celle-ci), dépense d’au moins 5 € : budget des annonces ÷ leurs impressions × 1 000. Les annonces Meta sont rattachées à leur publication par l’identifiant quand il existe, sinon par la date et le titre de leur nom.' : 'Meilleur (plus bas) CPM parmi les posts sponsorisés de la période (publiés pendant la période ou promus pendant celle-ci), dépense d’au moins 5 € : budget des publicités rattachées ÷ leurs impressions × 1 000.';
    case 'flopVisibility': return `Les publications du compte de la période avec le moins ${tk ? 'de vues' : 'd’impressions'}, de la plus faible à la moins faible. Ne comptent que les publications publiées depuis au moins 3 jours (avant, elles n’ont pas atteint leur public) et dont le chiffre est connu et non nul (un 0 est un chiffre non remonté). Ni annonces seules ni anciennes publications promues ; une publication « Paid » du compte reste classée et marquée. Au plus 3 publications, jamais plus de la moitié des publications comparables ; moins de 2 publications comparables : aucun classement.`;
    case 'flopEngagement': return `Les publications du compte de la période avec le plus faible taux d’engagement (interactions ÷ ${tk ? 'vues' : 'impressions'} × 100). Mêmes règles que les flops de visibilité : publications de 3 jours ou plus, j’aime, commentaires, partages et ${tk ? 'vues' : 'impressions'} connus (une publication sans l’un de ces chiffres n’est pas classée), au plus 3 publications et jamais plus de la moitié des publications comparables.`;
    case 'audienceGender': return 'Répartition hommes / femmes des abonnés (valeur actuelle, mise à jour à chaque synchronisation).';
    case 'audienceAge': return 'Répartition des abonnés par tranche d’âge (valeur actuelle).';
    case 'audienceCountry': return p === 'facebook' ? 'Top 10 des pays des personnes qui aiment la Page (dernier jour disponible, mise à jour à chaque synchronisation).' : 'Top 10 des pays des abonnés (valeur actuelle).';
    case 'audienceCity': return p === 'facebook' ? 'Top 10 des villes des personnes qui aiment la Page (dernier jour disponible, mise à jour à chaque synchronisation). Le sexe et l’âge ne sont pas fournis par Facebook pour cette Page.' : 'Top 10 des villes des abonnés (valeur actuelle).';
    case 'audienceIndustry': return 'Top 10 des secteurs d’activité des abonnés LinkedIn (valeur actuelle).';
    case 'audienceFunction': return 'Top 10 des fonctions des abonnés LinkedIn (valeur actuelle).';
    case 'audienceSeniority': return 'Niveaux d’ancienneté des abonnés LinkedIn (valeur actuelle).';
    case 'webSessions': return 'Sessions sur le site (Google Analytics non connecté).';
    case 'webUsers': return 'Utilisateurs uniques (Google Analytics non connecté).';
    case 'webPageviews': return 'Pages vues (Google Analytics non connecté).';
    case 'webDuration': return 'Temps moyen passé par session (Google Analytics non connecté).';
    case 'webBounce': return 'Part des sessions sans interaction ; une baisse est favorable (Google Analytics non connecté).';
    case 'webChart': return 'Sessions et utilisateurs par jour (Google Analytics non connecté).';
  }
}
