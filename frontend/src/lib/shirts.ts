/**
 * Where shirt images come from: the one place to change to self-drawn SVG shirts later.
 *
 * These are FPL's own kit images (Premier League-licensed): fine for a personal tool, but replace
 * them before hosting the site publicly. FPL keys them by the team *code* from bootstrap-static's
 * `teams` (Arsenal = 3), not the team id a player's `team` field holds; the backend sends `team_code`.
 */
const BASE = "https://fantasy.premierleague.com/dist/img/shirts/standard";

/** Image widths FPL serves (heights are ~4/3 of these). */
export const SHIRT_WIDTHS = [66, 110, 220] as const;
export const SHIRT_ASPECT = 145 / 110; // height / width

/** The smallest source at least `displayWidth` x 2 wide (sharp on high-DPI screens). */
export function shirtSourceWidth(displayWidth: number): (typeof SHIRT_WIDTHS)[number] {
  return SHIRT_WIDTHS.find((w) => w >= displayWidth * 2) ?? 220;
}

/** e.g. shirtUrl(3, false, 40) -> .../shirt_3-110.webp; goalkeepers get the "_1" kit. */
export function shirtUrl(teamCode: number, isGoalkeeper: boolean, displayWidth: number): string {
  return `${BASE}/shirt_${teamCode}${isGoalkeeper ? "_1" : ""}-${shirtSourceWidth(displayWidth)}.webp`;
}
