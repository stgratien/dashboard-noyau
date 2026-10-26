import { loadSocialData } from './social-data.server';
import { loadYoutube } from './youtube.server';
import { loadGoogleAds } from './google-ads.server';
import { googleAdsStale, youtubeCampaignSpend, type GoogleAdsRow } from './google-ads';
import { realAllNetworkTotals, realBlendedTotals } from './social-totals';
import { storiesTotals } from './social-stories';
import { addYoutubeToSocial, youtubeTotals, type YoutubeData } from './youtube';
import { buildReportNotes, buildReportTokens, REPORT_NETWORKS, type ReportNetwork, type ReportTotals } from './report-tokens';
import type { Period } from './dashboard-periods';
import { client } from './client';

type Totals = ReportTotals & ReturnType<typeof realBlendedTotals>;

/** Les quatre réseaux, puis le Global (YouTube ajouté comme dans l'onglet Global) pour une période. */
function totalsFor(social: Awaited<ReturnType<typeof loadSocialData>>, period: Period, youtube: YoutubeData | null, youtubeUnavailable: boolean) {
  const networks = Object.fromEntries(
    // Les stories ne concernent qu'Instagram et ne sont jamais ajoutées au Global (les impressions du compte les comprennent déjà).
    REPORT_NETWORKS.map((n) => [n, { ...realBlendedTotals(n, social.days, social.posts, period, social.statuses, social.ads, social.adCoverage), ...(n === 'instagram' ? { stories: storiesTotals(social.stories, social.storyPulls, period, { failed: social.storiesFailed }) } : {}) }]),
  ) as Record<ReportNetwork, Totals>;
  // Les lignes Google Ads ne servent qu'au payant de YouTube, jamais au Global (abonnés, vidéos, vues et interactions organiques).
  const global = addYoutubeToSocial(
    realAllNetworkTotals(REPORT_NETWORKS.map((n) => networks[n])),
    youtube?.lastSuccess ? youtubeTotals(youtube, [], period) : null,
    youtubeUnavailable,
  );
  return { global, ...networks };
}

/**
 * Chiffres du rapport Google Slides d'une période (et de la période comparée), calculés comme dans l'onglet Global
 * et dans chaque onglet réseau : mêmes agrégats (realBlendedTotals, realAllNetworkTotals, YouTube ajouté au Global).
 */
export async function loadReportTokens(period: Period, comparison?: { period: Period; label: string }) {
  const began = Date.now();
  const range = comparison
    ? { start: period.start < comparison.period.start ? period.start : comparison.period.start, end: period.end > comparison.period.end ? period.end : comparison.period.end }
    : period;
  // YouTube et Google Ads se lisent pendant le chargement des données sociales (trois lectures indépendantes) ; chaque lecture attrape sa propre erreur,
  // aucune promesse ne peut donc être rejetée et une panne sociale reste la seule à faire échouer le calcul.
  // Comme le tableau de bord : lecture YouTube impossible = Global sans YouTube, signalé partiel (jamais un total complet en apparence).
  const youtubeRead = (async (): Promise<{ youtube: YoutubeData | null; youtubeUnavailable: boolean; ms: number }> => {
    if (!client.features.youtube) return { youtube: null, youtubeUnavailable: false, ms: 0 };
    try {
      return { youtube: await loadYoutube(range), youtubeUnavailable: false, ms: Date.now() - began };
    } catch (error) {
      console.error('report-data: lecture YouTube impossible', error instanceof Error ? error.message : error);
      return { youtube: null, youtubeUnavailable: true, ms: Date.now() - began };
    }
  })();
  // Budget de la diapositive YouTube : campagnes Google Ads dont le nom contient « YouTube » (jamais ajouté au Global).
  const adsRead = (async (): Promise<{ ads: { rows: GoogleAdsRow[]; lastSuccess: string | null } | null; ms: number }> => {
    if (!client.features.googleAds) return { ads: null, ms: 0 };
    try {
      return { ads: await loadGoogleAds(range), ms: Date.now() - began };
    } catch (error) {
      console.error('report-data: lecture Google Ads impossible', error instanceof Error ? error.message : error);
      return { ads: null, ms: Date.now() - began };
    }
  })();
  const social = await loadSocialData({ period, comparison: comparison?.period ?? period });
  const socialMs = Date.now() - began;
  const { youtube, youtubeUnavailable, ms: youtubeMs } = await youtubeRead;
  const { ads, ms: adsMs } = await adsRead;
  const computeBegan = Date.now();
  const spendOf = (p: Period) => ({ spend: ads ? youtubeCampaignSpend(ads.rows, p) : null });
  const current = totalsFor(social, period, youtube, youtubeUnavailable);
  const previous = comparison ? totalsFor(social, comparison.period, youtube, youtubeUnavailable) : undefined;
  const notes = buildReportNotes(current);
  if (!client.features.googleAds) { /* pas de Google Ads pour ce client : ni note ni budget YouTube */ }
  else if (!ads) notes.push('YouTube, budget : lecture Google Ads impossible');
  else if (googleAdsStale(ads.lastSuccess)) notes.push('YouTube, budget : aucune donnée Google Ads reçue depuis plus de 48 h (chiffre à relire)');
  const tokens = buildReportTokens(
    period,
    current,
    previous && comparison ? { label: comparison.label, totals: previous } : undefined,
    // Sans Google Ads, pas de budget YouTube : aucun jeton youtube.* (le modèle du client n'a pas la diapositive).
    client.features.googleAds ? { current: spendOf(period), ...(comparison ? { previous: spendOf(comparison.period) } : {}) } : undefined,
  );
  // Durées seulement (en ms depuis le début de la requête ; une lecture sociale très courte indique le cache de 2 minutes).
  console.info('report-data: durées', { socialMs, youtubeMs, adsMs, computeMs: Date.now() - computeBegan, totalMs: Date.now() - began });
  return { tokens, notes };
}
