import { screen, waitFor, within } from "@testing-library/react";
import { json, mockApi } from "../../test/mockApi";
import { PLAYERS, predictions, status } from "../../test/fixtures";
import { renderApp } from "../../test/render";

const table = () => screen.getByRole("table");
const rowNames = () =>
  within(table())
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("cell")[1]?.textContent);

describe("predictions table", () => {
  it("renders players with price, expected points and availability", async () => {
    mockApi({ "GET /api/status": status(), "GET /api/predictions": predictions() });
    renderApp();

    expect(await screen.findByText("Haaland")).toBeInTheDocument();
    expect(rowNames()).toEqual(["Haaland MCI", "Saka ARS", "Gabriel ARS", "Palmer CHE", "Raya ARS"]);
    const saka = screen.getByText("Saka").closest("tr");
    if (!saka) throw new Error("no row");
    expect(within(saka).getByText("10.2")).toBeInTheDocument();
    expect(within(saka).getByText("4.50")).toBeInTheDocument();
    expect(within(saka).getByText("TOT (A)")).toBeInTheDocument();
    expect(within(saka).getByText("MID")).toBeInTheDocument();
    // Fit players say so; doubtful ones show chance + status, with the news as an accessible tooltip.
    expect(within(screen.getByText("Haaland").closest("tr") ?? document.body).getByText("Fit")).toBeInTheDocument();
    const badge = within(saka).getByRole("button", { name: "75% · doubtful" });
    expect(badge).toHaveAccessibleDescription("Hamstring - 75% chance of playing");
  });

  it("shows the news tooltip on keyboard focus", async () => {
    mockApi({ "GET /api/status": status(), "GET /api/predictions": predictions() });
    const { user } = renderApp();
    const badge = await screen.findByRole("button", { name: "75% · doubtful" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(); // hidden until needed
    badge.focus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Hamstring - 75% chance of playing");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("asks for the top 30 and sends the position filter straight away", async () => {
    const api = mockApi({ "GET /api/status": status(), "GET /api/predictions": predictions() });
    const { user } = renderApp();
    await screen.findByText("Haaland");
    expect(api.callsTo("/api/predictions")[0]?.url.searchParams.toString()).toBe("top_n=30&horizon=5");

    await user.selectOptions(screen.getByLabelText("Position"), "DEF");
    await waitFor(() => {
      expect(api.callsTo("/api/predictions").at(-1)?.url.searchParams.get("position")).toBe("DEF");
    });
  });

  it("debounces the team and price filters into one request each", async () => {
    const api = mockApi({ "GET /api/status": status(), "GET /api/predictions": predictions() });
    const { user } = renderApp();
    await screen.findByText("Haaland");

    await user.type(screen.getByLabelText("Team"), "ars");
    await waitFor(() => {
      expect(api.callsTo("/api/predictions").at(-1)?.url.searchParams.get("team")).toBe("ars");
    });
    const teams = api.callsTo("/api/predictions").map((c) => c.url.searchParams.get("team"));
    expect(teams).toEqual([null, "ars"]); // not "a", "ar", "ars"

    await user.type(screen.getByLabelText("Max £m"), "6.5");
    await waitFor(() => {
      const last = api.callsTo("/api/predictions").at(-1)?.url.searchParams;
      expect(last?.get("max_price")).toBe("6.5");
      expect(last?.get("team")).toBe("ars");
    });
  });

  it("doesn't send a price of zero, which the API would reject", async () => {
    const api = mockApi({ "GET /api/status": status(), "GET /api/predictions": predictions() });
    const { user } = renderApp();
    await screen.findByText("Haaland");
    await user.type(screen.getByLabelText("Max £m"), "0");
    await new Promise((r) => setTimeout(r, 400));
    expect(api.callsTo("/api/predictions").every((c) => !c.url.searchParams.has("max_price"))).toBe(true);
  });

  it("shows the next gameweeks, faded further ahead, with blanks and a total", async () => {
    mockApi({ "GET /api/status": status(), "GET /api/predictions": predictions() });
    renderApp();
    const haaland = (await screen.findByText("Haaland")).closest("tr");
    if (!haaland) throw new Error("no row");
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(expect.arrayContaining(["GW12", "GW13", "GW14", "GW15", "5 GWs"]));
    expect(screen.getByRole("columnheader", { name: "GW15" })).toHaveAttribute("title", expect.stringContaining("less certain"));
    expect(within(haaland).getByText("6.1")).toBeInTheDocument(); // GW 12: 7.1 - 1
    expect(within(haaland).getByText("LIV (H)")).toBeInTheDocument();
    expect(within(haaland).getByText("blank")).toBeInTheDocument(); // GW 13: MCI blank
    expect(within(haaland).getByText("27.4")).toBeInTheDocument(); // 7.1 + 6.1 + 0 + 7.1 + 7.1
  });

  it("can rank by the next five gameweeks", async () => {
    const api = mockApi({ "GET /api/status": status(), "GET /api/predictions": predictions() });
    const { user } = renderApp();
    await screen.findByText("Haaland");
    await user.selectOptions(screen.getByLabelText("Rank by"), "horizon");
    await waitFor(() => {
      expect(api.callsTo("/api/predictions").at(-1)?.url.searchParams.get("rank_by")).toBe("horizon");
    });
  });

  it("still works when the API sends only the next gameweek", async () => {
    mockApi({ "GET /api/status": status(), "GET /api/predictions": predictions(PLAYERS, false) });
    renderApp();
    await screen.findByText("Haaland");
    expect(screen.queryByRole("columnheader", { name: "GW12" })).not.toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    mockApi({ "GET /api/status": status(), "GET /api/predictions": predictions([]) });
    renderApp();
    expect(await screen.findByText("No players match these filters.")).toBeInTheDocument();
  });

  it("shows a loading state, then the API's error message, and can retry", async () => {
    let fail = true;
    mockApi({
      "GET /api/status": status(),
      "GET /api/predictions": () => (fail ? json(500, { detail: "Model not loaded" }) : predictions()),
    });
    const { user } = renderApp();
    expect(screen.getByText("Loading predictions…")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load predictions: Model not loaded");

    fail = false;
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Haaland")).toBeInTheDocument();
  });

  it("turns FastAPI validation errors into a readable message", async () => {
    mockApi({
      "GET /api/status": status(),
      "GET /api/predictions": json(422, {
        detail: [{ type: "greater_than", loc: ["query", "max_price"], msg: "Input should be greater than 0" }],
      }),
    });
    renderApp();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid request (max_price: Input should be greater than 0)",
    );
  });

  it("explains when the server can't be reached at all", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    renderApp();
    expect(await screen.findByText("Couldn't reach the server")).toBeInTheDocument();
    expect(await screen.findByText(/Couldn't load predictions: Couldn't reach the server/)).toBeInTheDocument();
    expect(PLAYERS.length).toBeGreaterThan(0);
  });
});
