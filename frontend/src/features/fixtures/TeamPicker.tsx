import { useId, useState } from "react";
import type { FixtureTeam } from "../../api/endpoints";

interface Props {
  teams: readonly FixtureTeam[];
  /** Short names shown in the table; null = all. */
  selected: readonly string[] | null;
  onChange: (selected: string[] | null) => void;
}

/** Pick teams to compare side by side: search, a checkbox per team, Show all / Clear. */
export function TeamPicker({ teams, selected, onChange }: Props) {
  const id = useId();
  const [query, setQuery] = useState("");
  const all = teams.map((t) => t.short_name);
  const shown = new Set(selected ?? all);
  const q = query.trim().toLowerCase();
  const matches = teams
    .filter((t) => !q || t.short_name.toLowerCase().includes(q) || t.name.toLowerCase().includes(q))
    .toSorted((a, b) => a.name.localeCompare(b.name));

  const toggle = (short: string, on: boolean) => {
    const next = all.filter((s) => (s === short ? on : shown.has(s)));
    onChange(next.length === all.length ? null : next);
  };

  return (
    <fieldset className="min-w-0">
      <legend className="text-xs font-medium text-muted">
        Teams{" "}
        <span aria-live="polite">
          ({selected === null ? `all ${all.length}` : `${shown.size} of ${all.length}`})
        </span>
      </legend>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-q`} className="sr-only">
          Search teams
        </label>
        <input
          id={`${id}-q`}
          className="field w-40"
          type="search"
          autoComplete="off"
          placeholder="Search teams"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
        />
        <button
          type="button"
          className="btn"
          disabled={selected === null}
          onClick={() => {
            onChange(null);
          }}
        >
          Show all
        </button>
        <button
          type="button"
          className="btn"
          disabled={selected !== null && selected.length === 0}
          onClick={() => {
            onChange([]);
          }}
        >
          Clear
        </button>
      </div>
      <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Teams to show">
        {matches.map((t) => (
          <li key={t.id}>
            <label
              className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[13px] ${shown.has(t.short_name) ? "border-accent bg-accent-soft text-accent-strong" : "border-line bg-surface text-muted"}`}
            >
              <input
                type="checkbox"
                className="size-3.5"
                checked={shown.has(t.short_name)}
                onChange={(e) => {
                  toggle(t.short_name, e.target.checked);
                }}
              />
              <span className="font-semibold">{t.short_name}</span>
              <span className="hidden sm:inline">{t.name}</span>
            </label>
          </li>
        ))}
        {matches.length === 0 && <li className="text-sm text-muted">No team matches “{query}”.</li>}
      </ul>
    </fieldset>
  );
}
