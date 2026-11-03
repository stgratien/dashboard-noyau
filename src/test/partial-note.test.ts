import { describe, expect, it, vi } from "vitest";
import {
  comparedGlobalNote,
  comparedPartialNote,
  globalPartialNote,
  partialComparedKeys,
  partialKeys,
  partialNote,
  GLOBAL_COMPARED_KEYS,
  GLOBAL_PARTIAL_KEYS,
  NETWORK_COMPARED_KEYS,
  NETWORK_PARTIAL_KEYS,
  type NoteBlock,
} from "../lib/partial-note";
import { comparisonGapNote } from "../lib/comparison-note";
import { mergeOrganicHistory, type ManualOrganicDay } from "../lib/social-organic-history";
import {
  realAllNetworkTotals,
  realBlendedTotals,
  type AdCoverage,
  type RealTotals,
  type SocialDay,
  type SocialPost,
} from "../lib/social-totals";
import { addYoutubeToSocial, type YoutubeTotals } from "../lib/youtube";
import { coverageDescription } from "../lib/coverage-text";
import {
  days,
  posts,
  coverage,
  organicRows,
  paidRows,
  post,
  range,
} from "./fixtures/young-account";
import { PLATFORMS, type PlatformId } from "../lib/dashboard-data";

// Configuration neutre : les réseaux et leurs sources ne viennent pas du client de ce dépôt.
vi.mock("@/client/config", async () =>
  (await import("@/test/fixtures/neutral-client")).neutralClientModule(),
);

type P = { start: string; end: string };
const totalsFor = (
  days: SocialDay[],
  posts: SocialPost[],
  period: P,
  coverage: AdCoverage[] = [],
) => PLATFORMS.map(({ id }) => realBlendedTotals(id, days, posts, period, [], [], coverage));
const noteOf = (id: PlatformId, days: SocialDay[], posts: SocialPost[], period: P) =>
  partialNote(id, days, realBlendedTotals(id, days, posts, period, []), period);
const globalOf = (
  days: SocialDay[],
  posts: SocialPost[],
  period: P,
  cover: AdCoverage[] = coverage,
) => {
  const rows = totalsFor(days, posts, period, cover);
  return globalPartialNote(days, rows, realAllNetworkTotals(rows), period);
};
const comparedOf = (
  id: PlatformId,
  days: SocialDay[],
  posts: SocialPost[],
  period: P,
  comparison: P,
) =>
  comparedPartialNote(
    id,
    days,
    realBlendedTotals(id, days, posts, period, []),
    realBlendedTotals(id, days, posts, comparison, []),
    comparison,
  );
const comparedGlobalOf = (
  days: SocialDay[],
  posts: SocialPost[],
  period: P,
  comparison: P,
  cover: AdCoverage[] = coverage,
) => {
  const rows = totalsFor(days, posts, period, cover);
  const prev = totalsFor(days, posts, comparison, cover);
  return comparedGlobalNote(
    days,
    prev,
    realAllNetworkTotals(rows),
    realAllNetworkTotals(prev),
    comparison,
  );
};
const gapOf = (id: PlatformId, days: SocialDay[], posts: SocialPost[], period: P, comparison: P) =>
  comparisonGapNote(
    id,
    days,
    realBlendedTotals(id, days, posts, period, []),
    realBlendedTotals(id, days, posts, comparison, []),
    comparison,
  );
const lines = (block: NoteBlock | null) => block?.items ?? [];

