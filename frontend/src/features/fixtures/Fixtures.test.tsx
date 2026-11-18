import { screen, waitFor, within } from "@testing-library/react";
import { mockApi } from "../../test/mockApi";
import { status } from "../../test/fixtures";
import { fixtures } from "../../test/fixtureDifficulty";
import { renderApp } from "../../test/render";

const teamRows = () =>
  within(screen.getByRole("table"))
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).queryByRole("rowheader")?.textContent ?? r.textContent);

function setup(path = "/fixtures") {
  mockApi({ "GET /api/status": status(), "GET /api/fixtures": fixtures() });
  return renderApp(path);
}

describe("fixture difficulty page", () => {
  it("shows every team's run, with doubles stacked and blanks marked", async () => {
    setup();
    await screen.findByRole("table");
    expect(teamRows()).toEqual(["LIV LIV United", "ARS ARS United", "CHE CHE United", "SUN SUN United"]);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Team",
      "Run",
      "GW 11",
      "GW 12",
      "GW 13",
    ]);
    const liv = screen.getByRole("row", { name: /^LIV/ });
    const cells = within(liv).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("3.90"); // run total, 4 matches
    expect(cells[0]).toHaveTextContent("4 matches");
    expect(within(cells[2] as HTMLElement).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "ARS (H)",
      "SUN (A)",
    ]);
    const sun = screen.getByRole("row", { name: /^SUN/ });
    expect(within(sun).getAllByRole("cell")[3]).toHaveTextContent("Blank gameweek");
  });

  it("switches mode and order, which re-sorts, recolours and lands in the URL", async () => {
    const { user, router } = setup();
    await screen.findByRole("table");
    const ars = () => within(screen.getByRole("row", { name: /^ARS/ })).getAllByRole("button")[0];
    expect(ars()).toHaveClass("bg-fdr-2"); // overall 1.10: easy
    await user.click(screen.getByRole("radio", { name: "Attack" }));
    expect(teamRows()[0]).toMatch(/^ARS/);
    expect(ars()).toHaveClass("bg-fdr-1"); // attack 1.40: very easy
    await user.click(screen.getByRole("radio", { name: "Defense" }));
    expect(teamRows()[0]).toMatch(/^CHE/);
    expect(ars()).toHaveClass("bg-fdr-5"); // defence 0.80: very hard
    await user.selectOptions(screen.getByLabelText("Sort"), "hardest");
    expect(teamRows()[0]).toMatch(/^SUN/);
    expect(router.state.location.search).toBe("?mode=defence&order=hardest");
  });

  it("shows the numbers on hover", async () => {
    const { user } = setup();
    await screen.findByRole("table");
    const button = within(screen.getByRole("row", { name: /^ARS/ })).getAllByRole("button")[0] as HTMLElement;
    await user.hover(button);
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent("Home v SUN FC");
    expect(tip).toHaveTextContent("Attack 1.40 · xG for 2.06");
    expect(button).toHaveAccessibleDescription(/clean sheet 37%/);
  });

  it("compares a subset of teams, keeps the sort, and can be shared via the URL", async () => {
    const { user, router } = setup();
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText(/No teams selected/)).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /CHE/ }));
    await user.click(screen.getByRole("checkbox", { name: /ARS/ }));
    expect(teamRows()).toEqual(["ARS ARS United", "CHE CHE United"]);
    expect(screen.getByRole("group", { name: /Teams/ })).toHaveTextContent("2 of 4");
    expect(router.state.location.search).toBe("?teams=ARS%2CCHE");

    await user.type(screen.getByRole("searchbox", { name: "Search teams" }), "liv");
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Show all" }));
    expect(teamRows()).toHaveLength(4);
    expect(router.state.location.search).toBe("");
  });

  it("restores a shared comparison from the URL", async () => {
    setup("/fixtures?mode=attack&order=hardest&teams=ARS,LIV,XXX");
    await waitFor(() => {
      expect(teamRows()).toEqual(["LIV LIV United", "ARS ARS United"]);
    });
    expect(screen.getByRole("radio", { name: "Attack" })).toBeChecked();
    expect(screen.getByLabelText("Sort")).toHaveValue("hardest");
  });

  it("is in the header navigation", async () => {
    const { user, router } = setup("/");
    await user.click(await screen.findByRole("link", { name: "Fixtures" }));
    expect(router.state.location.pathname).toBe("/fixtures");
  });
});
