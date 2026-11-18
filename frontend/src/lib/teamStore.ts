/**
 * The user's squad, remembered in localStorage so it survives reloads and the chat on every page
 * can send it to the agent. Only ids and numbers are stored; the analysis itself is re-fetched.
 */
import { useSyncExternalStore } from "react";
import type { EntryInfo, TeamContext, TeamRequest } from "../api/endpoints";

export interface SavedTeam {
  source: "fpl" | "manual";
  playerIds: number[];
  bank: number;
  freeTransfers: number;
  /** Set when loaded by FPL team ID. */
  entry: EntryInfo | null;
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

function isSavedTeam(v: unknown): v is SavedTeam {
  if (typeof v !== "object" || v === null) return false;
  const t = v as Partial<SavedTeam>;
  return (
    (t.source === "fpl" || t.source === "manual") &&
    Array.isArray(t.playerIds) &&
    t.playerIds.length === 15 &&
    t.playerIds.every((x) => Number.isInteger(x)) &&
    typeof t.bank === "number" &&
    typeof t.freeTransfers === "number"
  );
}

let cache: { raw: string | null; value: SavedTeam | null } = { raw: null, value: null };

function snapshot(): SavedTeam | null {
  const raw = read(TEAM_KEY);
  if (raw !== cache.raw) {
    let value: SavedTeam | null = null;
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      value = isSavedTeam(parsed) ? { ...parsed, entry: parsed.entry ?? null } : null;
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

/** What the chat sends so the agent can analyse the squad. */
export function teamContext(t: SavedTeam): TeamContext {
  return {
    player_ids: t.playerIds,
    bank: t.bank,
    free_transfers: t.freeTransfers,
    team_name: t.entry?.team_name ?? null,
  };
}

/** The analysis request for a saved squad (by player ids, so FPL isn't asked again). */
export function requestFor(t: SavedTeam): TeamRequest {
  return { player_ids: t.playerIds, bank: t.bank, free_transfers: t.freeTransfers, horizon: 5, include_pairs: true };
}