describe("partialNote: young account (the period starts before several organic sources)", () => {
  const period = { start: "2025-02-01", end: "2025-02-28" };
  it("says when the organic account figures and the organic link clicks start, in one sentence when the date is the same", () => {
    expect(noteOf("facebook", days, posts, period)).toBe(
      "Chiffres partiels : l’organique du compte et les clics sur les liens ne remontent pas avant le 10/03/2025.",
    );
  });
  it("reads the start of LinkedIn from its first usable day, not from the provider zero run", () => {
    expect(noteOf("linkedin", days, posts, period)).toBe(
      "Chiffres partiels : l’organique du compte ne remonte pas avant le 05/05/2025.",
    );
  });
  it("explains the TikTok link clicks, which start later than its videos", () => {
    expect(noteOf("tiktok", days, posts, period)).toBe(
      "Chiffres partiels : les clics organiques sur les liens ne remontent pas avant le 01/04/2025.",
    );
  });
  it("keeps two sentences when the organic link clicks start on another day than the account figures", () => {
    // Organique du compte dès le 10/03, clics sur les liens seulement dès le 01/04.
    const staggered = [
      ...organicRows("facebook", "2025-03-10", "2025-03-31"),
      ...organicRows("facebook", "2025-04-01", "2025-04-30", { linkClicks: 2 }),
      ...paidRows("facebook", "2025-01-01", "2025-04-30"),
    ];
    expect(noteOf("facebook", staggered, posts, period)).toBe(
      "Chiffres partiels : l’organique du compte ne remonte pas avant le 10/03/2025 ; les clics organiques sur les liens ne remontent pas avant le 01/04/2025.",
    );
  });
  it("names the video views alone when the account figures are there but the video views have holes", () => {
    const noVideoViews = [
      ...organicRows("linkedin", "2025-01-01", "2025-04-30", { linkClicks: 0, videoViews: null }),
      ...paidRows("linkedin", "2025-01-01", "2025-04-30"),
    ];
    // Période de mars : l'organique du compte est complet, seules les vues de vidéo manquent.
    expect(
      noteOf("linkedin", noVideoViews, posts, { start: "2025-03-01", end: "2025-03-31" }),
    ).toBe("Chiffres partiels : les vues de vidéo sont incomplètes sur la période.");
  });
  it("writes nothing for a complete network", () => {
    expect(noteOf("instagram", days, posts, period)).toBeNull();
  });
  it("Global: a title, then one line per network (the cards that read « partiel »), then the networks with no follower reading at the end of the period", () => {
    expect(globalOf(days, posts, period)).toEqual({
      title: "Chiffres partiels :",
      items: [
        "Facebook : l’organique du compte et les clics sur les liens ne remontent pas avant le 10/03/2025 ; le nombre de publications n’est pas relevé sur la période.",
        "LinkedIn : l’organique du compte ne remonte pas avant le 05/05/2025.",
        "TikTok : les clics organiques sur les liens ne remontent pas avant le 01/04/2025.",
        "Abonnés : aucun relevé jusqu’au 28/02/2025 pour Facebook, LinkedIn et TikTok.",
      ],
    });
  });
  it("Global: a single network without follower reading is named alone", () => {
    const note = globalOf(days, posts, { start: "2025-04-05", end: "2025-04-30" });
    // Facebook, LinkedIn : organique complet sur la période ; seul LinkedIn n'a pas encore d'abonnés (zéros avant le 05/05).
    expect(lines(note)).toContain("Abonnés : aucun relevé jusqu’au 30/04/2025 pour LinkedIn.");
  });
});

describe("partialNote: nothing to explain", () => {
  const period = { start: "2025-06-02", end: "2025-06-29" };
  it("is null for every network tab and for Global when no card reads « partiel »", () => {
    for (const { id } of PLATFORMS) expect(noteOf(id, days, posts, period)).toBeNull();
    expect(globalOf(days, posts, period)).toBeNull();
  });
  it("never mentions a figure that reads « Donnée non disponible » (the cards drop « partiel » next to it)", () => {
    // Instagram sans aucun chiffre organique : impressions, interactions... indisponibles, donc rien à expliquer, même si la liste de couverture n'est pas vide.
    const onlyPaid = paidRows("instagram", "2025-02-01", "2025-02-28");
    const t = realBlendedTotals(
      "instagram",
      onlyPaid,
      [],
      { start: "2025-02-01", end: "2025-02-28" },
      [],
    );
    expect(t.impressions).toBeNull();
    expect(t.missing["impressions"]).toEqual(["instagram:organic"]);
    expect(
      partialNote("instagram", onlyPaid, t, { start: "2025-02-01", end: "2025-02-28" }),
    ).toBeNull();
  });
  it("lists only the cards of the tab: TikTok has no CPE card (it shows the CPV), the other tabs have one", () => {
    const period = { start: "2025-06-02", end: "2025-06-29" };
    expect(NETWORK_PARTIAL_KEYS).toContain("cpe");
    expect(GLOBAL_PARTIAL_KEYS).toContain("followers");
    // Une couverture partielle du seul CPE : sur TikTok elle n'écrit rien (sa carte n'existe pas), ailleurs elle est expliquée.
    const withCpeGap = (id: PlatformId) => {
      const t = realBlendedTotals(id, days, posts, period, []);
      expect(t.cpe).not.toBeNull();
      return { ...t, missing: { ...t.missing, cpe: [`${id}:paid`] } };
    };
    expect(partialNote("tiktok", days, withCpeGap("tiktok"), period)).toBeNull();
    expect(partialNote("facebook", days, withCpeGap("facebook"), period)).toBe(
      "Chiffres partiels : le payant est incomplet sur la période.",
    );
  });
});

