import type { PlayersResponse, SquadPlayer, SquadPlayerBrief, TeamAnalysis, Transfer } from "../api/endpoints";

const GWS = [11, 12, 13, 14, 15];

/** id, name, team, position, price, next-GW xPts. 2 GK, 5 DEF, 5 MID, 3 FWD. */
export const SQUAD: [number, string, string, string, number, number][] = [
  [1, "Raya", "ARS", "GK", 5.6, 3.9],
  [2, "Dubravka", "BUR", "GK", 4.0, 2.1],
  [10, "Gabriel", "ARS", "DEF", 6.1, 4.2],
  [11, "Virgil", "LIV", "DEF", 6.0, 3.8],
  [12, "Munoz", "CRY", "DEF", 5.4, 3.5],
  [13, "Konsa", "AVL", "DEF", 4.6, 3.0],
  [14, "Egan", "SUN", "DEF", 4.0, 1.2],
  [20, "Saka", "ARS", "MID", 10.2, 4.5],
  [21, "Palmer", "CHE", "MID", 10.5, 4.7],
  [22, "Rogers", "AVL", "MID", 7.1, 4.0],
  [23, "Semenyo", "BOU", "MID", 7.5, 3.9],
  [24, "Rudoni", "SHU", "MID", 4.5, 0.4],
  [30, "Haaland", "MCI", "FWD", 15.0, 7.1],
  [31, "Isak", "LIV", "FWD", 10.0, 4.9],
  [32, "Thomas", "COV", "FWD", 4.5, 0.9],
];
export const SQUAD_IDS = SQUAD.map((p) => p[0]);
const BENCH = [2, 24, 14, 32];

function brief(p: (typeof SQUAD)[number]): SquadPlayerBrief {
  const [id, name, team, position, price, x] = p;
  return {
    id,
    name,
    team,
    position,
    price,
    availability: name === "Saka" ? "doubtful" : "fit",
    news: name === "Saka" ? "Hamstring - 75% chance of playing" : null,
    expected_points: GWS.map(() => x),
    expected_points_horizon_adjusted: Math.round(x * 5 * 100) / 100,
  };
}

function squadPlayer(p: (typeof SQUAD)[number]): SquadPlayer {
  const b = brief(p);
  return {
    ...b,
    full_name: `${b.name} Full`,
    chance_of_playing: b.name === "Saka" ? 75 : 100,
    status: b.name === "Saka" ? "doubtful" : "available",
    gameweeks: GWS.map((gw) => ({
      gameweek: gw,
      fixtures: gw === 13 && b.team === "MCI" ? "" : "TOT (H)",
      expected_points: b.expected_points[0] ?? 0,
      expected_points_adjusted: b.expected_points[0] ?? 0,
    })),
    in_xi: !BENCH.includes(b.id),
    bench_order: BENCH.includes(b.id) ? BENCH.indexOf(b.id) + 1 : null,
    is_captain: b.id === 30,
    is_vice_captain: b.id === 31,
  };
}

const buy = (id: number, name: string, team: string, position: string, price: number, x: number) =>
  brief([id, name, team, position, price, x]);

function transfer(out: SquadPlayerBrief[], inn: SquadPlayerBrief[], perGw: number[], hits: number, bankAfter: number): Transfer {
  const gain = Math.round(perGw.reduce((a, b) => a + b, 0) * 100) / 100;
  return { out, in: inn, gain_per_gameweek: perGw, gain, hits, net_gain: Math.round((gain - hits) * 100) / 100, bank_after: bankAfter };
}

function byId(id: number): SquadPlayerBrief {
  const p = SQUAD.find((x) => x[0] === id);
  if (!p) throw new Error(`no player ${id} in the fixture squad`);
  return brief(p);
}

