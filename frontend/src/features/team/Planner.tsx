import { useCallback, useId, useMemo, useState } from "react";
import type { LineupOut, PlayerOption, TeamAnalysis, Transfer } from "../../api/endpoints";
import { usePlayers, useTeamAnalysis } from "../../api/queries";
import { Card } from "../../components/Card";
import {
  applyTransfer,
  cannotSwap,
  carryForward,
  type Draft,
  draftFromLineup,
  emptySlots,
  fillAt,
  lineupOf,
  type Lineup,
  lineupPoints,
  planStates,
  removeAt,
  sameDraft,
  scorePercent,
  sameRef,
  setCaptain,
  setVice,
  type SlotRef,
  slotAt,
  squadIds,
  swap,
} from "../../lib/plan";
import { squadErrors } from "../../lib/squad";
import { currentSquad, saveTeam, teamRequest, type SavedTeam } from "../../lib/teamStore";
import { Pitch } from "./Pitch";
import { PlayerPicker } from "./PlayerPicker";
import { SquadTable } from "./SquadTable";
import { Transfers } from "./Transfers";

const fromBackend = (l: LineupOut) => ({
  starters: l.starters,
  bench: l.bench,
  captain: l.captain,
  vice: l.vice_captain,
});
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}`;

function Limitations({ analysis, team }: { analysis: TeamAnalysis; team: SavedTeam }) {
  const notes = [...(team.entry?.notes ?? []), ...analysis.warnings];
  return (
    <Card aria-labelledby="lim-h" className="text-sm">
      <h3 id="lim-h" className="heading mb-2 text-lg">
        What this can't know
      </h3>
      {notes.length > 0 && (
        <ul className="mb-2 space-y-1 rounded-lg bg-warn-soft px-3 py-2">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <ul className="list-disc space-y-1 pl-5 text-muted">
        {analysis.limitations.map((l) => (
          <li key={l}>{l}</li>
        ))}
        {team.entry && <li>{team.entry.free_transfers_note}</li>}
        <li>Planned transfers live in this browser only; make them in the FPL app to count.</li>
        <li>Sales use today's price, not FPL's selling price: type the real bank on the pitch to correct it.</li>
      </ul>
    </Card>
  );
}

/** The bank for one gameweek, editable: what you type becomes a correction carried into later weeks. */
function BankField({
  gw,
  bank,
  adjust,
  onChange,
}: {
  gw: number;
  bank: number;
  adjust: number;
  onChange: (bank: number) => void;
}) {
  const id = useId();
  const [text, setText] = useState(bank.toFixed(1));
  const commit = () => {
    const v = Number(text);
    if (text.trim() === "" || !Number.isFinite(v)) setText(bank.toFixed(1));
    else if (Math.abs(v - bank) >= 0.05) onChange(Math.round(v * 10) / 10);
  };
  return (
    <div className={`rounded-lg px-3 py-1.5 ${bank < 0 ? "bg-bad-soft" : "bg-surface-2"}`}>
      <label htmlFor={id} className="block text-xs text-muted">
        Bank{adjust !== 0 ? " (edited)" : ""}
      </label>
      <span className={`flex items-center font-mono font-semibold tabular-nums ${bank < 0 ? "text-bad" : ""}`}>
        £
        <input
          id={id}
          aria-label={`Bank in GW${gw}, £m`}
          title="Type what FPL shows if selling prices differ"
          className="w-14 rounded border border-transparent bg-transparent px-0.5 hover:border-line focus:border-accent"
          type="number"
          inputMode="decimal"
          step={0.1}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
        />
        m
        {adjust !== 0 && (
          <button
            type="button"
            className="ml-1 text-xs font-normal text-muted underline hover:text-ink"
            aria-label={`Undo the bank edit in GW${gw}`}
            onClick={() => {
              onChange(Math.round((bank - adjust) * 10) / 10);
            }}
          >
            undo
          </button>
        )}
      </span>
    </div>
  );
}

interface BodyProps {
  team: SavedTeam;
  players: readonly PlayerOption[];
  gameweeks: readonly number[];
  /** One draft per gameweek: each with its own squad (transfers), lineup and armband. */
  initials: readonly [Draft, ...Draft[]];
  /** Saved bank corrections per gameweek (£m). */
  initialAdjust: readonly number[];
  /** Which gameweek the pitch shows (0 = the next one); kept by the parent so a save doesn't reset it. */
  gwIdx: number;
  setGwIdx: (i: number) => void;
}

function PlannerBody({ team, players, gameweeks, initials, initialAdjust, gwIdx, setGwIdx }: BodyProps) {
  const [drafts, setDrafts] = useState<Draft[]>([...initials]);
  const [adjust, setAdjust] = useState<number[]>([...initialAdjust]);
  const [selected, setSelected] = useState<SlotRef | null>(null);
  const [picking, setPicking] = useState<SlotRef | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const draft = drafts[gwIdx] ?? initials[0];

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const playerOf = useCallback((id: number) => byId.get(id), [byId]);
  const teamOf = useCallback((id: number) => byId.get(id)?.team ?? "", [byId]);
  const priceOf = (id: number) => byId.get(id)?.price ?? 0;
  const positionOf = (id: number) => byId.get(id)?.position ?? "MID";

  // Each gameweek's transfers, free transfers and bank, rolling on from the week before.
  const squads = drafts.map(squadIds);
  const states = planStates(team.playerIds, team.bank, team.freeTransfers, squads, adjust, priceOf);
  const ids = squads[gwIdx] ?? [];
  const prevIds = gwIdx === 0 ? team.playerIds : (squads[gwIdx - 1] ?? []);
  const ts = states[gwIdx] ?? {
    made: 0,
    free: 0,
    freeLeft: 0,
    hits: 0,
    bank: 0,
    bankDelta: 0,
    adjust: 0,
  };
  const complete = emptySlots(draft) === 0;
  const errors = complete ? squadErrors(ids.flatMap((x) => byId.get(x) ?? [])) : [];
  const analysis = useTeamAnalysis(complete && errors.length === 0 ? teamRequest(ids, ts.bank, ts.freeLeft) : null);
  const data = analysis.data;
  const current = complete && data !== undefined && !analysis.isPlaceholderData && !analysis.isFetching;

  const points = lineupPoints(draft, (x) => byId.get(x)?.expected_points[gwIdx] ?? 0);
  const best = current ? data.lineups[gwIdx] : undefined;
  const optimum = best?.expected_points ?? null;
  const hitsHere = ts.hits;
  const changedGws = gameweeks.filter(
    (_, k) =>
      (drafts[k] && initials[k] && !sameDraft(drafts[k], initials[k])) || (adjust[k] ?? 0) !== (initialAdjust[k] ?? 0),
  );
  const dirty = changedGws.length > 0;
  const lineup = lineupOf(draft);
  const lineups = drafts.map(lineupOf);
  /** What stops a gameweek from being saved (null = fine). */
  const problemIn = (k: number): string | null => {
    const d = drafts[k];
    const st = states[k];
    if (!d || !st) return null;
    const empty = emptySlots(d);
    if (empty > 0)
      return `Buy ${empty === 1 ? "a player for the empty slot" : `players for the ${empty} empty slots`} first.`;
    if (st.bank < 0) return `Over budget by £${(-st.bank).toFixed(1)}m.`;
    return squadErrors(squadIds(d).flatMap((x) => byId.get(x) ?? []))[0] ?? null;
  };
  const problems = gameweeks.flatMap((g, k) => {
    const why = problemIn(k);
    return why ? [k === gwIdx ? why : `GW${g}: ${why}`] : [];
  });
  const saveProblem = problemIn(gwIdx) ?? problems[0] ?? null;

  /** Change this gameweek's draft; a sale or buy carries into the later gameweeks, not the earlier ones. */
  const edit = (next: Draft) => {
    setDrafts(carryForward(drafts, gwIdx, next, positionOf));
    setMessage(null);
  };
  const goTo = (k: number) => {
    setGwIdx(Math.min(gameweeks.length - 1, Math.max(0, k)));
    setSelected(null);
    setPicking(null);
    setMessage(null);
  };

  const onSelect = (r: SlotRef) => {
    setPicking(null);
    if (selected === null || sameRef(selected, r)) {
      setSelected(sameRef(selected, r) ? null : r);
      setMessage(null);
      return;
    }
    const why = cannotSwap(draft, selected, r);
    if (why === null) {
      edit(swap(draft, selected, r));
      setSelected(null);
    } else if (selected.part === "xi" && r.part === "xi") {
      setSelected(r); // another starter: just select that one instead
      setMessage(null);
    } else setMessage(why);
  };

  const onTry = (t: Transfer) => {
    edit(
      applyTransfer(
        draft,
        t.out.map((p) => p.id),
        t.in,
      ),
    );
    setSelected(null);
    setPicking(null);
  };

  const selSlot = selected ? slotAt(draft, selected) : undefined;
  const selName = selSlot && selSlot.id !== null ? (byId.get(selSlot.id)?.name ?? "") : "";
  const gw = gameweeks[gwIdx] ?? 0;
  const net = points - hitsHere;
  const allHits = states.reduce((a, st) => a + st.hits, 0);
  // Per gameweek: your lineup's points minus that week's hits, and its score against the perfect team.
  // The perfect teams hardly depend on your squad, so the last analysis is fine while refetching.
  const gwPoints = drafts.map(
    (d, k) => lineupPoints(d, (x) => byId.get(x)?.expected_points[k] ?? 0) - (states[k]?.hits ?? 0),
  );
  const horizonMine = gwPoints.reduce((a, b) => a + b, 0);
  const perfect = data?.perfect_teams ?? [];
  const scores = gameweeks.map((_, k) => scorePercent(gwPoints[k] ?? 0, perfect[k]?.expected_points));
  const score = scores[gwIdx] ?? null;
  const perfectHere = perfect[gwIdx]?.expected_points;
  const pickerSlot = picking && slotAt(draft, picking)?.id === null ? picking : null;

  return (
    <div className="space-y-4">
      <Card aria-labelledby="xi-h">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1" role="group" aria-label="Gameweek">
              <button
                type="button"
                className="btn min-h-0 px-2 py-0.5"
                aria-label="Previous gameweek"
                disabled={gwIdx === 0}
                onClick={() => {
                  goTo(gwIdx - 1);
                }}
              >
                <span aria-hidden="true">‹</span>
              </button>
              <h3 id="xi-h" className="heading min-w-[9.5rem] text-center text-lg tabular-nums" aria-live="polite">
                Your team · GW{gw}
              </h3>
              <button
                type="button"
                className="btn min-h-0 px-2 py-0.5"
                aria-label="Next gameweek"
                disabled={gwIdx >= gameweeks.length - 1}
                onClick={() => {
                  goTo(gwIdx + 1);
                }}
              >
                <span aria-hidden="true">›</span>
              </button>
            </div>
            <p className="text-xs text-muted">
              {gwIdx === 0
                ? "Make changes on the pitch; nothing is saved until you press Save."
                : `Changes here apply from GW${gw} on; earlier weeks stay. Less certain: form as of today.`}
            </p>
          </div>
          <div className="text-right" aria-live="polite">
            <p className="text-xs font-medium text-muted">Predicted GW{gw} points</p>
            <p
              className="font-mono text-[28px] leading-tight font-semibold tabular-nums"
              data-testid="predicted-points"
            >
              {net.toFixed(1)}
            </p>
            <p className="text-xs text-muted tabular-nums">
              {hitsHere > 0 ? `${points.toFixed(1)} − ${hitsHere} hit · ` : ""}
              {optimum !== null
                ? Math.abs(optimum - points) < 0.05
                  ? "best possible XI"
                  : `best XI: ${optimum.toFixed(1)} (${signed(optimum - points)})`
                : complete
                  ? "checking the best XI…"
                  : "empty slots score 0"}
            </p>
            {score !== null && perfectHere !== undefined && (
              <p className="text-xs text-muted tabular-nums" data-testid="gw-score">
                <span className="font-semibold text-ink">{score}%</span> of the perfect team ({perfectHere.toFixed(1)})
              </p>
            )}
          </div>
        </div>

        <ol className="mb-1 grid grid-cols-5 gap-1" aria-label="Score per gameweek">
          {gameweeks.map((g, k) => {
            const s = scores[k] ?? null;
            const here = k === gwIdx;
            return (
              <li key={g}>
                <button
                  type="button"
                  aria-current={here ? "true" : undefined}
                  aria-label={`GW${g}${s === null ? "" : `, score ${s}%`}`}
                  className={`flex w-full flex-col items-center rounded-lg border px-1 py-1 transition-colors ${here ? "border-accent bg-accent-soft" : "border-line bg-surface-2 hover:border-muted"}`}
                  onClick={() => {
                    goTo(k);
                  }}
                >
                  <span className="text-[11px] text-muted">GW{g}</span>
                  <span className="font-mono text-sm font-semibold tabular-nums">{s === null ? "–" : `${s}%`}</span>
                  <span className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-line" aria-hidden="true">
                    <span
                      className="block h-full rounded-full bg-accent"
                      style={{
                        width: `${Math.min(100, Math.max(0, s ?? 0))}%`,
                      }}
                    />
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="mb-3 text-xs text-muted">
          Score = your lineup's predicted points ÷ the perfect team's: the best 15 of all players under FPL rules
          {data ? ` (£${data.perfect_budget.toFixed(1)}m, 3 per club)` : ""}, picked for that gameweek alone.
        </p>

        <div className="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <dl className="contents" aria-label={`Transfers for GW${gw}`}>
            <div className="rounded-lg bg-surface-2 px-3 py-1.5">
              <dt className="text-xs text-muted">Transfers</dt>
              <dd className="font-mono font-semibold tabular-nums">{ts.made}</dd>
            </div>
            <div className="rounded-lg bg-surface-2 px-3 py-1.5">
              <dt className="text-xs text-muted">Free transfers left</dt>
              <dd className="font-mono font-semibold tabular-nums">
                {ts.freeLeft} <span className="text-xs font-normal text-muted">of {ts.free}</span>
              </dd>
            </div>
            <div className={`rounded-lg px-3 py-1.5 ${ts.hits > 0 ? "bg-bad-soft" : "bg-surface-2"}`}>
              <dt className="text-xs text-muted">Hits</dt>
              <dd className={`font-mono font-semibold tabular-nums ${ts.hits > 0 ? "text-bad" : ""}`}>
                {ts.hits > 0 ? `−${ts.hits}` : "0"}
              </dd>
            </div>
          </dl>
          <BankField
            key={`${gwIdx}:${ts.bank.toFixed(1)}`}
            gw={gw}
            bank={ts.bank}
            adjust={ts.adjust}
            onChange={(b) => {
              const next = [...adjust];
              next[gwIdx] = Math.round(((adjust[gwIdx] ?? 0) + b - ts.bank) * 10) / 10;
              setAdjust(next);
              setMessage(null);
            }}
          />
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn"
            disabled={!current}
            title={current ? `Best XI, bench order and captain for these 15 players in GW${gw} only` : undefined}
            onClick={() => {
              if (!best) return;
              edit(draftFromLineup(fromBackend(best), positionOf));
              setSelected(null);
            }}
          >
            Optimise
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!dirty || saveProblem !== null || lineups.some((l) => l === null)}
            onClick={() => {
              const all = lineups.flatMap((l) => (l ? [l] : []));
              const first = all[0];
              const s0 = states[0];
              if (!first || !s0 || all.length !== gameweeks.length) return;
              saveTeam({
                ...team,
                plan: {
                  playerIds: squads[0] ?? [],
                  lineup: first,
                  lineups: Object.fromEntries(gameweeks.map((g, k) => [String(g), all[k] as Lineup])),
                  bankAdjust: Object.fromEntries(
                    gameweeks.flatMap((g, k) => ((adjust[k] ?? 0) !== 0 ? [[String(g), adjust[k] ?? 0]] : [])),
                  ),
                  transfers: s0.made,
                  bankDelta: Math.round((s0.bank - team.bank) * 10) / 10,
                },
              });
            }}
          >
            Save
          </button>
          <button
            type="button"
            className="btn"
            disabled={!dirty && !team.plan}
            title="Back to the squad as loaded, with all free transfers"
            onClick={() => {
              setSelected(null);
              setPicking(null);
              setMessage(null);
              if (team.plan) saveTeam({ ...team, plan: null });
              else {
                setDrafts([...initials]);
                setAdjust([...initialAdjust]);
              }
            }}
          >
            Reset
          </button>
          <p className="text-xs" aria-live="polite">
            {dirty ? (
              <span className="font-medium text-warn">
                Unsaved changes
                {changedGws.length > 0 ? ` in ${changedGws.map((g) => `GW${g}`).join(", ")}` : ""}
                {saveProblem ? ` · ${saveProblem}` : ""}
              </span>
            ) : team.plan ? (
              <span className="text-muted">
                Saved
                {team.plan.transfers
                  ? `, ${team.plan.transfers} transfer${team.plan.transfers > 1 ? "s" : ""} made`
                  : ""}
              </span>
            ) : null}
          </p>
        </div>

        {selSlot && selected && (
          <div
            className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm"
            role="group"
            aria-label="Selected player"
          >
            <span>
              <span className="font-semibold">{selName}</span>{" "}
              <span className="text-muted">
                {selected.part === "xi"
                  ? "· click a bench player to bring on"
                  : "· click a starter or bench player to swap"}
              </span>
            </span>
            {selected.part === "xi" && (
              <>
                <button
                  type="button"
                  className="btn min-h-0 px-2 py-0.5 text-xs"
                  disabled={draft.captain === selected.index}
                  onClick={() => {
                    edit(setCaptain(draft, selected.index));
                    setSelected(null);
                  }}
                >
                  Make captain
                </button>
                <button
                  type="button"
                  className="btn min-h-0 px-2 py-0.5 text-xs"
                  disabled={draft.vice === selected.index}
                  onClick={() => {
                    edit(setVice(draft, selected.index));
                    setSelected(null);
                  }}
                >
                  Make vice-captain
                </button>
              </>
            )}
            <button
              type="button"
              className="btn min-h-0 px-2 py-0.5 text-xs"
              onClick={() => {
                setSelected(null);
                setMessage(null);
              }}
            >
              Cancel
            </button>
            {message && (
              <p role="alert" className="w-full text-xs text-bad">
                {message}
              </p>
            )}
          </div>
        )}

        {pickerSlot && (
          <div className="mb-3">
            <PlayerPicker
              draft={draft}
              slot={pickerSlot}
              players={players}
              bank={ts.bank}
              gameweeks={gameweeks}
              teamOf={teamOf}
              soldIds={prevIds.filter((x) => !ids.includes(x))}
              onPick={(id) => {
                edit(fillAt(draft, pickerSlot, id));
                setPicking(null);
              }}
              onClose={() => {
                setPicking(null);
              }}
            />
          </div>
        )}

        <Pitch
          draft={draft}
          gameweek={gw}
          gwIndex={gwIdx}
          playerOf={playerOf}
          selected={selected}
          swapHint={(r) => (selected ? cannotSwap(draft, selected, r) === null : null)}
          picking={pickerSlot}
          onSelect={onSelect}
          onRemove={(r) => {
            edit(removeAt(draft, r));
            setSelected(null);
            setPicking(r);
          }}
          onAdd={(r) => {
            setSelected(null);
            setPicking(sameRef(picking, r) ? null : r);
          }}
        />
        <p className="mt-2 text-xs text-muted" data-testid="horizon-points">
          Next {gameweeks.length} gameweeks with your lineups:{" "}
          <span className="font-mono font-medium text-ink tabular-nums">{horizonMine.toFixed(1)}</span> points
          {allHits > 0 ? `, after −${allHits} in hits` : ""}.
        </p>
      </Card>

      {analysis.error && complete && (
        <p role="alert" className="text-sm text-bad">
          Couldn't analyse the squad: {analysis.error.message}{" "}
          <button type="button" className="btn ml-2 text-ink" onClick={() => void analysis.refetch()}>
            Retry
          </button>
        </p>
      )}
      {data && (
        <div className={`space-y-4 transition-opacity ${current ? "" : "opacity-60"}`}>
          {!complete && <p className="text-sm text-muted">Fill the empty slot to update the suggestions below.</p>}
          <Card aria-labelledby="tr-h">
            <h3 id="tr-h" className="heading mb-3 text-lg">
              Transfer suggestions
            </h3>
            {gwIdx > 0 && (
              <p className="-mt-2 mb-3 text-xs text-muted">
                For your GW{gw} squad, as further transfers that week; gains still count all {gameweeks.length}{" "}
                gameweeks from GW{gameweeks[0]}.
              </p>
            )}
            <Transfers analysis={data} onTry={complete ? onTry : undefined} />
          </Card>

          <Card aria-labelledby="weak-h">
            <h3 id="weak-h" className="heading mb-2 text-lg">
              Weakest players
            </h3>
            <ul className="space-y-1 text-sm">
              {data.weakest.slice(0, 5).map((w) => (
                <li key={w.id}>
                  <span className="font-semibold">{w.name}</span>{" "}
                  <span className={w.reason === "low expected points" ? "text-muted" : "text-bad"}>{w.reason}</span>{" "}
                  <span className="font-mono text-[13px] text-muted tabular-nums">
                    {w.expected_points_horizon_adjusted.toFixed(1)} xPts over {data.gameweeks.length} GWs
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card aria-labelledby="sq-h">
            <h3 id="sq-h" className="heading mb-2 text-lg">
              Expected points, next {data.gameweeks.length} gameweeks
            </h3>
            <SquadTable analysis={data} lineup={current ? lineup : null} />
            <p className="mt-2 text-xs text-muted">
              Later gameweeks (faded) are less certain: they use each player's form as of today and only change the
              opponent. A double gameweek adds both fixtures; a blank is 0.
            </p>
          </Card>

          <Limitations analysis={data} team={team} />
        </div>
      )}
    </div>
  );
}

/** Plan transfers, substitutions and the armband on top of the saved squad. */
export function Planner({ team }: { team: SavedTeam }) {
  const players = usePlayers(true);
  const [gwIdx, setGwIdx] = useState(0);
  const saved = currentSquad(team);
  // The starting lineup: the saved plan's, else the backend's best XI for the original squad.
  const original = useTeamAnalysis(team.plan ? null : teamRequest(saved.playerIds, saved.bank, saved.freeTransfers));

  if (players.error)
    return (
      <p role="alert" className="text-sm text-bad">
        Couldn't load players: {players.error.message}
      </p>
    );
  if (!team.plan && original.error)
    return (
      <p role="alert" className="text-sm text-bad">
        Couldn't analyse the squad: {original.error.message}{" "}
        <button type="button" className="btn ml-2 text-ink" onClick={() => void original.refetch()}>
          Retry
        </button>
      </p>
    );
  const first = team.plan?.lineup ?? (original.data ? fromBackend(original.data.lineup) : null);
  if (!players.data || !first) return <p className="text-sm text-muted">Analysing your squad…</p>;

  // Each gameweek: the saved lineup, else (no plan) the backend's best XI, else the previous gameweek's.
  const gameweeks = players.data.gameweeks;
  const perGw: Lineup[] = [];
  gameweeks.forEach((g, k) => {
    const saved = team.plan?.lineups?.[String(g)];
    const best = team.plan ? undefined : original.data?.lineups.find((l) => l.gameweek === g);
    perGw.push(saved ?? (best ? fromBackend(best) : (perGw[k - 1] ?? first)));
  });
  const pos = new Map(players.data.players.map((p) => [p.id, p.position]));
  const toDraft = (l: Lineup) => draftFromLineup(l, (id) => pos.get(id) ?? "MID");
  const initials: [Draft, ...Draft[]] = [toDraft(perGw[0] ?? first), ...perGw.slice(1).map(toDraft)];
  const initialAdjust = gameweeks.map((g) => team.plan?.bankAdjust?.[String(g)] ?? 0);
  const key = JSON.stringify([team.playerIds, team.plan ?? null]);
  return (
    <PlannerBody
      key={key}
      team={team}
      players={players.data.players}
      gameweeks={gameweeks}
      initials={initials}
      initialAdjust={initialAdjust}
      gwIdx={Math.min(gwIdx, Math.max(0, gameweeks.length - 1))}
      setGwIdx={setGwIdx}
    />
  );
}