describe("partialNote: imported history that stops before the end of the period (plain wording, the cards it touches)", () => {
  // L'export de la page couvre jusqu'au 15/10/2025 ; le connecteur donne les jours suivants (autre définition des réactions).
  const manual: ManualOrganicDay[] = range("2025-09-01", "2025-10-15").map((day) => ({
    platform: "facebook",
    day,
    organic_views: null,
    organic_impressions: 400,
    organic_video_views: 40,
    organic_likes: 8,
    organic_comments: 1,
    organic_shares: 1,
    posts_published: 1,
  }));
  const connector = organicRows("facebook", "2025-09-01", "2025-10-28", { linkClicks: 2 });
  const merged = mergeOrganicHistory(
    [...connector, ...paidRows("facebook", "2025-09-01", "2025-10-28")],
    manual,
    ["facebook"],
  );
  const fbPosts = range("2025-09-01", "2025-10-28")
    .filter((_, i) => i % 5 === 0)
    .map((day) => post("facebook", `fb-${day}`, day));
  const EXPORT =
    "les j’aime et commentaires après le 15/10/2025 viennent d’une autre source, moins complète (Interactions, Taux d’engagement et CPE)";
  it("says that the likes and comments after the last day of the history come from another, less complete source, and names the cards", () => {
    const period = { start: "2025-09-29", end: "2025-10-28" };
    expect(noteOf("facebook", merged, fbPosts, period)).toBe(`Chiffres partiels : ${EXPORT}.`);
  });
  it("uses no word of the connector or of the import on screen, and leaves the report wording alone", () => {
    const note = noteOf("facebook", merged, fbPosts, { start: "2025-09-29", end: "2025-10-28" });
    expect(note).not.toMatch(/connecteur|historique importé|export/i);
    expect(
      coverageDescription("facebook:export:2025-10-15", "interactions", () => "Facebook"),
    ).toBe(
      "Facebook : réactions lues du connecteur sur des jours que l’historique importé ne couvre pas (il s’arrête le 15/10/2025), autre définition",
    );
  });
  it("does not give a date when the days outside the history are not after its last day", () => {
    // Période qui commence avant le premier jour de l'historique : les jours du connecteur sont avant, pas après.
    const early = mergeOrganicHistory(
      [
        ...organicRows("facebook", "2025-08-01", "2025-10-28", { linkClicks: 2 }),
        ...paidRows("facebook", "2025-08-01", "2025-10-28"),
      ],
      manual.filter((d) => d.day >= "2025-09-10"),
      ["facebook"],
    );
    const note = noteOf("facebook", early, fbPosts, { start: "2025-08-20", end: "2025-09-20" });
    expect(note).toBe(
      "Chiffres partiels : les j’aime et commentaires de certains jours viennent d’une autre source, moins complète (Interactions, Taux d’engagement et CPE).",
    );
  });
  it("never reads a date out of a malformed history identifier", () => {
    const period = { start: "2025-09-29", end: "2025-10-28" };
    const t = realBlendedTotals("facebook", merged, fbPosts, period, []);
    const id = ["facebook:export:2025"];
    const bad = {
      ...t,
      missing: { ...t.missing, interactions: id, engagementRate: id, cpe: id },
    };
    expect(partialNote("facebook", merged, bad, period)).toBe(
      "Chiffres partiels : les j’aime et commentaires de certains jours viennent d’une autre source, moins complète (Interactions, Taux d’engagement et CPE).",
    );
  });
  it("is silent for a period fully inside the history", () => {
    expect(
      noteOf("facebook", merged, fbPosts, { start: "2025-09-02", end: "2025-10-14" }),
    ).toBeNull();
  });
  it("Global names the network, once, for all the cards it makes partial (interactions, rate, CPE)", () => {
    const period = { start: "2025-09-29", end: "2025-10-28" };
    const rows = PLATFORMS.map(({ id }) =>
      realBlendedTotals(
        id,
        id === "facebook" ? merged : days,
        id === "facebook" ? fbPosts : posts,
        period,
        [],
        [],
        coverage,
      ),
    );
    const note = globalPartialNote(days, rows, realAllNetworkTotals(rows), period);
    expect(lines(note).filter((l) => l.includes("autre source"))).toEqual([
      `Facebook : ${EXPORT}.`,
    ]);
  });
  it("puts the history sentence before the videos sentence when both apply", () => {
    // Deux vidéos publiées après le dernier jour de l'historique, sans nombre de j'aime (le connecteur renvoie 0).
    const withVideos = [
      ...fbPosts,
      post("facebook", "v1", "2025-10-20", {
        format: "Vidéo",
        metrics: { impressions: 500, likes: 0, comments: 1, shares: 1 },
      }),
      post("facebook", "v2", "2025-10-22", {
        format: "Vidéo",
        metrics: { impressions: 500, likes: 0, comments: 1, shares: 1 },
      }),
    ];
    expect(noteOf("facebook", merged, withVideos, { start: "2025-09-29", end: "2025-10-28" })).toBe(
      `Chiffres partiels : ${EXPORT} ; 2 vidéos sans nombre de j’aime.`,
    );
  });
});

