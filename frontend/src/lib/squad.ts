/** FPL squad rules, checked in the browser while picking by hand (the backend checks them again). */

export const SQUAD_SHAPE = { GK: 2, DEF: 5, MID: 5, FWD: 3 } as const;
export type Position = keyof typeof SQUAD_SHAPE;
export const POSITION_ORDER: Position[] = ["GK", "DEF", "MID", "FWD"];
export const MAX_PER_CLUB = 3;

export interface Pickable {
  id: number;
  position: string;
  team: string;
}

export function isPosition(p: string): p is Position {
  return p in SQUAD_SHAPE;
}

/** Problems that stop a squad from being analysed; empty = valid. */
export function squadErrors(picked: readonly Pickable[]): string[] {
  const errors: string[] = [];
  for (const pos of POSITION_ORDER) {
    const have = picked.filter((p) => p.position === pos).length;
    const need = SQUAD_SHAPE[pos];
    if (have < need) errors.push(`Pick ${need - have} more ${pos} (${have}/${need}).`);
    if (have > need) errors.push(`Too many ${pos}: ${have}/${need}.`);
  }
  const clubs = new Map<string, number>();
  for (const p of picked) clubs.set(p.team, (clubs.get(p.team) ?? 0) + 1);
  for (const [team, n] of clubs) {
    if (n > MAX_PER_CLUB) errors.push(`At most ${MAX_PER_CLUB} players per club: ${n} from ${team}.`);
  }
  return errors;
}

/** Why a player can't be added right now, or null if he can. */
export function cannotAdd(picked: readonly Pickable[], p: Pickable): string | null {
  if (picked.some((x) => x.id === p.id)) return "already picked";
  if (!isPosition(p.position)) return "unknown position";
  if (picked.filter((x) => x.position === p.position).length >= SQUAD_SHAPE[p.position]) return `${p.position} full`;
  return null;
}
