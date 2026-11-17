import { screen, waitFor, within } from "@testing-library/react";
import { json, mockApi } from "../../test/mockApi";
import { comparison, PLAYERS, predictions, status } from "../../test/fixtures";
import { renderApp } from "../../test/render";

const box = (name: string) => screen.getByRole("checkbox", { name: `Select ${name} to compare` });

describe("compare", () => {
  it("needs 2 players, compares by full name and shows side-by-side cards", async () => {
    const [haaland, saka] = PLAYERS as [(typeof PLAYERS)[0], (typeof PLAYERS)[0]];
    const api = mockApi({
      "GET /api/status": status(),
      "GET /api/predictions": predictions(),
      "GET /api/compare": comparison([haaland, saka]),
    });
    const { user } = renderApp();
    await screen.findByText("Haaland");

    const button = screen.getByRole("button", { name: "Compare selected" });
    expect(button).toBeDisabled();
    await user.click(box("Haaland"));
    expect(button).toBeDisabled();
    await user.click(box("Saka"));
    expect(screen.getByRole("button", { name: "Compare 2 players" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Compare 2 players" }));

    const panel = await screen.findByRole("region", { name: "Comparison" });
    await waitFor(() => {
      expect(within(panel).getAllByRole("article")).toHaveLength(2);
    });
    expect(api.callsTo("/api/compare")[0]?.url.searchParams.getAll("names")).toEqual(["Erling Haaland", "Bukayo Saka"]);

    const card = within(panel).getByRole("article", { name: "Saka" });
    expect(card).toHaveTextContent("ARS · MID · £10.2m · TOT (A)");
    expect(card).toHaveTextContent("xPts4.50");
    expect(card).toHaveTextContent("Avg pts, last 56.40");
    expect(card).toHaveTextContent("Avg mins, last 388.3");
    expect(card).toHaveTextContent("Avg xGI, last 50.81");
    expect(card).toHaveTextContent("Season avg pts5.90");
    expect(card).toHaveTextContent("75% · doubtful");
    expect(card).toHaveTextContent("Hamstring - 75% chance of playing");
    expect(screen.getByRole("heading", { name: "Comparison" })).toHaveFocus();

    await user.click(within(panel).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region", { name: "Comparison" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compare 2 players" })).toHaveFocus();
  });

  it("shows names the backend found ambiguous or couldn't find", async () => {
    const [haaland] = PLAYERS as [(typeof PLAYERS)[0]];
    mockApi({
      "GET /api/status": status(),
      "GET /api/predictions": predictions(),
      "GET /api/compare": comparison([haaland], {
        ambiguous: { Gabriel: ["Gabriel (ARS, DEF, £6.1m)", "Gabriel Martinelli (ARS, MID, £7.0m)"] },
        not_found: ["Cole Palmer"],
      }),
    });
    const { user } = renderApp();
    await screen.findByText("Haaland");
    await user.click(box("Haaland"));
    await user.click(box("Gabriel"));
    await user.click(box("Palmer"));
    await user.click(screen.getByRole("button", { name: "Compare 3 players" }));

    const note = await screen.findByRole("status");
    expect(note).toHaveTextContent(
      "“Gabriel” matches several players: Gabriel (ARS, DEF, £6.1m), Gabriel Martinelli (ARS, MID, £7.0m). Not shown.",
    );
    expect(note).toHaveTextContent("Not found: “Cole Palmer” (not in this season's squads).");
    expect(screen.getAllByRole("article")).toHaveLength(1);
  });

  it("allows at most 4 players", async () => {
    mockApi({ "GET /api/status": status(), "GET /api/predictions": predictions() });
    const { user } = renderApp();
    await screen.findByText("Haaland");
    for (const n of ["Haaland", "Saka", "Gabriel", "Palmer"]) await user.click(box(n));
    expect(box("Raya")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Compare 4 players" })).toBeEnabled();
    await user.click(box("Palmer"));
    expect(box("Raya")).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Clear 3 selected" }));
    expect(screen.getByRole("button", { name: "Compare selected" })).toBeDisabled();
  });

  it("shows a compare error and closes with Escape", async () => {
    mockApi({
      "GET /api/status": status(),
      "GET /api/predictions": predictions(),
      "GET /api/compare": json(500, { detail: "Internal Server Error" }),
    });
    const { user } = renderApp();
    await screen.findByText("Haaland");
    await user.click(box("Haaland"));
    await user.click(box("Saka"));
    await user.click(screen.getByRole("button", { name: "Compare 2 players" }));
    expect(await screen.findByText("Couldn't compare players: Internal Server Error")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Comparison" })).not.toBeInTheDocument();
  });
});