describe("partialNote: videos, paid history, TikTok budget, YouTube", () => {
  it("counts the Instagram videos without a view count", () => {
    const period = { start: "2025-06-02", end: "2025-06-29" };
    const videos = [
      post("instagram", "v1", "2025-06-03", {
        format: "Vidéo",
        metrics: { impressions: 900, likes: 5, comments: 1, shares: 1 },
      }),
      post("instagram", "v2", "2025-06-10", {
        format: "Vidéo",
        metrics: { impressions: null, likes: 5, comments: 1, shares: 1 },
      }),
      post("instagram", "v3", "2025-06-17", {
        format: "Vidéo",
        metrics: { impressions: null, likes: 5, comments: 1, shares: 1 },
      }),
    ];
    expect(noteOf("instagram", days, videos, period)).toBe(
      "Chiffres partiels : 2 vidéos sans nombre de vues.",
    );
    expect(noteOf("instagram", days, videos.slice(0, 2), period)).toBe(
      "Chiffres partiels : 1 vidéo sans nombre de vues.",
    );
  });
  it("counts the Facebook videos without a like total (connector days)", () => {
    const period = { start: "2025-06-02", end: "2025-06-29" };
    const videos = [
      post("facebook", "f1", "2025-06-03", {
        format: "Vidéo",
        metrics: { impressions: 900, likes: 0, comments: 1, shares: 1 },
      }),
      post("facebook", "f2", "2025-06-10", {
        format: "Vidéo",
        metrics: { impressions: 900, likes: 0, comments: 1, shares: 1 },
      }),
      post("facebook", "f3", "2025-06-17", { format: "Photo" }),
    ];
    expect(noteOf("facebook", days, videos, period)).toBe(
      "Chiffres partiels : 2 vidéos sans nombre de j’aime.",
    );
  });
  it("says when the paid figures start when the period begins before them", () => {
    const late = [
      ...organicRows("linkedin", "2025-01-01", "2025-04-30", { linkClicks: 0 }),
      ...paidRows("linkedin", "2025-03-01", "2025-04-30"),
    ];
    expect(noteOf("linkedin", late, posts, { start: "2025-02-01", end: "2025-02-28" })).toBe(
      "Chiffres partiels : le payant ne remonte pas avant le 01/03/2025.",
    );
  });
  it("falls back to « incomplet » when a source has holes rather than a start", () => {
    const holes = [
      ...organicRows("linkedin", "2025-01-01", "2025-04-30", { linkClicks: 0 }).filter(
        (d) => d.day !== "2025-04-10",
      ),
      ...paidRows("linkedin", "2025-01-01", "2025-04-30"),
    ];
    expect(noteOf("linkedin", holes, posts, { start: "2025-04-01", end: "2025-04-30" })).toBe(
      "Chiffres partiels : l’organique du compte est incomplet sur la période.",
    );
  });
  it("Global: the budget of a TikTok with no published video is left out of the CPE, and the note says so", () => {
    const period = { start: "2025-06-02", end: "2025-06-29" };
    const noTikTokPost = posts.filter(
      (p) => !(p.platform === "tiktok" && p.published_at >= "2025-06-01"),
    );
    const rows = totalsFor(days, noTikTokPost, period, coverage);
    expect(rows.find((t) => t.platform === "tiktok")?.interactions).toBe(0);
    expect(globalOf(days, noTikTokPost, period)).toEqual({
      title: "Chiffres partiels :",
      items: ["TikTok : son budget est écarté du CPE faute de vidéo publiée sur la période."],
    });
  });
  it("is stable: same input, same lines, in the order of the tabs", () => {
    const period = { start: "2025-02-01", end: "2025-02-28" };
    const a = globalOf(days, posts, period);
    expect(globalOf(days, posts, period)).toEqual(a);
    const names = lines(a).map((l) => l.split(" :")[0]);
    expect(names).toEqual(["Facebook", "LinkedIn", "TikTok", "Abonnés"]);
  });
});

