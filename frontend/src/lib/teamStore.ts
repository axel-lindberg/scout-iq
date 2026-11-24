/**
 * The user's squad, remembered in localStorage so it survives reloads and the chat on every page
 * can send it to the agent. Only ids and numbers are stored; the analysis itself is re-fetched.
 */
import { useSyncExternalStore } from "react";
import type { EntryInfo, TeamContext, TeamRequest } from "../api/endpoints";
import type { Lineup } from "./plan";

/**
 * Saved transfers and lineups on top of the original squad. `playerIds`, `lineup`, `transfers` and
 * `bankDelta` describe the first gameweek planned (what the chat sends); `lineups` holds every gameweek.
 */
export interface SavedPlan {
  playerIds: number[];
  /** The lineup for the first gameweek planned (what older saves had). */
  lineup: Lineup;
  /** Squad + lineup per gameweek (keys are gameweek numbers); each week can have its own transfers.
   * Missing gameweeks carry the previous one on. */
  lineups?: Record<string, Lineup>;
  /** Your corrections to the bank per gameweek (£m, e.g. FPL's real selling prices). */
  bankAdjust?: Record<string, number>;
  /** Transfers made in the first gameweek (players bought that weren't in the original squad). */
  transfers: number;
  /** £m in the bank after the first gameweek's transfers, minus the bank as loaded. */
  bankDelta: number;
}

export interface SavedTeam {
  source: "fpl" | "manual";
  /** The squad as loaded or picked by hand: what Reset goes back to. */
  playerIds: number[];
  bank: number;
  freeTransfers: number;
  /** Set when loaded by FPL team ID. */
  entry: EntryInfo | null;
  /** Saved transfers / lineup; null = none yet. */
  plan?: SavedPlan | null;
}

const TEAM_KEY = "scout-iq.team";
const ID_KEY = "scout-iq.teamId";
const EVENT = "scout-iq:team";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // private mode, blocked storage...
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* the app still works, it just won't remember */
  }
  window.dispatchEvent(new Event(EVENT));
}

const isIds = (v: unknown, n: number): v is number[] =>
  Array.isArray(v) && v.length === n && v.every((x) => Number.isInteger(x));

function isLineup(l: unknown, playerIds: readonly number[]): l is Lineup {
  if (typeof l !== "object" || l === null) return false;
  const x = l as Partial<Lineup>;
  return (
    isIds(x.starters, 11) &&
    isIds(x.bench, 4) &&
    new Set([...x.starters, ...x.bench]).size === 15 &&
    [...x.starters, ...x.bench].every((id) => playerIds.includes(id)) &&
    typeof x.captain === "number" &&
    typeof x.vice === "number" &&
    x.starters.includes(x.captain) &&
    x.starters.includes(x.vice)
  );
}

function isPlan(v: unknown): v is SavedPlan {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Partial<SavedPlan>;
  return (
    isIds(p.playerIds, 15) &&
    typeof p.transfers === "number" &&
    typeof p.bankDelta === "number" &&
    isLineup(p.lineup, p.playerIds)
  );
}

/** Keep only well-formed per-gameweek lineups (each is its own 15) and numeric bank corrections. */
function cleanLineups(p: SavedPlan): SavedPlan {
  const raw: unknown = p.lineups;
  const lineups =
    typeof raw === "object" && raw !== null
      ? Object.fromEntries(
          Object.entries(raw).filter(([, l]) => {
            const x = l as Partial<Lineup> | null;
            return isLineup(l, [...(x?.starters ?? []), ...(x?.bench ?? [])]);
          }),
        )
      : {};
  const adj: unknown = p.bankAdjust;
  const bankAdjust =
    typeof adj === "object" && adj !== null
      ? Object.fromEntries(Object.entries(adj).filter(([, v]) => typeof v === "number" && Number.isFinite(v)))
      : {};
  return { ...p, lineups, bankAdjust };
}

function isSavedTeam(v: unknown): v is SavedTeam {
  if (typeof v !== "object" || v === null) return false;
  const t = v as Partial<SavedTeam>;
  return (
    (t.source === "fpl" || t.source === "manual") &&
    isIds(t.playerIds, 15) &&
    typeof t.bank === "number" &&
    typeof t.freeTransfers === "number"
  );
}

let cache: { raw: string | null; value: SavedTeam | null } = {
  raw: null,
  value: null,
};

function snapshot(): SavedTeam | null {
  const raw = read(TEAM_KEY);
  if (raw !== cache.raw) {
    let value: SavedTeam | null = null;
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      value = isSavedTeam(parsed)
        ? {
            ...parsed,
            entry: parsed.entry ?? null,
            plan: isPlan(parsed.plan) ? cleanLineups(parsed.plan) : null,
          }
        : null;
    } catch {
      value = null;
    }
    cache = { raw, value };
  }
  return cache.value;
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange); // other tabs
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function saveTeam(team: SavedTeam | null) {
  write(TEAM_KEY, team ? JSON.stringify(team) : null);
}

export function useSavedTeam(): SavedTeam | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

export function rememberedTeamId(): string {
  return read(ID_KEY) ?? "";
}

export function rememberTeamId(id: string) {
  write(ID_KEY, id || null);
}

/** The squad after saved transfers, with the bank and free transfers left. */
export function currentSquad(t: SavedTeam): {
  playerIds: number[];
  bank: number;
  freeTransfers: number;
} {
  if (!t.plan)
    return {
      playerIds: t.playerIds,
      bank: t.bank,
      freeTransfers: t.freeTransfers,
    };
  return {
    playerIds: t.plan.playerIds,
    bank: Math.max(0, Math.round((t.bank + t.plan.bankDelta) * 10) / 10),
    freeTransfers: Math.max(0, t.freeTransfers - t.plan.transfers),
  };
}

/** What the chat sends so the agent can analyse the squad (including saved transfers). */
export function teamContext(t: SavedTeam): TeamContext {
  const c = currentSquad(t);
  return {
    player_ids: c.playerIds,
    bank: c.bank,
    free_transfers: c.freeTransfers,
    team_name: t.entry?.team_name ?? null,
  };
}

/** The analysis request for a squad by player ids (sorted, so the same squad is one cache entry). */
export function teamRequest(playerIds: readonly number[], bank: number, freeTransfers: number): TeamRequest {
  return {
    player_ids: [...playerIds].sort((a, b) => a - b),
    bank: Math.max(0, bank),
    free_transfers: Math.min(5, Math.max(0, freeTransfers)),
    horizon: 5,
    include_pairs: true,
  };
}

/** The analysis request for the original squad (by player ids, so FPL isn't asked again). */
export function requestFor(t: SavedTeam): TeamRequest {
  return teamRequest(t.playerIds, t.bank, t.freeTransfers);
}
