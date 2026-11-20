/**
 * Fixture difficulty on the client: colour steps, sorting and the shareable URL state.
 * The ratings themselves are computed in Python (src/scout_iq/difficulty.py); a score of 1.0 is an
 * average fixture and higher is easier, in every mode.
 */
import type { FixtureTeam, RatedFixture } from "../api/endpoints";

export type Mode = "overall" | "attack" | "defence";
export type Order = "easiest" | "hardest";

export const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: "overall", label: "Overall", hint: "Average of attack and defense" },
  { value: "attack", label: "Attack", hint: "How easy it is to score: expected goals for vs. average" },
  { value: "defence", label: "Defense", hint: "How likely a clean sheet is, vs. an average fixture" },
];

/** 1 = very easy ... 5 = very hard. Cut-offs split this season's fixtures roughly 10/20/40/20/10. */
export type Level = 1 | 2 | 3 | 4 | 5;
const CUTS: [number, Level][] = [
  [1.2, 1],
  [1.07, 2],
  [0.93, 3],
  [0.82, 4],
];
export const LEVEL_NAME: Record<Level, string> = {
  1: "Very easy",
  2: "Easy",
  3: "Medium",
  4: "Hard",
  5: "Very hard",
};

export function levelOf(score: number): Level {
  for (const [cut, level] of CUTS) if (score >= cut) return level;
  return 5;
}

/** Fill + text colour per level. Full class names, so Tailwind sees them. */
export const LEVEL_FILL: Record<Level, string> = {
  1: "bg-fdr-1 text-fdr-1-ink",
  2: "bg-fdr-2 text-fdr-2-ink",
  3: "bg-fdr-3 text-fdr-3-ink",
  4: "bg-fdr-4 text-fdr-4-ink",
  5: "bg-fdr-5 text-fdr-5-ink",
};

/**
 * One team's level in one gameweek: null for a blank, undefined if the team or gameweek is unknown.
 * A double gameweek gets the level of its average score (one colour for one player chip).
 */
export function gameweekLevel(team: FixtureTeam | undefined, gameweek: number, mode: Mode): Level | null | undefined {
  const cell = team?.gameweeks.find((c) => c.gameweek === gameweek);
  if (!cell) return undefined;
  if (cell.fixtures.length === 0) return null;
  return levelOf(cell.fixtures.reduce((s, f) => s + scoreOf(f, mode), 0) / cell.fixtures.length);
}

export const scoreOf = (f: RatedFixture, mode: Mode): number => f[mode];

/**
 * Easiest run first (highest summed score). Sums, not averages: a double gameweek is two chances to
 * score and a blank is none, so a blank must pull the run down.
 */
export function sortTeams(teams: readonly FixtureTeam[], mode: Mode, order: Order): FixtureTeam[] {
  const sign = order === "easiest" ? -1 : 1;
  return [...teams].sort(
    (a, b) => sign * (a.totals[mode] - b.totals[mode]) || a.short_name.localeCompare(b.short_name),
  );
}

export const label = (f: RatedFixture) => `${f.opponent} (${f.home ? "H" : "A"})`;

/** What the hover shows: the numbers behind the colour. */
export function describe(f: RatedFixture, mode: Mode): string {
  const pct = Math.round(f.cs_chance * 100);
  return [
    `${f.home ? "Home" : "Away"} v ${f.opponent_name}: ${LEVEL_NAME[levelOf(scoreOf(f, mode))].toLowerCase()} (${MODES.find((m) => m.value === mode)?.label ?? mode})`,
    `Attack ${f.attack.toFixed(2)} · xG for ${f.xg_for.toFixed(2)}`,
    `Defense ${f.defence.toFixed(2)} · xG against ${f.xg_against.toFixed(2)}, clean sheet ${pct}%`,
    `Overall ${f.overall.toFixed(2)} (1.00 = average fixture)`,
  ].join("\n");
}

// ---- URL state: ?mode=attack&order=hardest&teams=ARS,CHE (defaults are left out) ----

export interface View {
  mode: Mode;
  order: Order;
  /** null = every team. */
  teams: string[] | null;
}

const isMode = (x: string | null): x is Mode => x === "overall" || x === "attack" || x === "defence";

export function readView(params: URLSearchParams): View {
  const mode = params.get("mode");
  const teams = params.get("teams");
  return {
    mode: isMode(mode) ? mode : "overall",
    order: params.get("order") === "hardest" ? "hardest" : "easiest",
    teams:
      teams === null
        ? null
        : teams
            .split(",")
            .map((t) => t.trim().toUpperCase())
            .filter(Boolean),
  };
}

export function writeView(v: View): URLSearchParams {
  const p = new URLSearchParams();
  if (v.mode !== "overall") p.set("mode", v.mode);
  if (v.order !== "easiest") p.set("order", v.order);
  if (v.teams !== null) p.set("teams", v.teams.join(","));
  return p;
}