describe("partialNote: YouTube (neutral sentence, never a claim about why)", () => {
  const period = { start: "2025-06-02", end: "2025-06-29" };
  const rows = totalsFor(days, posts, period, coverage);
  const social = realAllNetworkTotals(rows);
  const youtube = (over: Partial<YoutubeTotals>) =>
    ({
      hasData: true,
      followers: 1000,
      followerGrowth: 10,
      followerGrowthPercent: 1,
      videos: 2,
      organicViews: 5000,
      interactions: 40,
      ...over,
    }) as unknown as YoutubeTotals;
  it("writes nothing when YouTube is not connected", () => {
    expect(
      globalPartialNote(days, rows, addYoutubeToSocial(social, null, false), period),
    ).toBeNull();
  });
  it("says that the figures are incomplete, without saying none were read, when the read failed or is loading", () => {
    // Les cartes d'abonnés, de publications, de vues de vidéo et d'interactions portent alors « partiel » : la note les accompagne (pas d'éclair de note sans carte).
    const unavailable = addYoutubeToSocial(social, null, true);
    expect(partialKeys(unavailable, GLOBAL_PARTIAL_KEYS)).toEqual([
      "followers",
      "posts",
      "videoViews",
      "interactions",
    ]);
    expect(globalPartialNote(days, rows, unavailable, period)).toEqual({
      title: "Chiffres partiels :",
      items: ["YouTube : chiffres incomplets sur la période."],
    });
  });
  it("does not claim « no data read » when views were read but subscribers or shares are missing", () => {
    const partial = addYoutubeToSocial(
      social,
      youtube({
        followers: null,
        followerGrowth: null,
        followerGrowthPercent: null,
        interactions: null,
      }),
    );
    const note = globalPartialNote(days, rows, partial, period);
    expect(note?.items).toEqual(["YouTube : chiffres incomplets sur la période."]);
    expect(JSON.stringify(note)).not.toMatch(/aucune donnée/);
  });
});

describe("partialNote: sentences pinned one by one (ads, unknown id, TikTok account, bare Global figures)", () => {
  const period = { start: "2025-06-02", end: "2025-06-29" };
  it("Global: a network whose ads could not be counted over the whole period", () => {
    // Aucun jour de diffusion de LinkedIn n'est couvert par le relevé des annonces : le total des annonces des autres réseaux s'affiche, partiel.
    const noLinkedinCoverage = coverage.filter((c) => c.source !== "linkedin");
    expect(lines(globalOf(days, posts, period, noLinkedinCoverage))).toEqual([
      "LinkedIn : le relevé des annonces est incomplet sur la période.",
    ]);
  });
  it("falls back to a generic sentence for an identifier that nothing classifies, rather than to silence", () => {
    const t = realBlendedTotals("facebook", days, posts, period, []);
    expect(typeof t.impressions).toBe("number");
    const odd = { ...t, missing: { ...t.missing, impressions: ["facebook:weird"] } };
    expect(partialNote("facebook", days, odd, period)).toBe(
      "Chiffres partiels : des chiffres sont incomplets sur la période.",
    );
  });
  it("Global: TikTok without any organic source says that the publications are incomplete", () => {
    const noTikTokOrganic = days.filter((d) => d.source !== "tiktok_organic");
    const note = globalOf(noTikTokOrganic, posts, period);
    expect(lines(note)).toEqual([
      "TikTok : l’organique des publications est incomplet sur la période ; les clics organiques sur les liens sont incomplets sur la période ; le nombre de publications n’est pas relevé sur la période.",
      // Ses abonnés non plus : un seul groupe pour les réseaux sans relevé.
      "Abonnés : aucun relevé jusqu’au 29/06/2025 pour TikTok.",
    ]);
  });
  it.each(["spend", "clicks", "cpm", "cpe"])(
    "Global: a network named alone on the %s card is a paid source that is incomplete",
    (key) => {
      const rows = totalsFor(days, posts, period, coverage);
      const total = realAllNetworkTotals(rows);
      const only: RealTotals = {
        ...total,
        missing: Object.fromEntries(
          Object.keys(total.missing).map((k) => [k, k === key ? ["linkedin"] : []]),
        ),
      };
      expect(lines(globalPartialNote(days, rows, only, period))).toEqual([
        "LinkedIn : le payant est incomplet sur la période.",
      ]);
    },
  );
  it.each(["posts", "impressionsPerPost"])(
    "Global: a network named alone on the %s card has no publication count",
    (key) => {
      const rows = totalsFor(days, posts, period, coverage);
      const total = realAllNetworkTotals(rows);
      const only: RealTotals = {
        ...total,
        missing: Object.fromEntries(
          Object.keys(total.missing).map((k) => [k, k === key ? ["facebook"] : []]),
        ),
      };
      expect(lines(globalPartialNote(days, rows, only, period))).toEqual([
        "Facebook : le nombre de publications n’est pas relevé sur la période.",
      ]);
    },
  );
  it("Global: a network named alone on the video views card has no video views for the period", () => {
    const rows = totalsFor(days, posts, period, coverage);
    const total = realAllNetworkTotals(rows);
    const only: RealTotals = {
      ...total,
      missing: Object.fromEntries(
        Object.keys(total.missing).map((k) => [k, k === "videoViews" ? ["linkedin"] : []]),
      ),
    };
    expect(lines(globalPartialNote(days, rows, only, period))).toEqual([
      "LinkedIn : les vues de vidéo ne sont pas relevées sur la période.",
    ]);
  });
});

