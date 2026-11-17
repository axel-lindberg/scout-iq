import { useId, useMemo, useState } from "react";
import type { PlayerOption } from "../../api/endpoints";
import { usePlayers } from "../../api/queries";
import { cannotAdd, POSITION_ORDER, SQUAD_SHAPE, squadErrors } from "../../lib/squad";

interface Props {
  initial: readonly number[];
  onDone: (playerIds: number[]) => void;
  onCancel: () => void;
}

const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Pick 15 players by hand: search, add, remove, with the squad rules checked as you go. */
export function SquadBuilder({ initial, onDone, onCancel }: Props) {
  const id = useId();
  const players = usePlayers(true);
  const [picked, setPicked] = useState<number[]>([...initial]);
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState("");

  const byId = useMemo(() => new Map((players.data?.players ?? []).map((p) => [p.id, p])), [players.data]);
  const squad = picked.flatMap((x) => byId.get(x) ?? []);
  const errors = squadErrors(squad);
  const results = useMemo(() => {
    const q = norm(search.trim());
    return (players.data?.players ?? [])
      .filter((p) => (!position || p.position === position) && (!q || norm(`${p.full_name} ${p.name} ${p.team}`).includes(q)))
      .slice(0, 20);
  }, [players.data, search, position]);

  const add = (p: PlayerOption) => {
    if (cannotAdd(squad, p) === null) setPicked((s) => [...s, p.id]);
  };

  return (
    <section aria-labelledby={`${id}-h`} className="space-y-3">
      <h3 id={`${id}-h`} className="heading text-lg">
        Pick your squad
      </h3>
      {players.isPending && <p className="text-sm text-muted">Loading players…</p>}
      {players.error && (
        <p role="alert" className="text-sm text-bad">
          Couldn't load players: {players.error.message}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-end gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label htmlFor={`${id}-q`} className="text-xs font-medium text-muted">
                Search players
              </label>
              <input
                id={`${id}-q`}
                className="field"
                type="search"
                autoComplete="off"
                placeholder="Name or team, e.g. Saka"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-pos`} className="text-xs font-medium text-muted">
                Position
              </label>
              <select
                id={`${id}-pos`}
                className="field"
                value={position}
                onChange={(e) => {
                  setPosition(e.target.value);
                }}
              >
                <option value="">All</option>
                {POSITION_ORDER.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>
          <ul aria-label="Search results" className="max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {results.map((p) => {
              const why = cannotAdd(squad, p);
              return (
                <li key={p.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[13px]">
                  <span className="min-w-0 truncate">
                    <span className="font-semibold">{p.name}</span>{" "}
                    <span className="text-muted">
                      {p.team} · {p.position} · £{p.price.toFixed(1)}m · {p.expected_points_horizon_adjusted.toFixed(1)} xPts
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn min-h-0 shrink-0 px-2 py-0.5 text-xs"
                    disabled={why !== null}
                    title={why ?? undefined}
                    aria-label={`Add ${p.name}`}
                    onClick={() => {
                      add(p);
                    }}
                  >
                    {why ?? "Add"}
                  </button>
                </li>
              );
            })}
            {players.data && results.length === 0 && <li className="px-2.5 py-2 text-sm text-muted">No players match.</li>}
          </ul>
        </div>

        <div className="min-w-0">
          <p className="mb-2 text-xs font-medium text-muted" aria-live="polite">
            {squad.length}/15 picked
          </p>
          {POSITION_ORDER.map((pos) => {
            const inPos = squad.filter((p) => p.position === pos);
            return (
              <div key={pos} className="mb-2">
                <p className="text-xs font-semibold tracking-[0.05em] text-muted uppercase">
                  {pos} {inPos.length}/{SQUAD_SHAPE[pos]}
                </p>
                <ul className="flex flex-wrap gap-1.5" aria-label={`Picked ${pos}`}>
                  {inPos.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="btn min-h-0 rounded-full px-2.5 py-0.5 text-xs"
                        aria-label={`Remove ${p.name}`}
                        onClick={() => {
                          setPicked((s) => s.filter((x) => x !== p.id));
                        }}
                      >
                        {p.name} <span className="text-muted">{p.team}</span> <span aria-hidden="true">×</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {errors.length > 0 && players.data && (
            <ul aria-label="Squad problems" className="mt-2 space-y-0.5 text-[13px] text-warn">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={errors.length > 0 || squad.length !== 15}
              onClick={() => {
                onDone(picked);
              }}
            >
              Analyse squad
            </button>
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
