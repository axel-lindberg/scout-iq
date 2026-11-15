import type { ComparedPlayer, Comparison, Player, Predictions, Status } from "../api/endpoints";

export function status(overrides: Partial<Status> = {}): Status {
  return {
    season: "2026-27",
    gameweek: 11,
    first_kickoff: "2026-11-22T12:30:00+00:00",
    data_through_gw: 10,
    chat_available: true,
    news_available: true,
    model_card: {
      test_season: "2025-26",
      evaluation: "walk-forward, retrained before every gameweek",
      mae: { LightGBM: 1.877, "season average to date": 1.994 },
      captain_points_per_gw: { LightGBM: 6.97, "season average to date": 6.22 },
    },
    ...overrides,
  };
}

export function player(overrides: Partial<Player> = {}): Player {
  return {
    name: "Haaland",
    full_name: "Erling Haaland",
    team: "MCI",
    position: "FWD",
    price: 15.0,
    fixtures: "BUR (H)",
    expected_points: 7.1,
    expected_points_adjusted: 7.1,
    chance_of_playing: 100,
    status: "available",
    news: null,
    ...overrides,
  };
}

export const PLAYERS: Player[] = [
  player(),
  player({
    name: "Saka",
    full_name: "Bukayo Saka",
    team: "ARS",
    position: "MID",
    price: 10.2,
    fixtures: "TOT (A)",
    expected_points: 6.0,
    expected_points_adjusted: 4.5,
    chance_of_playing: 75,
    status: "doubtful",
    news: "Hamstring - 75% chance of playing",
  }),
  player({ name: "Gabriel", full_name: "Gabriel dos Santos", team: "ARS", position: "DEF", price: 6.1, expected_points: 4.2, expected_points_adjusted: 4.2, fixtures: "TOT (A)" }),
  player({ name: "Palmer", full_name: "Cole Palmer", team: "CHE", position: "MID", price: 10.5, expected_points: 4.0, expected_points_adjusted: 4.0, fixtures: "WHU (H)" }),
  player({ name: "Raya", full_name: "David Raya Martín", team: "ARS", position: "GK", price: 5.6, expected_points: 3.9, expected_points_adjusted: 3.9, fixtures: "TOT (A)" }),
];

export function predictions(players: Player[] = PLAYERS): Predictions {
  return { gameweek: 11, season: "2026-27", players };
}

export function compared(p: Player): ComparedPlayer {
  return {
    ...p,
    recent_form: { avg_points_last5: 6.4, avg_minutes_last3: 88.3, avg_xgi_last5: 0.81, season_avg_points: 5.9, matches_played: 10 },
  };
}

export function comparison(players: Player[], extra: Partial<Comparison> = {}): Comparison {
  return { gameweek: 11, players: players.map(compared), ...extra };
}
