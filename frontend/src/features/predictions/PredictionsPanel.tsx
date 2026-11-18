import { useRef, useState } from "react";
import { usePredictions } from "../../api/queries";
import { Card } from "../../components/Card";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { ComparePanel } from "../compare/ComparePanel";
import { Filters } from "./Filters";
import { HORIZON, toQuery, type FilterValues } from "./filterValues";
import { aheadOpacity } from "../../lib/format";
import { PredictionsTable } from "./PredictionsTable";

const MAX_COMPARE = 4;
const DEBOUNCE_MS = 300;

function MessageRow({ children, alert = false, cols }: { children: React.ReactNode; alert?: boolean; cols: number }) {
  return (
    <tbody>
      <tr>
        <td colSpan={cols} className={`px-2 py-6 text-center text-sm ${alert ? "text-bad" : "text-muted"}`}>
          {alert ? <span role="alert">{children}</span> : children}
        </td>
      </tr>
    </tbody>
  );
}

export function PredictionsPanel() {
  const [filters, setFilters] = useState<FilterValues>({ position: "", maxPrice: "", team: "", rankBy: "next" });
  // Position applies at once; typed fields wait until the user pauses.
  const debouncedPrice = useDebouncedValue(filters.maxPrice, DEBOUNCE_MS);
  const debouncedTeam = useDebouncedValue(filters.team, DEBOUNCE_MS);
  const query = toQuery({ ...filters, maxPrice: debouncedPrice, team: debouncedTeam });
  const { data, error, isPending, isPlaceholderData, isFetching, refetch } = usePredictions(query);

  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState<string[] | null>(null);
  const compareButton = useRef<HTMLButtonElement>(null);
  // Later gameweeks (after the next one) get their own columns once the API has sent them.
  const later = data?.gameweeks?.slice(1) ?? [];
  const cols = 7 + (later.length > 0 ? later.length + 1 : 0);

  const toggle = (fullName: string, checked: boolean) => {
    setSelected((s) =>
      checked ? (s.length < MAX_COMPARE && !s.includes(fullName) ? [...s, fullName] : s) : s.filter((n) => n !== fullName),
    );
  };

  const closeCompare = () => {
    setComparing(null);
    compareButton.current?.focus();
  };

  return (
    <Card aria-labelledby="pred-h" className="min-w-0">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="pred-h" className="heading text-[22px]">
          Expected points
        </h2>
        <p className="text-xs text-muted" aria-live="polite">
          {isFetching && !isPending ? "Updating…" : ""}
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <Filters values={filters} onChange={setFilters} />
        <div className="flex items-center gap-2">
          {selected.length > 0 && (
            <button
              type="button"
              className="text-xs text-muted underline underline-offset-2 hover:text-ink"
              onClick={() => {
                setSelected([]);
              }}
            >
              Clear {selected.length} selected
            </button>
          )}
          <button
            ref={compareButton}
            type="button"
            className="btn"
            disabled={selected.length < 2}
            onClick={() => {
              setComparing([...selected]);
            }}
          >
            {selected.length >= 2 ? `Compare ${selected.length} players` : "Compare selected"}
          </button>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {selected.length >= MAX_COMPARE ? `${MAX_COMPARE} players selected, the most you can compare.` : ""}
      </p>

      {comparing && <ComparePanel names={comparing} onClose={closeCompare} />}

      <div className="overflow-x-auto">
        <table className={`w-full ${later.length > 0 ? "min-w-[900px]" : "min-w-[560px]"} border-collapse text-sm [&_td]:border-b [&_td]:border-line`}>
          <caption className="sr-only">
            Players ranked by expected points{" "}
            {filters.rankBy === "horizon" ? `over the next ${HORIZON} gameweeks` : "for the next gameweek"}. Select 2 to {MAX_COMPARE} players to compare them.
          </caption>
          <thead>
            <tr className="text-left text-xs tracking-[0.04em] text-muted uppercase [&_th]:border-b [&_th]:border-line [&_th]:px-2 [&_th]:py-1.5 [&_th]:font-semibold">
              <th scope="col" className="sticky left-0 z-[1] bg-surface">
                <span className="sr-only">Compare</span>
              </th>
              <th scope="col" className="sticky left-8 z-[1] bg-surface">
                Player
              </th>
              <th scope="col">Pos</th>
              <th scope="col">Fixture</th>
              <th scope="col" className="text-right">
                £m
              </th>
              <th scope="col" className="text-right">
                xPts
              </th>
              {later.map((gw, i) => (
                <th
                  key={gw}
                  scope="col"
                  className="text-right"
                  style={{ opacity: aheadOpacity(i + 1) }}
                  title={`${i + 1} gameweek${i ? "s" : ""} after the next: less certain`}
                >
                  GW{gw}
                </th>
              ))}
              {later.length > 0 && (
                <th scope="col" className="text-right">
                  {later.length + 1} GWs
                </th>
              )}
              <th scope="col">Availability</th>
            </tr>
          </thead>
          {isPending ? (
            <MessageRow cols={cols}>Loading predictions…</MessageRow>
          ) : error ? (
            <MessageRow alert cols={cols}>
              Couldn't load predictions: {error.message}{" "}
              <button type="button" className="btn ml-2 text-ink" onClick={() => void refetch()}>
                Retry
              </button>
            </MessageRow>
          ) : data.players.length === 0 ? (
            <MessageRow cols={cols}>No players match these filters.</MessageRow>
          ) : (
            <PredictionsTable
              players={data.players}
              laterGameweeks={later}
              selected={selected}
              selectionFull={selected.length >= MAX_COMPARE}
              onToggle={toggle}
              stale={isPlaceholderData}
            />
          )}
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">
        xPts = model expected points for the gameweek × chance of playing. Typical error is about 1.9 points per player
        per match, so treat small differences as ties. Later gameweeks (faded) are less certain: they use each player's
        form as of today and only change the opponent and venue. A double gameweek adds both fixtures; a blank is 0.
      </p>
    </Card>
  );
}
