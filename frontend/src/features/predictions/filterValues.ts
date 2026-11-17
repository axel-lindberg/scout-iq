import type { PredictionsQuery } from "../../api/endpoints";

export const POSITIONS = ["GK", "DEF", "MID", "FWD"] as const;
/** Gameweeks requested for the table: the next one plus the four after it. */
export const HORIZON = 5;

/** What the filter inputs hold: raw strings, exactly as typed. */
export interface FilterValues {
  position: string;
  maxPrice: string;
  team: string;
  /** "next": rank by the next gameweek; "horizon": by the total over the next HORIZON gameweeks. */
  rankBy: "next" | "horizon";
}

/** Turn the raw inputs into API parameters, dropping empty or invalid values. */
export function toQuery(values: FilterValues): PredictionsQuery {
  const price = Number(values.maxPrice);
  return {
    top_n: 30,
    horizon: HORIZON,
    rank_by: values.rankBy === "horizon" ? "horizon" : undefined,
    position: values.position || undefined,
    max_price: values.maxPrice.trim() !== "" && Number.isFinite(price) && price > 0 ? price : undefined,
    team: values.team.trim() || undefined,
  };
}
