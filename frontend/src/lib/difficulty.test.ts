import { FDR_TEAMS, rated } from "../test/fixtureDifficulty";
import { describe as explain, levelOf, readView, sortTeams, writeView } from "./difficulty";

const order = (mode: "overall" | "attack" | "defence", o: "easiest" | "hardest" = "easiest") =>
  sortTeams(FDR_TEAMS, mode, o).map((t) => t.short_name);

describe("difficulty", () => {
  it("maps scores to five levels, 1.00 being medium", () => {
    expect([1.3, 1.2, 1.1, 1.0, 0.93, 0.9, 0.82, 0.6].map(levelOf)).toEqual([1, 1, 2, 3, 3, 4, 4, 5]);
  });

  it("sorts by the summed run of the chosen mode, easiest or hardest first", () => {
    expect(order("overall")).toEqual(["LIV", "ARS", "CHE", "SUN"]); // the double gameweek helps LIV
    expect(order("attack")).toEqual(["ARS", "LIV", "CHE", "SUN"]);
    expect(order("defence")).toEqual(["CHE", "LIV", "ARS", "SUN"]);
    expect(order("overall", "hardest")).toEqual(["SUN", "CHE", "ARS", "LIV"]);
  });

  it("reads and writes the URL, leaving defaults out", () => {
    expect(readView(new URLSearchParams())).toEqual({ mode: "overall", order: "easiest", teams: null });
    const v = readView(new URLSearchParams("mode=defence&order=hardest&teams=ars,%20CHE"));
    expect(v).toEqual({ mode: "defence", order: "hardest", teams: ["ARS", "CHE"] });
    expect(writeView(v).toString()).toBe("mode=defence&order=hardest&teams=ARS%2CCHE");
    expect(writeView({ mode: "overall", order: "easiest", teams: null }).toString()).toBe("");
    expect(readView(new URLSearchParams("mode=nonsense")).mode).toBe("overall");
  });

  it("explains a fixture with the numbers behind its colour", () => {
    const text = explain(rated("SUN", true, 1.4, 0.8), "attack");
    expect(text).toContain("Home v SUN FC: very easy (Attack)");
    expect(text).toContain("Attack 1.40 · xG for 2.06");
    expect(text).toContain("Defense 0.80 · xG against 1.00, clean sheet 37%");
  });
});
