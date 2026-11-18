/**
 * Planning transfers and the lineup in the browser: a draft of 11 starters + 4 bench slots.
 *
 * Transfers, free transfers and the bank are always counted against the *original* squad (as loaded
 * or picked by hand), never against the last save. So selling a player and buying him back is zero
 * transfers again, and Reset is just "forget the plan".
 */
import { isPosition, MAX_PER_CLUB, type Position } from "./squad";

export const HIT_COST = 4;
export type Part = "xi" | "bench";
export interface SlotRef {
  part: Part;
  index: number;
}
/** `id` is null after the player was removed: the slot keeps its position until someone is bought. */
export interface Slot {
  id: number | null;
  position: Position;
}
/** Captain and vice are xi indexes, so a player bought into a slot inherits its armband. */
export interface Draft {
  xi: Slot[];
  bench: Slot[];
  captain: number;
  vice: number;
}
/** A complete lineup by player ids (what is saved and what the backend's best XI returns). */
export interface Lineup {
  starters: number[];
  bench: number[];
  captain: number;
  vice: number;
}
export interface PlanPlayer {
  id: number;
  name: string;
  position: string;
  team: string;
  price: number;
  expected_points: readonly number[];
}

const MIN_START: Record<Position, number> = { GK: 1, DEF: 3, MID: 2, FWD: 1 };
const POS_NAME: Record<Position, string> = {
  GK: "goalkeeper",
  DEF: "defenders",
  MID: "midfielders",
  FWD: "forward",
};
const round1 = (x: number) => Math.round(x * 10) / 10;

export function draftFromLineup(l: Lineup, positionOf: (id: number) => string): Draft {
  const slot = (id: number): Slot => {
    const p = positionOf(id);
    return { id, position: isPosition(p) ? p : "MID" };
  };
  const captain = Math.max(0, l.starters.indexOf(l.captain));
  let vice = l.starters.indexOf(l.vice);
  if (vice < 0 || vice === captain) vice = captain === 0 ? 1 : 0;
  return { xi: l.starters.map(slot), bench: l.bench.map(slot), captain, vice };
}

/** The lineup by ids, or null while a slot is empty. */
export function lineupOf(d: Draft): Lineup | null {
  const starters = d.xi.map((s) => s.id);
  const bench = d.bench.map((s) => s.id);
  if ([...starters, ...bench].some((x) => x === null)) return null;
  const xi = starters as number[];
  return {
    starters: xi,
    bench: bench as number[],
    captain: xi[d.captain] ?? 0,
    vice: xi[d.vice] ?? 0,
  };
}

export const squadIds = (d: Draft): number[] => [...d.xi, ...d.bench].flatMap((s) => (s.id === null ? [] : [s.id]));
export const emptySlots = (d: Draft): number => [...d.xi, ...d.bench].filter((s) => s.id === null).length;
export const slotAt = (d: Draft, r: SlotRef): Slot | undefined => d[r.part][r.index];
export const sameRef = (a: SlotRef | null, b: SlotRef) => a !== null && a.part === b.part && a.index === b.index;

function withSlot(d: Draft, r: SlotRef, s: Slot): Draft {
  const part = d[r.part].map((x, i) => (i === r.index ? s : x));
  return { ...d, [r.part]: part };
}

export function removeAt(d: Draft, r: SlotRef): Draft {
  const s = slotAt(d, r);
  return s ? withSlot(d, r, { ...s, id: null }) : d;
}

export function fillAt(d: Draft, r: SlotRef, id: number): Draft {
  const s = slotAt(d, r);
  return s ? withSlot(d, r, { ...s, id }) : d;
}

/** Why two slots can't swap (null = they can). Swaps are starter <-> bench or bench <-> bench. */
export function cannotSwap(d: Draft, a: SlotRef, b: SlotRef): string | null {
  const sa = slotAt(d, a);
  const sb = slotAt(d, b);
  if (!sa || !sb || sameRef(a, b)) return "Pick a different player.";
  if (sa.id === null || sb.id === null) return "Fill the empty slot first.";
  if (a.part === "xi" && b.part === "xi") return "Pick a bench player to swap with.";
  if ((sa.position === "GK") !== (sb.position === "GK")) return "A goalkeeper can only swap with a goalkeeper.";
  if (a.part === "bench" && b.part === "bench") return null;
  const [inXi, out] = a.part === "xi" ? [sb, sa] : [sa, sb];
  const counts: Record<Position, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const s of d.xi) counts[s.position] += 1;
  counts[out.position] -= 1;
  counts[inXi.position] += 1;
  for (const pos of ["DEF", "MID", "FWD"] as const) {
    if (counts[pos] < MIN_START[pos]) return `At least ${MIN_START[pos]} ${POS_NAME[pos]} must start.`;
  }
  return null;
}