export function teamAnalysis(overrides: Partial<TeamAnalysis> = {}): TeamAnalysis {
  const squad = SQUAD.map(squadPlayer);
  const starters = squad.filter((p) => p.in_xi).map((p) => p.id);
  return {
    source: "fpl",
    entry: {
      team_id: 1234567,
      team_name: "Sample XI",
      overall_rank: 1859136,
      picks_gameweek: 10,
      captain: 30,
      vice_captain: 31,
      bank: 0.9,
      squad_value: 102.5,
      free_transfers: 2,
      free_transfers_note: "Estimated from your transfer history (1 per gameweek, up to 5 saved).",
      active_chip: null,
      chips_used: [],
      notes: [],
    },
    player_ids: SQUAD_IDS,
    gameweeks: GWS,
    bank: 0.9,
    free_transfers: 2,
    squad: [...squad.filter((p) => p.in_xi), ...BENCH.flatMap((id) => squad.filter((p) => p.id === id))],
    lineup: { gameweek: 11, formation: "4-4-2", starters, bench: BENCH, captain: 30, vice_captain: 31, expected_points: 54.6 },
    lineups: GWS.map((gw, k) => ({
      gameweek: gw,
      formation: "4-4-2",
      starters,
      bench: BENCH,
      // Haaland blanks in GW 13 (0 xPts): Isak captains instead, 47.5 − 7.1 + 4.9.
      captain: gw === 13 ? 31 : 30,
      vice_captain: gw === 13 ? 21 : 31,
      expected_points: [54.6, 54.6, 45.3, 54.6, 54.6][k] ?? 0,
    })),
    squad_expected_points: [54.6, 54.6, 45.3, 54.6, 54.6],
    perfect_budget: 103.4,
    perfect_teams: GWS.map((gw) => ({
      gameweek: gw,
      player_ids: SQUAD_IDS,
      starters,
      captain: 30,
      cost: 99.5,
      expected_points: 60.4,
    })),
    weakest: [
      { id: 24, name: "Rudoni", reason: "low expected points", expected_points_horizon_adjusted: 2 },
      { id: 20, name: "Saka", reason: "doubtful", expected_points_horizon_adjusted: 22.5 },
    ],
    transfers: [
      transfer([byId(24)], [buy(50, "Barry", "EVE", "MID", 5.4, 4.6)], [1.7, 1.9, 1.1, 1.5, 0.4], 0, 0.0),
      transfer([byId(23)], [buy(51, "Doku", "MCI", "MID", 7.4, 4.4)], [0.9, 1.0, 1.5, 1.5, 1.1], 0, 1.0),
    ],
    transfer_pairs: [
      transfer([byId(13), byId(24)], [buy(52, "De Cuyper", "BHA", "DEF", 4.9, 3.6), buy(50, "Barry", "EVE", "MID", 5.4, 4.6)], [3.0, 3.3, 1.2, 2.8, 2.1], 0, 0.6),
    ],
    warnings: [],
    limitations: [
      "Selling prices aren't in the public FPL API (FPL keeps half of any price rise), so players are valued at today's price.",
      "Free transfers are estimated from your transfer history; override the number if the FPL app differs.",
    ],
    ...overrides,
  };
}

/** FPL team codes (not ids) for some fixture teams. */
const TEAM_CODES: Record<string, number> = { ARS: 3, MCI: 43, LIV: 14, CHE: 8, BUR: 90 };

/** Players to buy (also in the transfer suggestions). */
const BUYS: [number, string, string, string, number, number][] = [
  [50, "Barry", "EVE", "MID", 5.4, 4.6],
  [51, "Doku", "MCI", "MID", 7.4, 4.4],
  [52, "De Cuyper", "BHA", "DEF", 4.9, 3.6],
  [53, "Mbeumo", "MUN", "MID", 8.0, 5.5],
  [54, "Cheapo", "LEI", "MID", 4.5, 1.0],
];

/** /api/players: the squad, players to buy, and three more Arsenal players to break the club limit. */
export function playerOptions(): PlayersResponse {
  const extra: [number, string, string, string, number, number][] = [
    [60, "Saliba", "ARS", "DEF", 6.0, 3.9],
    [61, "Timber", "ARS", "DEF", 5.6, 3.5],
    [62, "Odegaard", "ARS", "MID", 8.0, 3.8],
  ];
  return {
    gameweeks: GWS,
    players: [...SQUAD, ...extra, ...BUYS].map(([id, name, team, position, price, x]) => ({
      id,
      name,
      full_name: `${name} Full`,
      team,
      position,
      price,
      team_code: TEAM_CODES[team] ?? null, // Coventry (COV) has none here: the plain shirt
      status: name === "Saka" ? "doubtful" : "available",
      availability: name === "Saka" ? ("doubtful" as const) : ("fit" as const),
      expected_points: GWS.map((gw) => (gw === 13 && team === "MCI" ? 0 : x)),
      fixtures: GWS.map((gw) => (gw === 13 && team === "MCI" ? "" : "TOT (H)")),
      expected_points_horizon_adjusted: Math.round(x * 5 * 100) / 100,
    })),
  };
}