describe("partialNote: « Vidéos publiées » on Global (the video count is not the publication count)", () => {
  const period = { start: "2025-06-02", end: "2025-06-29" };
  it("says that the video count cannot be determined when a publication has an unknown format, while the publication count is known", () => {
    const unknownFormat = [
      ...posts,
      post("facebook", "fb-unknown", "2025-06-10", { format: "Post" }),
    ];
    const rows = totalsFor(days, unknownFormat, period, coverage);
    const fb = rows.find((t) => t.platform === "facebook");
    expect(fb?.posts).not.toBeNull();
    expect(fb?.videos).toBeNull();
    const note = globalOf(days, unknownFormat, period);
    expect(lines(note)).toEqual([
      "Facebook : le nombre de vidéos n’est pas déterminé (format de certaines publications inconnu).",
    ]);
    expect(JSON.stringify(note)).not.toMatch(/publications n’est pas relevé/);
  });
  it("keeps « le nombre de publications n’est pas relevé » when the publication count itself is unknown, once for posts and videos", () => {
    const note = globalOf(days, posts, { start: "2025-02-01", end: "2025-02-28" });
    const facebook = lines(note).find((l) => l.startsWith("Facebook")) ?? "";
    expect(facebook.match(/publications n’est pas relevé/g)).toHaveLength(1);
    expect(facebook).not.toMatch(/vidéos n’est pas déterminé/);
  });
});

