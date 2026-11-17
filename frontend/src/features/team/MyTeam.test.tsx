import { screen, waitFor, within } from "@testing-library/react";
import { json, mockApi } from "../../test/mockApi";
import { predictions, status } from "../../test/fixtures";
import { renderApp } from "../../test/render";
import { playerOptions, SQUAD_IDS, teamAnalysis } from "../../test/teamFixtures";

const base = { "GET /api/status": status(), "GET /api/predictions": predictions() };

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
    const pitch = screen.getByRole("figure", { name: "Best XI for gameweek 11" });
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
    const api = mockApi({ ...base, "GET /api/players": playerOptions(), "POST /api/team/analyze": teamAnalysis({ source: "manual", entry: null }) });
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
    expect(screen.getByLabelText("FPL team ID")).toHaveValue("1234567");
    await user.click(screen.getByRole("button", { name: "Forget this team" }));
    expect(screen.queryByText("Sample XI")).not.toBeInTheDocument();
  });
});
