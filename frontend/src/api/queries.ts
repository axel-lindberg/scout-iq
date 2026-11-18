/** TanStack Query hooks: caching, loading and error state for every API call. */
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import {
  getComparison,
  getFixtures,
  getPlayers,
  getPredictions,
  getStatus,
  postChat,
  postTeamAnalyze,
  type PredictionsQuery,
  type TeamRequest,
} from "./endpoints";

export const queryKeys = {
  status: ["status"] as const,
  predictions: (q: PredictionsQuery) => ["predictions", q] as const,
  comparison: (names: readonly string[]) => ["comparison", names] as const,
  players: ["players"] as const,
  fixtures: ["fixtures"] as const,
  team: (req: TeamRequest) => ["team", req] as const,
};

/** The server reads its data once at startup, so these rarely change; a minute is plenty fresh. */
const STALE = 60_000;

export function useStatus() {
  return useQuery({ queryKey: queryKeys.status, queryFn: ({ signal }) => getStatus(signal), staleTime: STALE });
}

export function usePredictions(query: PredictionsQuery) {
  return useQuery({
    queryKey: queryKeys.predictions(query),
    queryFn: ({ signal }) => getPredictions(query, signal),
    staleTime: STALE,
    placeholderData: keepPreviousData, // keep the old rows on screen while a new filter loads
  });
}

export function useComparison(names: readonly string[] | null) {
  return useQuery({
    queryKey: queryKeys.comparison(names ?? []),
    queryFn: ({ signal }) => getComparison(names ?? [], signal),
    enabled: names !== null && names.length > 0,
    staleTime: STALE,
  });
}

export function useChat() {
  return useMutation({ mutationFn: postChat });
}

/** Every player, for picking a squad by hand (only fetched once the builder is open). */
export function usePlayers(enabled: boolean) {
  return useQuery({ queryKey: queryKeys.players, queryFn: ({ signal }) => getPlayers(signal), enabled, staleTime: STALE });
}

/** Analysis of a squad given by player ids. The backend is stateless, so this is a cacheable query. */
export function useTeamAnalysis(req: TeamRequest | null) {
  return useQuery({
    queryKey: queryKeys.team(req ?? { horizon: 0, include_pairs: false }),
    queryFn: ({ signal }) => postTeamAnalyze(req ?? { horizon: 0, include_pairs: false }, signal),
    enabled: req !== null,
    staleTime: STALE,
    placeholderData: keepPreviousData, // keep the old analysis on screen while the bank is edited
    retry: false,
  });
}

/** Load a team by FPL team ID (the backend fetches it from the public FPL API). */
export function useLoadTeam() {
  return useMutation({ mutationFn: (teamId: number) => postTeamAnalyze({ team_id: teamId, horizon: 5, include_pairs: true }) });
}

export function useFixtures() {
  return useQuery({ queryKey: queryKeys.fixtures, queryFn: ({ signal }) => getFixtures(signal), staleTime: STALE });
}