describe("comparedPartialNote: the compared period does not cover the same sources as the displayed one", () => {
  const feb = { start: "2025-02-01", end: "2025-02-28" };
  const mar = { start: "2025-03-01", end: "2025-03-31" };
  const jun = { start: "2025-06-02", end: "2025-06-29" };
  it("names the compared period (the report's name for it) and says that its paid figures start later", () => {
    const late = [
      ...organicRows("linkedin", "2025-01-01", "2025-04-30", { linkClicks: 0 }),
      ...paidRows("linkedin", "2025-03-01", "2025-04-30"),
    ];
    // Mars est complet ; février n'a pas encore de payant : « vs … (partiel) » sur les cartes que le payant alimente.
    expect(noteOf("linkedin", late, posts, mar)).toBeNull();
    expect(comparedOf("linkedin", late, posts, mar, feb)).toBe(
      "Période comparée (février 2025) partielle : le payant ne remonte pas avant le 01/03/2025.",
    );
    // La phrase de la comparaison vide ne dit rien ici : l'organique est là sur les deux périodes.
    expect(gapOf("linkedin", late, posts, mar, feb)).toBeNull();
  });
  it("is silent when the two periods have the same holes (no « (partiel) » mark, nothing to explain)", () => {
    expect(
      comparedOf("facebook", days, posts, { start: "2025-01-05", end: "2025-01-30" }, feb),
    ).toBeNull();
  });
  it("says the organic account figures of the compared period when the comparison sentence is silent (the displayed period has none either)", () => {
    // Novembre 2024 : aucune ligne Facebook, ni organique ni payant. Février 2025 : le payant est là, l'organique pas encore : « vs … (partiel) » sur le chiffre payant seul.
    const nov = { start: "2024-11-01", end: "2024-11-30" };
    expect(gapOf("facebook", days, posts, nov, feb)).toBeNull();
    expect(comparedOf("facebook", days, posts, nov, feb)).toBe(
      "Période comparée (février 2025) partielle : l’organique du compte et les clics sur les liens ne remontent pas avant le 10/03/2025.",
    );
  });
  it("is silent when the displayed period is the partial one and the compared period is complete", () => {
    expect(comparedOf("facebook", days, posts, feb, jun)).toBeNull();
  });
  it("does not repeat comparisonGapNote: account figures and link clicks that stop the same day are left to it", () => {
    expect(gapOf("facebook", days, posts, jun, feb)).toContain("leur comparaison reste donc vide");
    // Les cartes comparées portent bien « (partiel) » : c'est cette phrase-là qui les explique.
    const t = realBlendedTotals("facebook", days, posts, jun, []);
    const o = realBlendedTotals("facebook", days, posts, feb, []);
    // (Les interactions, sans organique, restent « Donnée non disponible » : pas de marque.)
    expect(partialComparedKeys(t, o, NETWORK_COMPARED_KEYS)).toEqual([
      "impressions",
      "videoViews",
      "clicks",
    ]);
    expect(comparedOf("facebook", days, posts, jun, feb)).toBeNull();
  });
  it("adds only what comparisonGapNote does not say: link clicks that start on another day than the account figures", () => {
    const staggered = [
      ...organicRows("facebook", "2025-03-10", "2025-03-31"),
      ...organicRows("facebook", "2025-04-01", "2025-08-31", { linkClicks: 2 }),
      ...paidRows("facebook", "2025-01-01", "2025-08-31"),
    ];
    expect(gapOf("facebook", staggered, posts, jun, feb)).toBe(
      "Facebook : les chiffres organiques du compte (impressions, interactions…) ne remontent pas avant le 10/03/2025, leur comparaison reste donc vide.",
    );
    expect(comparedOf("facebook", staggered, posts, jun, feb)).toBe(
      "Période comparée (février 2025) partielle : les clics organiques sur les liens ne remontent pas avant le 01/04/2025.",
    );
  });
  it("says the organic account figures of the compared period when no comparison sentence does (Global has none)", () => {
    expect(lines(comparedGlobalOf(days, posts, jun, feb))).toEqual([
      "Facebook : l’organique du compte et les clics sur les liens ne remontent pas avant le 10/03/2025 ; le nombre de publications n’est pas relevé.",
      "LinkedIn : l’organique du compte ne remonte pas avant le 05/05/2025.",
      "TikTok : les clics organiques sur les liens ne remontent pas avant le 01/04/2025.",
    ]);
    expect(comparedGlobalOf(days, posts, jun, feb)?.title).toBe(
      "Période comparée (février 2025) partielle :",
    );
  });
  it("Global: silent when the compared period has the same scope, or when nothing is partial", () => {
    expect(
      comparedGlobalOf(days, posts, jun, { start: "2025-05-10", end: "2025-06-01" }),
    ).toBeNull();
    expect(
      comparedGlobalOf(days, posts, feb, { start: "2025-01-05", end: "2025-01-30" }),
    ).toBeNull();
  });
  it("Global: the compared period is described by what it lacks, networks in the order of the tabs, and never by the abonnés", () => {
    const block = comparedGlobalOf(days, posts, jun, feb);
    expect(lines(block).map((l) => l.split(" :")[0])).toEqual(["Facebook", "LinkedIn", "TikTok"]);
    expect(JSON.stringify(block)).not.toMatch(/Abonnés/);
  });
  it("names an edition of the client by its name, and the compared period by its dates when nothing names it", () => {
    // L'édition (neutre) du 15 au 21/09/2025 : le payant de LinkedIn n'y commence que le 16/09.
    const sep = [
      ...organicRows("linkedin", "2025-09-01", "2025-09-30", { linkClicks: 0 }),
      ...paidRows("linkedin", "2025-09-16", "2025-09-30"),
    ];
    const edition = { start: "2025-09-15", end: "2025-09-21" };
    const week = { start: "2025-09-22", end: "2025-09-28" };
    expect(comparedOf("linkedin", sep, posts, week, edition)).toBe(
      "Période comparée (Edition 2025) partielle : le payant ne remonte pas avant le 16/09/2025.",
    );
    const odd = { start: "2025-09-10", end: "2025-09-20" };
    expect(comparedOf("linkedin", sep, posts, week, odd)).toBe(
      "Période comparée (10 septembre – 20 septembre 2025) partielle : le payant ne remonte pas avant le 16/09/2025.",
    );
  });
  it("lists the cards of the tab: the compared CPE exists on every tab but TikTok, the CPV on TikTok only", () => {
    expect(NETWORK_COMPARED_KEYS).toEqual(expect.arrayContaining(["cpe", "cpv", "posts", "spend"]));
    expect(GLOBAL_COMPARED_KEYS).not.toContain("followers");
    const t = realBlendedTotals("tiktok", days, posts, jun, []);
    const withGap = { ...t, missing: { ...t.missing, cpe: ["tiktok:paid"], cpv: ["tiktok:paid"] } };
    expect(comparedPartialNote("tiktok", days, t, withGap, feb)).toBe(
      "Période comparée (février 2025) partielle : le payant est incomplet.",
    );
    const facebook = realBlendedTotals("facebook", days, posts, jun, []);
    const fbGap = { ...facebook, missing: { ...facebook.missing, cpv: ["facebook:paid"] } };
    // Le CPV n'est pas une carte d'un onglet Facebook : rien à expliquer.
    expect(comparedPartialNote("facebook", days, facebook, fbGap, feb)).toBeNull();
  });
  it("does not explain a compared figure that reads « Donnée non disponible » (no « (partiel) » mark next to it)", () => {
    const onlyPaid = paidRows("instagram", "2025-02-01", "2025-02-28");
    const t = realBlendedTotals("instagram", days, posts, jun, []);
    const o = realBlendedTotals("instagram", onlyPaid, [], feb, []);
    expect(o.impressions).toBeNull();
    expect(partialComparedKeys(t, o, NETWORK_COMPARED_KEYS)).not.toContain("impressions");
    expect(comparedPartialNote("instagram", [...days, ...onlyPaid], t, o, feb)).toBeNull();
  });
  it("wording of the compared period never says « sur la période »: its title already names it", () => {
    expect(
      comparedOf(
        "linkedin",
        [
          ...organicRows("linkedin", "2025-01-01", "2025-04-30", { linkClicks: 0 }),
          ...paidRows("linkedin", "2025-03-01", "2025-04-30"),
        ],
        posts,
        mar,
        feb,
      ),
    ).not.toMatch(/sur la période/);
  });
  it("YouTube compared: neutral sentence", () => {
    const rows = totalsFor(days, posts, jun, coverage);
    const compared = { start: "2025-05-10", end: "2025-06-01" };
    const prev = totalsFor(days, posts, compared, coverage);
    const t = realAllNetworkTotals(rows);
    const o = addYoutubeToSocial(realAllNetworkTotals(prev), null, true);
    const block = comparedGlobalNote(days, prev, t, o, compared);
    expect(lines(block)).toEqual(["YouTube : chiffres incomplets."]);
  });
});

