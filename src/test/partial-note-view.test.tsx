import { beforeAll, describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { TabNotes, type SocialData } from "../components/dashboard/common";
import { Overview } from "../components/dashboard/overview";
import { PlatformView } from "../components/dashboard/platform-view";
import {
  GLOBAL_COMPARED_KEYS,
  GLOBAL_PARTIAL_KEYS,
  NETWORK_COMPARED_KEYS,
  NETWORK_PARTIAL_KEYS,
  networkKeys,
  partialComparedKeys,
  partialKeys,
} from "../lib/partial-note";
import { addYoutubeToSocial } from "../lib/youtube";
import { realAllNetworkTotals, realBlendedTotals, type SocialPost } from "../lib/social-totals";
import { organicRows, paidRows, coverage, days, post, posts } from "./fixtures/young-account";
import { viewDiscrepancies } from "./fixtures/partial-view-checks";

vi.mock("@/client/config", async () =>
  (await import("@/test/fixtures/neutral-client")).neutralClientModule(),
);

// jsdom n'a pas ResizeObserver, que les graphiques (recharts) demandent à l'affichage d'un onglet réseau.
beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // Sans mise en page, jsdom donne une taille nulle aux graphiques : recharts le signale à chaque rendu.
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

// Les périodes de février 2025 sont partielles (voir fixtures/young-account.ts), celles de juin 2025 complètes.
type P = { start: string; end: string };
const early: P = { start: "2025-02-01", end: "2025-02-28" };
const late: P = { start: "2025-06-02", end: "2025-06-29" };
const dataFor = (source = days, extraPosts: SocialPost[] = []) =>
  ({
    days: source,
    posts: [...posts, ...extraPosts],
    ads: [],
    adCoverage: coverage,
    statuses: [],
    promotedPosts: [],
    paidAds: [],
    stories: [],
    storyPulls: [],
    storiesFailed: false,
    unusableStatMonths: [],
    audience: [],
    adLinking: { rule: 0, manual: 0, unlinked: 0 },
    statGapsFailed: false,
  }) as unknown as SocialData;
const data = dataFor();
// LinkedIn avec son organique dès janvier mais son payant seulement dès mars : février est partiel côté payant (et rien d'autre), mars complet.
const latePaid = dataFor([
  ...days.filter((d) => d.platform !== "linkedin"),
  ...organicRows("linkedin", "2025-01-01", "2025-08-31", { linkClicks: 0 }),
  ...paidRows("linkedin", "2025-03-01", "2025-08-31"),
]);
// Trois vidéos Instagram publiées en mai, deux sans nombre de vues : la période de mai est partielle pour une autre raison, sur une autre carte.
const videoMetrics = (impressions: number | null) => ({
  impressions,
  likes: 5,
  comments: 1,
  shares: 1,
});
const noVideoViews = dataFor(days, [
  post("instagram", "ig-v1", "2025-05-12", { format: "Vidéo", metrics: videoMetrics(900) }),
  post("instagram", "ig-v2", "2025-05-14", { format: "Vidéo", metrics: videoMetrics(null) }),
  post("instagram", "ig-v3", "2025-05-16", { format: "Vidéo", metrics: videoMetrics(null) }),
]);
const overview = (
  period: P,
  comparison: P,
  source: SocialData = data,
  youtubeUnavailable = false,
) =>
  render(
    <Overview
      data={source}
      google={undefined}
      youtube={undefined}
      youtubeUnavailable={youtubeUnavailable}
      period={period}
      comparison={comparison}
    />,
  );
const tab = (
  p: "facebook" | "instagram" | "linkedin" | "tiktok",
  period: P,
  comparison: P,
  source: SocialData = data,
) => render(<PlatformView data={source} p={p} period={period} comparison={comparison} />);

/** Ce que la lib dit des cartes de l'onglet (les mêmes calculs que les composants), à comparer à l'écran. */
function expectedFor(
  view: "overview" | "facebook" | "instagram" | "linkedin" | "tiktok",
  period: P,
  comparison: P,
  source: SocialData = data,
  youtubeUnavailable = false,
) {
  const totals = (p: P) =>
    (["facebook", "instagram", "linkedin", "tiktok"] as const).map((id) =>
      realBlendedTotals(
        id,
        source.days,
        source.posts,
        p,
        source.statuses,
        source.ads,
        source.adCoverage,
      ),
    );
  if (view === "overview") {
    const t = addYoutubeToSocial(realAllNetworkTotals(totals(period)), null, youtubeUnavailable);
    const o = addYoutubeToSocial(
      realAllNetworkTotals(totals(comparison)),
      null,
      youtubeUnavailable,
    );
    return {
      displayed: partialKeys(t, GLOBAL_PARTIAL_KEYS),
      compared: partialComparedKeys(t, o, GLOBAL_COMPARED_KEYS),
    };
  }
  const [t, o] = [period, comparison].map((p) =>
    realBlendedTotals(
      view,
      source.days,
      source.posts,
      p,
      source.statuses,
      source.ads,
      source.adCoverage,
    ),
  ) as [ReturnType<typeof realBlendedTotals>, ReturnType<typeof realBlendedTotals>];
  return {
    displayed: partialKeys(t, networkKeys(view, NETWORK_PARTIAL_KEYS)),
    compared: partialComparedKeys(t, o, networkKeys(view, NETWORK_COMPARED_KEYS)),
  };
}

describe("TabNotes", () => {
  it("writes nothing without a note", () => {
    const { container } = render(<TabNotes notes={[null, undefined, ""]} />);
    expect(container.innerHTML).toBe("");
  });
  it("writes each sentence as a note, all inside one block that the PNG and PDF exports leave out", () => {
    const { container } = render(
      <TabNotes notes={["Chiffres partiels : une raison.", null, "Une autre phrase."]} />,
    );
    const block = container.firstElementChild as HTMLElement;
    expect(block.hasAttribute("data-export-hide")).toBe(true);
    expect(
      within(block)
        .getAllByRole("note")
        .map((n) => n.textContent),
    ).toEqual(["Chiffres partiels : une raison.", "Une autre phrase."]);
  });
  it("writes a title followed by one line per network as a list, inside the same hidden block", () => {
    const { container } = render(
      <TabNotes
        notes={[{ title: "Chiffres partiels :", items: ["Facebook : a.", "LinkedIn : b."] }]}
      />,
    );
    const block = container.firstElementChild as HTMLElement;
    expect(block.hasAttribute("data-export-hide")).toBe(true);
    const note = within(block).getByRole("note");
    expect(within(note).getByText("Chiffres partiels :")).toBeTruthy();
    expect(
      within(note)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Facebook : a.", "LinkedIn : b."]);
  });
});

describe("Global tab", () => {
  it("explains the « partiel » cards, one line per network, in a note that is left out of the exports", () => {
    const { container } = overview(early, { start: "2024-12-01", end: "2024-12-31" });
    expect(screen.getAllByText("partiel").length).toBeGreaterThan(0);
    const note = screen.getByRole("note");
    const items = within(note)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(items[0]).toBe(
      "Facebook : l’organique du compte et les clics sur les liens ne remontent pas avant le 10/03/2025 ; le nombre de publications n’est pas relevé sur la période.",
    );
    expect(items.at(-1)).toBe(
      "Abonnés : aucun relevé jusqu’au 28/02/2025 pour Facebook, LinkedIn et TikTok.",
    );
    expect(note.closest("[data-export-hide]")).not.toBeNull();
    // La note est hors des blocs capturés (data-export-block) : jamais dans une image du rapport.
    expect(note.closest("[data-export-block]")).toBeNull();
    expect(container.querySelectorAll('[role="note"]')).toHaveLength(1);
  });
  it("explains the compared values that read « (partiel) », under the name of the compared period", () => {
    // Février contre juin : les valeurs de février portent « (partiel) », Facebook et LinkedIn n'y ont pas encore d'organique.
    overview(late, early);
    expect(screen.getAllByText(/^vs .*\(partiel\)$/).length).toBeGreaterThan(0);
    const notes = screen.getAllByRole("note");
    expect(notes).toHaveLength(1);
    expect(within(notes[0]!).getByText("Période comparée (février 2025) partielle :")).toBeTruthy();
    expect(
      within(notes[0]!)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([
      "Facebook : l’organique du compte et les clics sur les liens ne remontent pas avant le 10/03/2025 ; le nombre de publications n’est pas relevé.",
      "LinkedIn : l’organique du compte ne remonte pas avant le 05/05/2025.",
      "TikTok : les clics organiques sur les liens ne remontent pas avant le 01/04/2025.",
    ]);
  });
  it("writes both blocks when the displayed and the compared period are partial for different reasons", () => {
    // Mars contre février : le payant de LinkedIn commence en mars ; en mars Facebook et TikTok n'ont pas tout leur organique (la note de la période affichée).
    const { container } = overview({ start: "2025-03-01", end: "2025-03-31" }, early, latePaid);
    const titles = [...container.querySelectorAll('[role="note"] > p')].map((p) => p.textContent);
    expect(titles).toEqual(["Chiffres partiels :", "Période comparée (février 2025) partielle :"]);
  });
  it("writes no note when no card reads « partiel »", () => {
    overview(late, { start: "2025-05-10", end: "2025-06-01" });
    expect(screen.queryByText("partiel")).toBeNull();
    expect(screen.queryByText(/\(partiel\)/)).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
  });
  it("while YouTube is loading its cards read « partiel » and the note says why, then both go together", () => {
    const loading = overview(late, { start: "2025-05-10", end: "2025-06-01" }, data, true);
    // Les cartes d'abonnés, de publications, de vues de vidéo et d'interactions portent « partiel » ; la note nomme YouTube comme elles.
    expect(screen.getAllByText("partiel").length).toBeGreaterThan(0);
    expect(
      within(screen.getByRole("note"))
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["YouTube : chiffres incomplets sur la période."]);
    loading.unmount();
    overview(late, { start: "2025-05-10", end: "2025-06-01" }, data, false);
    expect(screen.queryByText("partiel")).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("network tab", () => {
  it("Facebook: the note comes first, with the cards that read « partiel » below, and stays out of the exports", () => {
    const { container } = tab("facebook", early, { start: "2024-12-01", end: "2024-12-31" });
    expect(screen.getAllByText("partiel").length).toBeGreaterThan(0);
    const notes = screen.getAllByRole("note");
    expect(notes.map((n) => n.textContent)).toEqual([
      "Chiffres partiels : l’organique du compte et les clics sur les liens ne remontent pas avant le 10/03/2025.",
    ]);
    expect(notes[0]?.closest("[data-export-hide]")).not.toBeNull();
    // Première ligne de l'onglet : avant la première partie de la page (« Activité »).
    expect(container.firstElementChild?.firstElementChild?.contains(notes[0] ?? null)).toBe(true);
    expect(container.querySelector("[data-export-hide] ~ section")).not.toBeNull();
  });
  it("displayed period complete, compared period without organic figures: only the comparison sentence is written, nothing twice", () => {
    tab("facebook", late, early);
    expect(screen.getAllByText(/^vs .*\(partiel\)$/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("note").map((n) => n.textContent)).toEqual([
      "Facebook : les chiffres organiques du compte (impressions, interactions…) ne remontent pas avant le 10/03/2025, leur comparaison reste donc vide.",
    ]);
  });
  it("both can apply at once (partial link clicks on the displayed period, empty compared period): the partial note comes first, about another period, never the same information twice", () => {
    tab("tiktok", early, { start: "2024-12-01", end: "2024-12-31" });
    expect(screen.getAllByRole("note").map((n) => n.textContent)).toEqual([
      "Chiffres partiels : les clics organiques sur les liens ne remontent pas avant le 01/04/2025.",
      "TikTok : les chiffres organiques des publications (impressions, interactions…) sont incomplets sur la période comparée, leur comparaison reste donc vide.",
    ]);
  });
  it("the compared value that the comparison sentence does not explain gets its own line, under the name of the compared period", () => {
    // LinkedIn : le payant ne commence qu'en mars, février n'en a pas : « vs … (partiel) » sur les cartes qu'alimente le payant.
    tab("linkedin", { start: "2025-06-02", end: "2025-06-29" }, early, latePaid);
    expect(screen.getAllByText(/^vs .*\(partiel\)$/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("note").map((n) => n.textContent)).toEqual([
      "Période comparée (février 2025) partielle : le payant ne remonte pas avant le 01/03/2025.",
    ]);
  });
  it("Instagram: the videos of the compared period without a view count are counted, under the name of the compared period", () => {
    tab("instagram", late, { start: "2025-05-10", end: "2025-06-01" }, noVideoViews);
    expect(screen.getAllByRole("note").map((n) => n.textContent)).toEqual([
      "Période comparée (10 mai – 1er juin 2025) partielle : 2 vidéos sans nombre de vues.",
    ]);
  });
  it("writes no note on a complete network, and no « partiel » card either", () => {
    // Instagram a tous ses chiffres dès le 01/01/2025 : ni la période affichée ni la période comparée n'a de trou.
    tab("instagram", early, { start: "2025-01-01", end: "2025-01-31" });
    expect(screen.queryByText("partiel")).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("the notes and the « partiel » marks on screen say the same thing (rendered tabs)", () => {
  // Liste de périodes affichées / comparées : de quoi couvrir les deux cas (partiel et complet) sur la période affichée comme sur la période comparée.
  const pairs: [string, P, P][] = [
    ["février contre janvier (mêmes trous)", early, { start: "2025-01-02", end: "2025-01-30" }],
    ["février contre décembre (sans donnée)", early, { start: "2024-12-01", end: "2024-12-31" }],
    ["juin contre février (comparée partielle)", late, early],
    ["juin contre mai (tout complet)", late, { start: "2025-05-10", end: "2025-06-01" }],
    ["mars contre février", { start: "2025-03-01", end: "2025-03-31" }, early],
    [
      "avril contre mars",
      { start: "2025-04-05", end: "2025-04-30" },
      { start: "2025-03-01", end: "2025-03-31" },
    ],
    ["juin contre mai (vidéos sans vues)", late, { start: "2025-05-10", end: "2025-06-01" }],
    ["mai contre juin (vidéos sans vues)", { start: "2025-05-10", end: "2025-06-01" }, late],
  ];
  const views = ["overview", "facebook", "instagram", "linkedin", "tiktok"] as const;
  for (const [dataLabel, source] of [
    ["données de base", data],
    ["payant de LinkedIn tardif", latePaid],
    ["vidéos Instagram sans nombre de vues en mai", noVideoViews],
  ] as const) {
    it(`${dataLabel} : cartes « partiel », valeurs comparées « (partiel) » et phrases concordent, sur ${pairs.length} paires de périodes`, () => {
      const bad: string[] = [];
      let partialCards = 0;
      let partialCompared = 0;
      for (const [label, period, comparison] of pairs)
        for (const view of views) {
          const { container, unmount } =
            view === "overview"
              ? overview(period, comparison, source)
              : tab(view, period, comparison, source);
          const expected = expectedFor(view, period, comparison, source);
          partialCards += expected.displayed.length;
          partialCompared += expected.compared.length;
          for (const issue of viewDiscrepancies(container, {
            tiktok: view === "tiktok",
            ...expected,
          }))
            bad.push(`${label} / ${view} : ${issue}`);
          unmount();
        }
      expect(bad).toEqual([]);
      // Le jeu de données couvre des cartes partielles des deux sortes (le contrôle ne passe pas à vide).
      if (source === data) {
        expect(partialCards).toBeGreaterThan(0);
        expect(partialCompared).toBeGreaterThan(0);
      }
      // Quarante onglets rendus par jeu de données (graphiques compris) : plus de cinq secondes quand toute la suite tourne en parallèle.
    }, 120_000);
  }
});
