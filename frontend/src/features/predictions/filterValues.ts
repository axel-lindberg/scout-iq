import type { PredictionsQuery } from "../../api/endpoints";

export const POSITIONS = ["GK", "DEF", "MID", "FWD"] as const;

/** What the filter inputs hold: raw strings, exactly as typed. */
export interface FilterValues {
  position: string;
  maxPrice: string;
  team: string;
}

/** Turn the raw inputs into API parameters, dropping empty or invalid values. */
export function toQuery(values: FilterValues): PredictionsQuery {
  const price = Number(values.maxPrice);
  return {
    top_n: 30,
    position: values.position || undefined,
    max_price: values.maxPrice.trim() !== "" && Number.isFinite(price) && price > 0 ? price : undefined,
    team: values.team.trim() || undefined,
  };
}