describe("partialNote and comparisonGapNote are complementary (displayed period against compared period)", () => {
  const early = { start: "2025-02-01", end: "2025-02-28" };
  const late = { start: "2025-06-02", end: "2025-06-29" };
  const totals = (id: PlatformId, period: P) => realBlendedTotals(id, days, posts, period, []);
  it("displayed period complete, compared period without organic figures: only the gap note speaks", () => {
    expect(partialNote("facebook", days, totals("facebook", late), late)).toBeNull();
    expect(
      comparisonGapNote(
        "facebook",
        days,
        totals("facebook", late),
        totals("facebook", early),
        early,
      ),
    ).toContain("leur comparaison reste donc vide");
  });
  it("displayed period without organic figures: only the partial note speaks (the gap note needs organic figures on the displayed period)", () => {
    expect(partialNote("facebook", days, totals("facebook", early), early)).toContain(
      "ne remontent pas avant le 10/03/2025",
    );
    expect(
      comparisonGapNote(
        "facebook",
        days,
        totals("facebook", early),
        totals("facebook", late),
        late,
      ),
    ).toBeNull();
  });
  it("never repeats the same information: on the same network the three lines never share a sentence", () => {
    // TikTok : la période affichée est partielle (clics), la période comparée aussi (organique des publications).
    const compared = { start: "2024-12-01", end: "2024-12-31" };
    const all = [
      partialNote("tiktok", days, totals("tiktok", early), early),
      gapOf("tiktok", days, posts, early, compared),
      comparedOf("tiktok", days, posts, early, compared),
    ].filter(Boolean) as string[];
    expect(new Set(all).size).toBe(all.length);
  });
});
