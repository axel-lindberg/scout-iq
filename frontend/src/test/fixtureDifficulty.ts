import type { FixtureTeam, FixturesResponse, RatedFixture } from "../api/endpoints";

export const FDR_GAMEWEEKS = [11, 12, 13];

export function rated(opponent: string, home: boolean, attack: number, defence: number): RatedFixture {
  return {
    opponent,
    opponent_name: `${opponent} FC`,
    home,
    kickoff_time: "2026-11-21T15:00:00+00:00",
    xg_for: attack * 1.47,
    xg_against: 1.0,
    cs_chance: 0.37,
    attack,
    defence,
    overall: (attack + defence) / 2,
  };
}

function team(id: number, short: string, cells: RatedFixture[][]): FixtureTeam {
  const sum = (k: "attack" | "defence" | "overall") => cells.flat().reduce((s, f) => s + f[k], 0);
  return {
    id,
    short_name: short,
    name: `${short} United`,
    code: id + 100,
    strength: { attack: 1.4, defence: 1.4, matches: 10 },
    totals: { overall: sum("overall"), attack: sum("attack"), defence: sum("defence") },
    gameweeks: cells.map((fixtures, i) => ({ gameweek: FDR_GAMEWEEKS[i] ?? 0, fixtures })),
  };
}

/**
 * ARS: easy to score against, hard clean sheets. CHE: the opposite. LIV: a double in GW 12.
 * SUN: a blank in GW 13 (lowest run).
 */
export const FDR_TEAMS: FixtureTeam[] = [
  team(1, "ARS", [[rated("SUN", true, 1.4, 0.8)], [rated("LIV", false, 1.3, 0.8)], [rated("CHE", true, 1.3, 0.9)]]),
  team(2, "CHE", [[rated("LIV", true, 0.7, 1.3)], [rated("SUN", false, 0.9, 1.3)], [rated("ARS", false, 0.8, 1.4)]]),
  team(3, "LIV", [
    [rated("CHE", false, 0.9, 0.9)],
    [rated("ARS", true, 1.0, 1.0), rated("SUN", false, 1.0, 1.0)],
    [rated("SUN", true, 1.0, 1.0)],
  ]),
  team(4, "SUN", [[rated("ARS", false, 0.7, 0.7)], [rated("CHE", true, 1.0, 1.0)], []]),
];

export function fixtures(teams: FixtureTeam[] = FDR_TEAMS): FixturesResponse {
  return { gameweeks: FDR_GAMEWEEKS, league_xg: 1.47, home_factor: 1.078, half_life: 12, prior_matches: 5, teams };
}