/** Swap two slots; a starter's armband stays with the xi slot (the player coming on takes it). */
export function swap(d: Draft, a: SlotRef, b: SlotRef): Draft {
  const sa = slotAt(d, a);
  const sb = slotAt(d, b);
  if (!sa || !sb) return d;
  return withSlot(withSlot(d, a, sb), b, sa);
}

export function setCaptain(d: Draft, xiIndex: number): Draft {
  if (xiIndex === d.captain) return d;
  return {
    ...d,
    captain: xiIndex,
    vice: xiIndex === d.vice ? d.captain : d.vice,
  };
}

export function setVice(d: Draft, xiIndex: number): Draft {
  if (xiIndex === d.vice) return d;
  return {
    ...d,
    vice: xiIndex,
    captain: xiIndex === d.captain ? d.vice : d.captain,
  };
}

/** Expected points of this XI in one gameweek, captain counted twice; empty slots score 0. */
export function lineupPoints(d: Draft, xptsOf: (id: number) => number): number {
  const total = d.xi.reduce((sum, s) => sum + (s.id === null ? 0 : xptsOf(s.id)), 0);
  const c = d.xi[d.captain]?.id;
  return total + (c === null || c === undefined ? 0 : xptsOf(c));
}

export interface TransferState {
  /** Players bought (ids not in the original squad). Buying back a sold player is not a transfer. */
  made: number;
  freeLeft: number;
  hits: number;
  bank: number;
  /** Money in minus money out, at today's prices. */
  bankDelta: number;
}

export function transferState(
  original: readonly number[],
  originalBank: number,
  freeTransfers: number,
  ids: readonly number[],
  priceOf: (id: number) => number,
): TransferState {
  const bought = ids.filter((x) => !original.includes(x));
  const sold = original.filter((x) => !ids.includes(x));
  const bankDelta = round1(sold.reduce((s, x) => s + priceOf(x), 0) - bought.reduce((s, x) => s + priceOf(x), 0));
  const made = bought.length;
  return {
    made,
    freeLeft: Math.max(0, freeTransfers - made),
    hits: HIT_COST * Math.max(0, made - freeTransfers),
    bank: round1(originalBank + bankDelta),
    bankDelta,
  };
}

/** Why `p` can't be bought into slot `r` (null = he can). `bank` already includes any sold player. */
export function cannotBuy(
  d: Draft,
  r: SlotRef,
  p: PlanPlayer,
  bank: number,
  teamOf: (id: number) => string,
): string | null {
  const s = slotAt(d, r);
  if (!s) return "no slot";
  if (squadIds(d).includes(p.id)) return "in your squad";
  if (p.position !== s.position) return `not a ${s.position}`;
  const fromClub = squadIds(d).filter((x) => teamOf(x) === p.team).length;
  if (fromClub >= MAX_PER_CLUB) return `${MAX_PER_CLUB} from ${p.team}`;
  if (p.price > bank + 1e-9) return `£${round1(p.price - bank).toFixed(1)}m short`;
  return null;
}

/** Apply a suggested transfer: each player out is replaced in his own slot by the buy of the same position. */
export function applyTransfer(
  d: Draft,
  out: readonly number[],
  inn: readonly { id: number; position: string }[],
): Draft {
  const left = [...inn];
  let next = d;
  for (const part of ["xi", "bench"] as const) {
    next[part].forEach((s, index) => {
      if (s.id === null || !out.includes(s.id)) return;
      const k = left.findIndex((p) => p.position === s.position);
      const buy = left[k];
      if (k < 0 || !buy) return;
      left.splice(k, 1);
      next = fillAt(next, { part, index }, buy.id);
    });
  }
  return next;
}

export const sameDraft = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);
