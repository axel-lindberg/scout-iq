import { useId } from "react";
import { POSITIONS, type FilterValues } from "./filterValues";

interface Props {
  values: FilterValues;
  onChange: (values: FilterValues) => void;
}

export function Filters({ values, onChange }: Props) {
  const id = useId();
  const set = (patch: Partial<FilterValues>) => {
    onChange({ ...values, ...patch });
  };
  return (
    <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filters">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-pos`} className="text-xs font-medium text-muted">
          Position
        </label>
        <select
          id={`${id}-pos`}
          className="field"
          value={values.position}
          onChange={(e) => {
            set({ position: e.target.value });
          }}
        >
          <option value="">All</option>
          {POSITIONS.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-price`} className="text-xs font-medium text-muted">
          Max £m
        </label>
        <input
          id={`${id}-price`}
          className="field w-24 tabular-nums"
          type="number"
          inputMode="decimal"
          min={3.5}
          max={16}
          step={0.5}
          placeholder="any"
          value={values.maxPrice}
          onChange={(e) => {
            set({ maxPrice: e.target.value });
          }}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-team`} className="text-xs font-medium text-muted">
          Team
        </label>
        <input
          id={`${id}-team`}
          className="field w-32"
          type="text"
          autoComplete="off"
          placeholder="e.g. ARS"
          value={values.team}
          onChange={(e) => {
            set({ team: e.target.value });
          }}
        />
      </div>
    </div>
  );
}
