/** One function per backend route. Types come from the generated OpenAPI schema. */
import { apiFetch } from "./client";
import type { components, paths } from "./schema.gen";

type Schemas = components["schemas"];
export type Status = Schemas["StatusResponse"];
export type ModelCard = Schemas["ModelCard"];
export type Player = Schemas["Player"];
export type GameweekPrediction = Schemas["GameweekPrediction"];
export type Predictions = Schemas["PredictionsResponse"];
export type ComparedPlayer = Schemas["ComparedPlayer"];
export type Comparison = Schemas["CompareResponse"];
export type ChatRequest = Schemas["ChatRequest"];
export type ChatResponse = Schemas["ChatResponse"];
export type ToolCall = Schemas["ToolCall"];
export type TeamContext = Schemas["TeamContext"];
export type TeamRequest = Schemas["TeamRequest"];
export type TeamAnalysis = Schemas["TeamAnalysis"];
export type SquadPlayer = Schemas["SquadPlayer"];
export type LineupOut = Schemas["LineupOut"];
export type SquadPlayerBrief = Schemas["SquadPlayerBrief"];
export type Transfer = Schemas["TransferOut"];
export type EntryInfo = Schemas["EntryInfo"];
export type PlayerOption = Schemas["PlayerOption"];

export type PredictionsQuery = NonNullable<paths["/api/predictions"]["get"]["parameters"]["query"]>;

function queryString(params: Record<string, string | number | boolean | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") q.set(key, String(value));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function getStatus(signal?: AbortSignal): Promise<Status> {
  return apiFetch<Status>("/api/status", { signal: signal ?? null });
}

export function getPredictions(query: PredictionsQuery, signal?: AbortSignal): Promise<Predictions> {
  return apiFetch<Predictions>(`/api/predictions${queryString(query)}`, { signal: signal ?? null });
}

export function getComparison(names: readonly string[], signal?: AbortSignal): Promise<Comparison> {
  const q = new URLSearchParams();
  for (const n of names) q.append("names", n);
  return apiFetch<Comparison>(`/api/compare?${q.toString()}`, { signal: signal ?? null });
}

export function postChat(body: ChatRequest): Promise<ChatResponse> {
  return apiFetch<ChatResponse>("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export type PlayersResponse = Schemas["PlayersResponse"];

export function getPlayers(signal?: AbortSignal): Promise<PlayersResponse> {
  return apiFetch<Schemas["PlayersResponse"]>("/api/players", { signal: signal ?? null });
}

export function postTeamAnalyze(body: TeamRequest, signal?: AbortSignal): Promise<TeamAnalysis> {
  return apiFetch<TeamAnalysis>("/api/team/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: signal ?? null,
  });
}
