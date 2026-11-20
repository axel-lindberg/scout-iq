/**
 * Colour grade for a player's expected points in one gameweek, compared with every other player that
 * gameweek. Same five steps and colours as fixture difficulty (`--fdr-*`), here meaning "how good":
 * top 10% = 1 (dark green), next 20% = 2, middle 40% = 3, next 20% = 4, bottom 10% = 5 (dark red).
 *
 * Only players in contention set the cut-offs (xPts above IN_CONTENTION): hundreds of reserves on
 * ~0 would otherwise make every starter look great. Anyone can still be graded against them.
 */
import type { Level } from "./difficulty";

export const IN_CONTENTION = 0.5;
const QUANTILES = [0.9, 0.7, 0.3, 0.1] as const;

export const GRADE_NAME: Record<Level, string> = {
  1: "Top 10% xPts",
  2: "Top 30% xPts",
  3: "Average xPts",
  4: "Bottom 30% xPts",
  5: "Bottom 10% xPts",
};

/** The xPts a player needs for grades 1-4 (descending), or null with too few players to compare. */
export function gradeCuts(xpts: readonly number[]): number[] | null {
  const pool = xpts.filter((x) => x > IN_CONTENTION).sort((a, b) => a - b);
  if (pool.length < 10) return null;
  return QUANTILES.map((q) => pool[Math.floor(q * (pool.length - 1))] ?? 0);
}

export function gradeOf(x: number, cuts: readonly number[]): Level {
  const k = cuts.findIndex((c) => x >= c);
  return (k < 0 ? 5 : k + 1) as Level;
}
