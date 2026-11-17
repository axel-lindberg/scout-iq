import type { Player, ToolCall } from "../api/endpoints";

export function formatKickoff(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export const fmt = (n: number | null | undefined, digits: number): string =>
  n === null || n === undefined ? "–" : n.toFixed(digits);

export type Availability = "fit" | "doubtful" | "out";

/** Same rule as the original UI: fit = 100% and "available", out = 0%, anything else is a doubt. */
export function availability(p: Pick<Player, "chance_of_playing" | "status">): Availability {
  if (p.chance_of_playing >= 100 && p.status === "available") return "fit";
  return p.chance_of_playing === 0 ? "out" : "doubtful";
}

/** get_predictions(position="DEF", max_price=5) */
export function formatToolCall(call: ToolCall): string {
  const { args } = call;
  let inner: string;
  if (args === null || args === undefined) inner = "";
  else if (typeof args === "object" && !Array.isArray(args))
    inner = Object.entries(args as Record<string, unknown>)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(", ");
  else inner = JSON.stringify(args);
  return `${call.tool}(${inner})`;
}
