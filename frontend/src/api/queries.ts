/** TanStack Query hooks: caching, loading and error state for every API call. */
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { getComparison, getPredictions, getStatus, postChat, type PredictionsQuery } from "./endpoints";

export const queryKeys = {
  status: ["status"] as const,
  predictions: (q: PredictionsQuery) => ["predictions", q] as const,
  comparison: (names: readonly string[]) => ["comparison", names] as const,
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
