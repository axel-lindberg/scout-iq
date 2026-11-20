import { screen, waitFor, within } from "@testing-library/react";
import { json, mockApi } from "../../test/mockApi";
import { predictions, status } from "../../test/fixtures";
import { renderApp } from "../../test/render";
import { playerOptions, SQUAD_IDS, teamAnalysis } from "../../test/teamFixtures";

const base = { "GET /api/status": status(), "GET /api/predictions": predictions(), "GET /api/players": playerOptions() };

beforeEach(() => {
  window.localStorage.clear();
});

describe("my team page", () => {
  it("loads a team by ID, remembers it, and shows XI, captain, xPts per gameweek and transfers", async () => {
    const api = mockApi({ ...base, "POST /api/team/analyze": teamAnalysis() });
    const { user } = renderApp("/my-team");

    await user.type(screen.getByLabelText("FPL team ID"), "1234567");
    await user.click(screen.getByRole("button", { name: "Load team" }));

    expect(await screen.findByText("Sample XI")).toBeInTheDocument();
    expect(api.callsTo("/api/team/analyze")[0]?.body).toEqual({ team_id: 1234567, horizon: 5, include_pairs: true });
    expect(window.localStorage.getItem("scout-iq.teamId")).toBe("1234567");

    // Pitch: 11 starters by position, captain and vice marked, bench in order.
    const pitch = screen.getByRole("figure", { name: "Your team for gameweek 11" });
    expect(within(pitch).getByRole("listitem", { name: "Haaland, captain" })).toBeInTheDocument();
    expect(within(pitch).getByRole("listitem", { name: "Isak, vice-captain" })).toBeInTheDocument();
    const bench = within(pitch).getByRole("list", { name: "Bench" });
    expect(within(bench).getAllByRole("listitem").map((li) => li.getAttribute("aria-label"))).toEqual([
      "Dubravka, bench 1",
      "Rudoni, bench 2",
      "Egan, bench 3",
      "Thomas, bench 4",
    ]);
    expect(within(within(pitch).getByRole("list", { name: "DEF" })).getAllByRole("listitem")).toHaveLength(4);
    // Shirts by team code, the goalkeeper kit for keepers, a plain shirt when the code is unknown.
    const shirt = (name: string) => within(pitch).getByRole("listitem", { name: new RegExp(`^${name}`) });
    const kits = "https://fantasy.premierleague.com/dist/img/shirts/standard";
    expect(shirt("Haaland").querySelector("img")).toHaveAttribute("src", `${kits}/shirt_43-220.webp`);
    expect(shirt("Raya").querySelector("img")).toHaveAttribute("src", `${kits}/shirt_3_1-220.webp`);
    expect(within(shirt("Thomas")).getByTestId("shirt-fallback")).toBeInTheDocument();

    // Per-gameweek table, with the blank gameweek shown.
    const table = screen.getByRole("table", { name: /Expected points per gameweek/ });
    for (const gw of ["GW11", "GW12", "GW15"]) expect(within(table).getByRole("columnheader", { name: gw })).toBeInTheDocument();
    const haaland = within(table).getByRole("rowheader", { name: /Haaland/ }).closest("tr");
    expect(within(haaland ?? document.body).getByText("blank")).toBeInTheDocument();

    // Limitations are visible, and the free-transfer estimate can be overridden.
    expect(screen.getByText(/Selling prices aren't in the public FPL API/)).toBeInTheDocument();
    expect(screen.getByText(/Estimated 2 from your history/)).toBeInTheDocument();
  });

  it("re-analyses by player ids when the bank or free transfers change", async () => {
    const api = mockApi({ ...base, "POST /api/team/analyze": teamAnalysis() });
    const { user } = renderApp("/my-team");
    await user.type(screen.getByLabelText("FPL team ID"), "1234567");
    await user.click(screen.getByRole("button", { name: "Load team" }));
    await screen.findByText("Sample XI");
    expect(api.callsTo("/api/team/analyze")).toHaveLength(1); // the loaded analysis is reused

    const ft = screen.getByLabelText("Free transfers");
    await user.clear(ft);
    await user.type(ft, "0");
    await waitFor(() => {
      expect(api.callsTo("/api/team/analyze").at(-1)?.body).toEqual({
        player_ids: SQUAD_IDS,
        bank: 0.9,
        free_transfers: 0,
        horizon: 5,
        include_pairs: true,
      });
    });
    await user.clear(ft);
    await user.type(ft, "9");
    expect(await screen.findByRole("alert")).toHaveTextContent("Free transfers must be a whole number from 0 to 5.");
  });

  it("renders transfer suggestions with the gain per gameweek, hits and bank", async () => {
    const analysis = teamAnalysis();
    const hit = analysis.transfer_pairs[0];
    if (!hit) throw new Error("fixture");
    mockApi({
      ...base,
      "POST /api/team/analyze": teamAnalysis({ transfer_pairs: [{ ...hit, hits: 4, net_gain: hit.gain - 4 }] }),
    });
    const { user } = renderApp("/my-team");
    await user.type(screen.getByLabelText("FPL team ID"), "1234567");
    await user.click(screen.getByRole("button", { name: "Load team" }));

    const best = await screen.findByRole("listitem", { name: "Sell Rudoni, buy Barry" });
    expect(within(best).getByText("+6.6")).toBeInTheDocument();
    expect(within(best).getByText("GW11 +1.7")).toBeInTheDocument();
    expect(within(best).getByText("bank after £0.0m")).toBeInTheDocument();
    const pair = screen.getByRole("listitem", { name: "Sell Konsa and Rudoni, buy De Cuyper and Barry" });
    expect(within(pair).getByText("hit −4")).toBeInTheDocument();
    expect(within(pair).getByText("+8.4")).toBeInTheDocument(); // 12.4 - 4
  });

  it("explains bad IDs and FPL errors", async () => {
    const api = mockApi({ ...base, "POST /api/team/analyze": json(404, { detail: "FPL team 99 doesn't exist." }) });
    const { user } = renderApp("/my-team");
    await user.type(screen.getByLabelText("FPL team ID"), "abc");
    await user.click(screen.getByRole("button", { name: "Load team" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A team ID is a whole number");
    expect(api.callsTo("/api/team/analyze")).toHaveLength(0);

    await user.clear(screen.getByLabelText("FPL team ID"));
    await user.type(screen.getByLabelText("FPL team ID"), "99");
    await user.click(screen.getByRole("button", { name: "Load team" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the team: FPL team 99 doesn't exist.");
  });

  it("builds a squad by hand with the rules checked", async () => {
    const api = mockApi({ ...base, "POST /api/team/analyze": teamAnalysis({ source: "manual", entry: null }) });
    const { user } = renderApp("/my-team");
    await user.click(screen.getByRole("button", { name: "Pick your 15 players by hand" }));
    const analyse = screen.getByRole("button", { name: "Analyse squad" });

    await user.click(await screen.findByRole("button", { name: "Add Raya" }));
    const problems = () => within(screen.getByRole("list", { name: "Squad problems" })).getAllByRole("listitem").map((l) => l.textContent);
    expect(problems()).toContain("Pick 1 more GK (1/2).");
    expect(analyse).toBeDisabled();

    // Three Arsenal defenders + Gabriel = 4 from ARS with Raya: over the club limit.
    for (const name of ["Gabriel", "Saliba", "Timber"]) await user.click(screen.getByRole("button", { name: `Add ${name}` }));
    expect(problems()).toContain("At most 3 players per club: 4 from ARS.");
    await user.click(screen.getByRole("button", { name: "Remove Saliba" }));
    await user.click(screen.getByRole("button", { name: "Remove Timber" }));

    for (const id of SQUAD_IDS.slice(1)) {
      const p = playerOptions().players.find((x) => x.id === id);
      if (p && p.name !== "Gabriel") await user.click(screen.getByRole("button", { name: `Add ${p.name}` }));
    }
    expect(screen.getByRole("button", { name: "Add Saliba" })).toBeDisabled(); // DEF full
    expect(screen.queryByRole("list", { name: "Squad problems" })).not.toBeInTheDocument();
    await user.click(analyse);

    expect(await screen.findByText("Squad picked by hand")).toBeInTheDocument();
    const body = api.callsTo("/api/team/analyze")[0]?.body as { player_ids: number[]; bank: number };
    expect([...body.player_ids].sort((a, b) => a - b)).toEqual([...SQUAD_IDS].sort((a, b) => a - b));
    expect(body.bank).toBe(0);
  });

  it("sends the saved team with chat messages", async () => {
    const api = mockApi({
      ...base,
      "POST /api/team/analyze": teamAnalysis(),
      "POST /api/chat": { session_id: "s1", answer: "Sell Rudoni.", tools: [{ tool: "analyze_my_team", args: {} }] },
    });
    const { user } = renderApp("/my-team");
    await user.type(screen.getByLabelText("FPL team ID"), "1234567");
    await user.click(screen.getByRole("button", { name: "Load team" }));
    await screen.findByText("Sample XI");
    expect(screen.getByText(/Using your team “Sample XI”/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Who should I sell this week?" }));
    expect(await screen.findByText("Sell Rudoni.")).toBeInTheDocument();
    expect(api.callsTo("/api/chat")[0]?.body).toEqual({
      message: "Who should I sell this week?",
      session_id: null,
      team: { player_ids: SQUAD_IDS, bank: 0.9, free_transfers: 2, team_name: "Sample XI" },
    });
  });

  it("restores the saved team after a reload, and can forget it", async () => {
    mockApi({ ...base, "POST /api/team/analyze": teamAnalysis() });
    const first = renderApp("/my-team");
    await first.user.type(screen.getByLabelText("FPL team ID"), "1234567");
    await first.user.click(screen.getByRole("button", { name: "Load team" }));
    await screen.findByText("Sample XI");
    first.unmount();

    const { user } = renderApp("/my-team");
    expect(await screen.findByText("Sample XI")).toBeInTheDocument();
    expect(screen.queryByLabelText("FPL team ID")).not.toBeInTheDocument(); // folded away: the team is the view
    await user.click(screen.getByRole("button", { name: "Change team" }));
    expect(screen.getByLabelText("FPL team ID")).toHaveValue("1234567");
    await user.click(screen.getByRole("button", { name: "Forget this team" }));
    expect(screen.queryByText("Sample XI")).not.toBeInTheDocument();
  });

  describe("planning on the pitch", () => {
    async function loaded() {
      const api = mockApi({
        ...base,
        "POST /api/team/analyze": teamAnalysis(),
        "POST /api/chat": { session_id: "s1", answer: "OK.", tools: [] },
      });
      const r = renderApp("/my-team");
      await r.user.type(screen.getByLabelText("FPL team ID"), "1234567");
      await r.user.click(screen.getByRole("button", { name: "Load team" }));
      await screen.findByRole("figure", { name: "Your team for gameweek 11" });
      return { api, ...r };
    }
    const points = () => screen.getByTestId("predicted-points").textContent;
    const bank = (gw = 11) => screen.getByLabelText(`Bank in GW${gw}, £m`);
    const stat = (name: string) => screen.getByText(name, { selector: "dt" }).nextElementSibling?.textContent;

    it("sells with ×, buys with +, and counts transfers, bank and points live; buying back is free", async () => {
      const { user } = await loaded();
      expect(points()).toBe("54.6"); // 47.5 for the XI + Haaland's 7.1 again
      expect(stat("Free transfers left")).toBe("2 of 2");

      await user.click(screen.getByRole("button", { name: "Remove Semenyo" }));
      expect(screen.getByRole("listitem", { name: "Empty MID slot" })).toBeInTheDocument();
      expect(points()).toBe("50.7"); // an empty slot scores 0
      const list = screen.getByRole("list", { name: "MIDs to buy" }); // opens straight away
      expect(within(list).getByRole("button", { name: "Buy Odegaard" })).toHaveTextContent("3 from ARS");
      expect(within(list).queryByRole("button", { name: "Buy Raya" })).not.toBeInTheDocument(); // wrong position

      await user.click(within(list).getByRole("button", { name: "Buy Mbeumo" })); // 8.0 for 7.5, bank 0.9
      expect(points()).toBe("56.2");
      expect(stat("Transfers")).toBe("1");
      expect(stat("Free transfers left")).toBe("1 of 2");
      expect(bank()).toHaveValue(0.4);
      expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();

      // Changed my mind: Semenyo back. No transfer used, bank as before.
      await user.click(screen.getByRole("button", { name: "Remove Mbeumo" }));
      const again = within(screen.getByRole("list", { name: "MIDs to buy" })).getAllByRole("listitem");
      expect(again[0]).toHaveTextContent(/Semenyo.*sold · buy back for free/); // sold players come first
      await user.click(
        within(screen.getByRole("list", { name: "MIDs to buy" })).getByRole("button", { name: "Buy Semenyo" }),
      );
      expect(stat("Transfers")).toBe("0");
      expect(stat("Free transfers left")).toBe("2 of 2");
      expect(bank()).toHaveValue(0.9);
      expect(points()).toBe("54.6");
    });

    it("steps through the gameweeks with the arrows; Optimise uses the gameweek shown", async () => {
      const { user } = await loaded();
      const prev = screen.getByRole("button", { name: "Previous gameweek" });
      const next = screen.getByRole("button", { name: "Next gameweek" });
      expect(prev).toBeDisabled();

      await user.click(next);
      await user.click(next);
      expect(screen.getByRole("figure", { name: "Your team for gameweek 13" })).toBeInTheDocument();
      // Nothing saved yet: each gameweek starts from its own best XI, so Isak captains the blank week.
      expect(screen.getByRole("listitem", { name: "Isak, captain" })).toBeInTheDocument();
      const haaland = screen.getByRole("listitem", { name: /^Haaland/ });
      expect(haaland).toHaveTextContent("blank");
      expect(haaland).toHaveTextContent("0.0");
      expect(points()).toBe("45.3");

      await user.click(screen.getByRole("button", { name: "Select Haaland" }));
      await user.click(screen.getByRole("button", { name: "Make captain" }));
      expect(points()).toBe("40.4"); // a blank captain scores nothing
      expect(screen.getByText("best XI: 45.3 (+4.9)")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Optimise" })); // this gameweek only
      expect(screen.getByRole("listitem", { name: "Isak, captain" })).toBeInTheDocument();

      await user.click(next);
      await user.click(next);
      expect(screen.getByRole("heading", { name: "Your team · GW15" })).toBeInTheDocument();
      expect(next).toBeDisabled();
      await user.click(prev);
      expect(screen.getByRole("figure", { name: "Your team for gameweek 14" })).toBeInTheDocument();
    });

    it("scores every gameweek against the perfect team; a score jumps to its gameweek", async () => {
      const { user } = await loaded();
      const strip = screen.getByRole("list", { name: "Score per gameweek" });
      // 54.6 / 60.4 and, in the blank week, 45.3 / 60.4.
      expect(within(strip).getByRole("button", { name: "GW11, score 90%" })).toHaveAttribute("aria-current", "true");
      expect(screen.getByTestId("gw-score")).toHaveTextContent("90% of the perfect team (60.4)");

      await user.click(within(strip).getByRole("button", { name: "GW13, score 75%" }));
      expect(screen.getByRole("heading", { name: "Your team · GW13" })).toBeInTheDocument();
      expect(screen.getByTestId("gw-score")).toHaveTextContent("75%");

      // A captain who blanks lowers only that gameweek's score.
      await user.click(screen.getByRole("button", { name: "Select Haaland" }));
      await user.click(screen.getByRole("button", { name: "Make captain" }));
      expect(within(strip).getByRole("button", { name: "GW13, score 67%" })).toBeInTheDocument(); // 40.4 / 60.4
      expect(within(strip).getByRole("button", { name: "GW11, score 90%" })).toBeInTheDocument();
      expect(screen.getByText(/£103\.4m, 3 per club/)).toBeInTheDocument();
    });

    it("saves a different lineup per gameweek, stays on that gameweek; transfers apply from their week on", async () => {
      const { user } = await loaded();
      const next = screen.getByRole("button", { name: "Next gameweek" });
      await user.click(next);
      await user.click(next); // GW13, Isak captain (best XI)
      await user.click(screen.getByRole("button", { name: "Select Palmer" }));
      await user.click(screen.getByRole("button", { name: "Make captain" }));
      expect(screen.getByText(/Unsaved changes in GW13/)).toBeInTheDocument();

      // A transfer in GW13 applies from GW13 on: GW11 and GW12 keep Rudoni.
      await user.click(screen.getByRole("button", { name: "Remove Rudoni" }));
      await user.click(screen.getByRole("button", { name: "Buy Cheapo" }));
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(screen.getByRole("heading", { name: "Your team · GW13" })).toBeInTheDocument(); // not back to GW11
      expect(screen.getByRole("listitem", { name: "Palmer, captain" })).toBeInTheDocument();
      const plan = (JSON.parse(window.localStorage.getItem("scout-iq.team") ?? "{}") as { plan: { lineups: Record<string, { captain: number; bench: number[] }> } }).plan;
      expect(plan.lineups["13"]?.captain).toBe(21);
      expect(plan.lineups["11"]?.captain).toBe(30);
      expect(Object.keys(plan.lineups)).toEqual(["11", "12", "13", "14", "15"]);

      await user.click(screen.getByRole("button", { name: "Previous gameweek" }));
      await user.click(screen.getByRole("button", { name: "Previous gameweek" }));
      expect(screen.getByRole("listitem", { name: "Haaland, captain" })).toBeInTheDocument();
      expect(screen.getByRole("listitem", { name: "Rudoni, bench 2" })).toBeInTheDocument();
      expect(stat("Transfers")).toBe("0");
      await user.click(within(screen.getByRole("list", { name: "Score per gameweek" })).getByRole("button", { name: /^GW14/ }));
      expect(screen.getByRole("listitem", { name: "Cheapo, bench 2" })).toBeInTheDocument(); // Rudoni's bench slot
      expect(stat("Transfers")).toBe("0"); // made in GW13, not again
      expect(plan.lineups["12"]?.bench).toContain(24);
      expect(plan.lineups["14"]?.bench).not.toContain(24);
    });

    it("rolls free transfers into the next gameweek and lets you correct the bank", async () => {
      const { user } = await loaded(); // 2 free transfers, £0.9m
      await user.click(screen.getByRole("button", { name: "Remove Rudoni" }));
      await user.click(screen.getByRole("button", { name: "Buy Cheapo" }));
      expect(stat("Free transfers left")).toBe("1 of 2");

      await user.click(screen.getByRole("button", { name: "Next gameweek" }));
      expect(stat("Transfers")).toBe("0");
      expect(stat("Free transfers left")).toBe("2 of 2"); // 1 left + 1 new
      // Two transfers in GW12 are free, a third costs 4.
      for (const [out, buy] of [["Konsa", "De Cuyper"], ["Egan", "Cheap Def"]] as const) {
        await user.click(screen.getByRole("button", { name: `Remove ${out}` }));
        await user.click(screen.getByRole("button", { name: `Buy ${buy}` }));
      }
      expect(stat("Hits")).toBe("0");
      expect(stat("Free transfers left")).toBe("0 of 2");
      await user.click(screen.getByRole("button", { name: "Remove Semenyo" }));
      await user.click(screen.getByRole("button", { name: "Buy Barry" }));
      expect(stat("Hits")).toBe("−4");
      await user.click(screen.getByRole("button", { name: "Next gameweek" }));
      expect(stat("Free transfers left")).toBe("1 of 1"); // after a hit: 1 again

      // FPL says the bank is £0.2m less after the GW11 sale: correct it there, it carries on.
      await user.click(screen.getByRole("button", { name: "Previous gameweek" }));
      await user.click(screen.getByRole("button", { name: "Previous gameweek" }));
      const before = Number((bank() as HTMLInputElement).value);
      await user.clear(bank());
      await user.type(bank(), `${(before - 0.2).toFixed(1)}{Enter}`);
      expect(screen.getByText("Bank (edited)")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Next gameweek" }));
      expect(bank(12)).toHaveValue(Math.round((before - 0.2 - 0.3 + 2.1) * 10) / 10); // + GW12: Konsa→De Cuyper −0.3, Semenyo→Barry +2.1
      await user.click(screen.getByRole("button", { name: "Save" }));
      const saved = (JSON.parse(window.localStorage.getItem("scout-iq.team") ?? "{}") as { plan: { bankAdjust: Record<string, number>; transfers: number } }).plan;
      expect(saved.bankAdjust).toEqual({ "11": -0.2 });
      expect(saved.transfers).toBe(1); // the first gameweek's, what the chat sends
    });

    it("shows hits beyond the free transfers and blocks buys over budget", async () => {
      const { user } = await loaded();
      await user.click(screen.getByRole("button", { name: "Remove Rudoni" })); // 4.5 + 0.9 in the bank
      expect(
        within(screen.getByRole("list", { name: "MIDs to buy" })).getByRole("button", { name: "Buy Mbeumo" }),
      ).toHaveTextContent("£2.6m short");
      await user.click(screen.getByRole("button", { name: "Buy Cheapo" }));
      await user.click(screen.getByRole("button", { name: "Remove Konsa" }));
      await user.click(screen.getByRole("button", { name: "Buy De Cuyper" }));
      await user.click(screen.getByRole("button", { name: "Remove Semenyo" }));
      await user.click(screen.getByRole("button", { name: "Buy Doku" }));
      expect(stat("Transfers")).toBe("3");
      expect(stat("Free transfers left")).toBe("0 of 2");
      expect(stat("Hits")).toBe("−4");
      // 54.6 - Konsa 3.0 + De Cuyper 3.6 - Semenyo 3.9 + Doku 4.4 = 55.7, minus the hit.
      expect(points()).toBe("51.7");
    });

    it("substitutes, changes the captain and vice, and Optimise restores the best XI", async () => {
      const { user } = await loaded();
      await user.click(screen.getByRole("button", { name: "Select Konsa" }));
      await user.click(screen.getByRole("button", { name: "Select Dubravka" })); // DEF for GK: not allowed
      expect(screen.getByRole("alert")).toHaveTextContent("A goalkeeper can only swap with a goalkeeper.");
      await user.click(screen.getByRole("button", { name: "Select Egan" }));
      expect(points()).toBe("52.8"); // Konsa 3.0 off, Egan 1.2 on
      const bench = screen.getByRole("list", { name: "Bench" });
      expect(
        within(bench)
          .getAllByRole("listitem")
          .map((li) => li.getAttribute("aria-label")),
      ).toEqual(["Dubravka, bench 1", "Rudoni, bench 2", "Konsa, bench 3", "Thomas, bench 4"]);
      // Bench order: Thomas before Rudoni.
      await user.click(screen.getByRole("button", { name: "Select Thomas" }));
      await user.click(screen.getByRole("button", { name: "Select Rudoni" }));
      expect(
        within(bench)
          .getAllByRole("listitem")
          .map((li) => li.getAttribute("aria-label"))[1],
      ).toBe("Thomas, bench 2");

      await user.click(screen.getByRole("button", { name: "Select Palmer" }));
      await user.click(screen.getByRole("button", { name: "Make captain" }));
      expect(screen.getByRole("listitem", { name: "Palmer, captain" })).toBeInTheDocument();
      expect(points()).toBe("50.4"); // 52.8 - 7.1 + 4.7
      await user.click(screen.getByRole("button", { name: "Select Haaland" }));
      await user.click(screen.getByRole("button", { name: "Make vice-captain" }));
      expect(screen.getByRole("listitem", { name: "Haaland, vice-captain" })).toBeInTheDocument();
      expect(screen.getByRole("listitem", { name: "Isak" })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Optimise" }));
      expect(points()).toBe("54.6");
      expect(screen.getByRole("listitem", { name: "Haaland, captain" })).toBeInTheDocument();
      expect(screen.queryByText(/Unsaved changes/)).not.toBeInTheDocument();
    });

    it("saves transfers (the chat and analysis use them) and Reset goes back to the loaded squad", async () => {
      const { user, api } = await loaded();
      await user.click(screen.getByRole("button", { name: "Remove Semenyo" }));
      await user.click(screen.getByRole("button", { name: "Buy Mbeumo" }));
      const ids = SQUAD_IDS.map((x) => (x === 23 ? 53 : x)).sort((a, b) => a - b);
      await waitFor(() => {
        expect(api.callsTo("/api/team/analyze").at(-1)?.body).toEqual({
          player_ids: ids,
          bank: 0.4,
          free_transfers: 1,
          horizon: 5,
          include_pairs: true,
        });
      });
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByText("Saved, 1 transfer made")).toBeInTheDocument();
      expect(JSON.parse(window.localStorage.getItem("scout-iq.team") ?? "{}")).toMatchObject({
        playerIds: SQUAD_IDS,
        plan: { transfers: 1, bankDelta: -0.5 },
      });
      expect(screen.getByText(/with your 1 saved transfer/)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Who should I sell this week?" }));
      await screen.findByText("OK.");
      const sent = (api.callsTo("/api/chat")[0]?.body as { team: { player_ids: number[] } }).team;
      expect(sent).toMatchObject({ bank: 0.4, free_transfers: 1 });
      expect([...sent.player_ids].sort((a, b) => a - b)).toEqual(ids);

      await user.click(screen.getByRole("button", { name: "Reset" }));
      expect(await screen.findByRole("button", { name: "Select Semenyo" })).toBeInTheDocument();
      expect(stat("Free transfers left")).toBe("2 of 2");
      expect(JSON.parse(window.localStorage.getItem("scout-iq.team") ?? "{}")).toMatchObject({ plan: null });
    });

    it("tries a suggested transfer on the pitch", async () => {
      const { user } = await loaded();
      await user.click(
        await screen.findByRole("button", {
          name: "Try: Sell Rudoni, buy Barry",
        }),
      );
      expect(screen.getByRole("listitem", { name: "Barry, bench 2" })).toBeInTheDocument();
      expect(stat("Transfers")).toBe("1");
    });
  });
});
