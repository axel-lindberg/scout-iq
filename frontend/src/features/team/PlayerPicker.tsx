import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PlayerOption } from "../../api/endpoints";
import { cannotBuy, type Draft, type SlotRef, slotAt } from "../../lib/plan";

interface Props {
  draft: Draft;
  slot: SlotRef;
  players: readonly PlayerOption[];
  bank: number;
  gameweeks: readonly number[];
  teamOf: (id: number) => string;
  /** Players sold from the original squad: listed first, so buying one back is one click. */
  soldIds?: readonly number[];
  onPick: (id: number) => void;
  onClose: () => void;
}

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Players you could buy into an empty slot: same position, sorted by expected points over the horizon. */
export function PlayerPicker({ draft, slot, players, bank, gameweeks, teamOf, soldIds = [], onPick, onClose }: Props) {
  const id = useId();
  const [search, setSearch] = useState("");
  const [affordable, setAffordable] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const position = slotAt(draft, slot)?.position ?? "MID";

  useEffect(() => {
    input.current?.focus();
  }, [slot]);

  const rows = useMemo(() => {
    const q = norm(search.trim());
    return players
      .filter((p) => p.position === position && (!q || norm(`${p.full_name} ${p.name} ${p.team}`).includes(q)))
      .map((p) => ({ p, why: cannotBuy(draft, slot, p, bank, teamOf), sold: soldIds.includes(p.id) }))
      .filter((r) => !affordable || r.why === null)
      .sort((a, b) => Number(b.sold) - Number(a.sold)) // stable: otherwise by expected points
      .slice(0, 40);
  }, [players, position, search, affordable, draft, slot, bank, teamOf, soldIds]);

  return (
    <section aria-labelledby={`${id}-h`} className="rounded-xl border border-accent bg-surface p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h4 id={`${id}-h`} className="text-sm font-semibold">
          Buy a {position} · £{bank.toFixed(1)}m in the bank
        </h4>
        <button type="button" className="btn min-h-0 px-2 py-0.5 text-xs" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <label htmlFor={`${id}-q`} className="sr-only">
          Search {position}s
        </label>
        <input
          ref={input}
          id={`${id}-q`}
          className="field min-w-0 flex-1"
          type="search"
          autoComplete="off"
          placeholder={`Search ${position}s by name or team`}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
        />
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={affordable}
            onChange={(e) => {
              setAffordable(e.target.checked);
            }}
          />
          Only ones I can buy
        </label>
      </div>
      <ul
        aria-label={`${position}s to buy`}
        className="max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line"
      >
        {rows.map(({ p, why, sold }) => (
          <li key={p.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[13px]">
            <span className="min-w-0">
              <span className="block truncate">
                <span className="font-semibold">{p.name}</span>{" "}
                <span className="text-muted">
                  {p.team} · £{p.price.toFixed(1)}m
                </span>
                {sold && (
                  <span className="ml-1.5 rounded bg-warn-soft px-1 py-px text-[11px] font-medium">
                    sold · buy back for free
                  </span>
                )}
              </span>
              <span className="block truncate text-[11px] text-muted">
                GW{gameweeks[0]} {p.fixtures[0] || "blank"}{" "}
                <span className="font-mono text-ink tabular-nums">{(p.expected_points[0] ?? 0).toFixed(1)}</span> ·{" "}
                {gameweeks.length} GWs{" "}
                <span className="font-mono text-ink tabular-nums">{p.expected_points_horizon_adjusted.toFixed(1)}</span>
                {p.availability !== "fit" && (
                  <span className={p.availability === "out" ? "text-bad" : "text-warn"}> · {p.status}</span>
                )}
              </span>
            </span>
            <button
              type="button"
              className="btn min-h-0 shrink-0 px-2 py-0.5 text-xs"
              disabled={why !== null}
              title={why ?? undefined}
              aria-label={`Buy ${p.name}`}
              onClick={() => {
                onPick(p.id);
              }}
            >
              {why ?? "Buy"}
            </button>
          </li>
        ))}
        {rows.length === 0 && <li className="px-2.5 py-2 text-sm text-muted">No players match.</li>}
      </ul>
    </section>
  );
}
