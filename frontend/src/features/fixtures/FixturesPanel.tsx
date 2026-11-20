import { useId } from "react";
import { useSearchParams } from "react-router";
import type { FixtureTeam, RatedFixture } from "../../api/endpoints";
import { useFixtures } from "../../api/queries";
import { Card, ErrorText } from "../../components/Card";
import { Shirt } from "../../components/Shirt";
import { Tooltip } from "../../components/Tooltip";
import {
  describe,
  label,
  LEVEL_NAME,
  levelOf,
  MODES,
  readView,
  scoreOf,
  sortTeams,
  writeView,
  type Level,
  type Mode,
  type View,
} from "../../lib/difficulty";
import { TeamPicker } from "./TeamPicker";

// Full class names, so Tailwind sees them.
const FILL: Record<Level, string> = {
  1: "bg-fdr-1 text-fdr-1-ink",
  2: "bg-fdr-2 text-fdr-2-ink",
  3: "bg-fdr-3 text-fdr-3-ink",
  4: "bg-fdr-4 text-fdr-4-ink",
  5: "bg-fdr-5 text-fdr-5-ink",
};
const LEVELS: Level[] = [1, 2, 3, 4, 5];

function Fixture({ f, mode }: { f: RatedFixture; mode: Mode }) {
  return (
    <Tooltip
      content={describe(f, mode)}
      className={`block w-full rounded px-1 py-1 text-center text-[12px] leading-tight font-semibold whitespace-nowrap sm:text-[13px] ${FILL[levelOf(scoreOf(f, mode))]}`}
    >
      {label(f)}
    </Tooltip>
  );
}

function Row({ team, mode, gameweeks }: { team: FixtureTeam; mode: Mode; gameweeks: readonly number[] }) {
  const n = team.gameweeks.reduce((s, c) => s + c.fixtures.length, 0);
  return (
    <tr className="group bg-surface hover:bg-surface-2">
      <th scope="row" className="sticky left-0 z-[1] bg-surface px-2 py-1.5 text-left group-hover:bg-surface-2">
        <span className="flex items-center gap-2 whitespace-nowrap">
          <Shirt teamCode={team.code} size={22} className="h-auto w-[22px] shrink-0" />
          <span>
            <span className="font-semibold">{team.short_name}</span>{" "}
            <span className="hidden font-normal text-muted md:inline">{team.name}</span>
          </span>
        </span>
      </th>
      <td className="px-2 py-1.5 text-right whitespace-nowrap">
        <span className="font-mono font-semibold tabular-nums">{team.totals[mode].toFixed(2)}</span>
        {n !== gameweeks.length && (
          <span className="block text-[11px] text-muted">
            {n} {n === 1 ? "match" : "matches"}
          </span>
        )}
      </td>
      {team.gameweeks.map((cell) => (
        <td key={cell.gameweek} className="min-w-[76px] px-1 py-1 align-middle">
          {cell.fixtures.length === 0 ? (
            <span className="block rounded border border-dashed border-line py-1 text-center text-muted">
              <span aria-hidden="true">—</span>
              <span className="sr-only">Blank gameweek</span>
            </span>
          ) : (
            <span className="flex flex-col gap-0.5">
              {cell.fixtures.map((f) => (
                <Fixture key={`${f.opponent}${f.kickoff_time}`} f={f} mode={mode} />
              ))}
            </span>
          )}
        </td>
      ))}
    </tr>
  );
}

export function FixturesPanel() {
  const id = useId();
  const { data, error, isPending } = useFixtures();
  const [params, setParams] = useSearchParams();
  const view = readView(params);
  const setView = (patch: Partial<View>) => {
    setParams(writeView({ ...view, ...patch }), { replace: true });
  };

  const known = new Set(data?.teams.map((t) => t.short_name));
  const selected = view.teams === null ? null : view.teams.filter((t) => known.has(t));
  const rows = sortTeams(data?.teams ?? [], view.mode, view.order).filter(
    (t) => selected === null || selected.includes(t.short_name),
  );
  const gameweeks = data?.gameweeks ?? [];
  const modeLabel = MODES.find((m) => m.value === view.mode)?.label ?? "Overall";

  return (
    <Card aria-labelledby={`${id}-h`} className="min-w-0">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`${id}-h`} className="heading text-[22px]">
          Fixture difficulty
        </h2>
        {data && data.gameweeks.length > 0 && (
          <p className="text-xs text-muted">
            GW {data.gameweeks[0]}–{data.gameweeks.at(-1)} · from this season&apos;s xG
          </p>
        )}
      </div>
      <p className="mb-4 max-w-[70ch] text-[13px] text-muted">
        Each fixture is rated against an average one (1.00), with home advantage. The run is the sum over the
        gameweeks, so a double gameweek counts twice and a blank adds nothing. Hover a fixture for the numbers.
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-x-5 gap-y-3">
        <fieldset>
          <legend className="text-xs font-medium text-muted">Rate by</legend>
          <div className="mt-1 inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
            {MODES.map((m) => (
              <label
                key={m.value}
                title={m.hint}
                className={`rounded-md px-3 py-1 text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${view.mode === m.value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}
              >
                <input
                  type="radio"
                  name={`${id}-mode`}
                  className="sr-only"
                  checked={view.mode === m.value}
                  onChange={() => {
                    setView({ mode: m.value });
                  }}
                />
                {m.label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-order`} className="text-xs font-medium text-muted">
            Sort
          </label>
          <select
            id={`${id}-order`}
            className="field"
            value={view.order}
            onChange={(e) => {
              setView({ order: e.target.value === "hardest" ? "hardest" : "easiest" });
            }}
          >
            <option value="easiest">Easiest run first</option>
            <option value="hardest">Hardest run first</option>
          </select>
        </div>
        <ul className="flex flex-wrap items-center gap-1 text-[11px]" aria-label="Colour key">
          {LEVELS.map((l) => (
            <li key={l} className={`rounded px-1.5 py-0.5 font-semibold ${FILL[l]}`}>
              {LEVEL_NAME[l]}
            </li>
          ))}
        </ul>
      </div>

      {data && data.teams.length > 0 && (
        <div className="mb-4">
          <TeamPicker
            teams={data.teams}
            selected={selected}
            onChange={(teams) => {
              setView({ teams });
            }}
          />
        </div>
      )}

      {isPending && <p className="text-sm text-muted">Loading fixtures…</p>}
      {error && <ErrorText>Couldn&apos;t load the fixtures: {error.message}</ErrorText>}
      {data && data.teams.length === 0 && (
        <p className="text-sm text-muted">No fixture ratings yet. Run scripts/update.py and restart the server.</p>
      )}
      {data && data.teams.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm [&_td]:border-b [&_td]:border-line [&_th[scope=row]]:border-b [&_th[scope=row]]:border-line">
            <caption className="sr-only">
              Fixture difficulty by {modeLabel.toLowerCase()}, {view.order} run first. Higher run = easier.
            </caption>
            <thead>
              <tr className="text-left text-xs tracking-[0.04em] text-muted uppercase [&_th]:border-b [&_th]:border-line [&_th]:px-2 [&_th]:py-1.5 [&_th]:font-semibold">
                <th scope="col" className="sticky left-0 z-[1] bg-surface">
                  Team
                </th>
                <th scope="col" className="text-right" title="Sum of the fixture scores: higher = easier">
                  Run
                </th>
                {gameweeks.map((gw) => (
                  <th key={gw} scope="col" className="text-center">
                    GW {gw}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <Row key={t.id} team={t} mode={view.mode} gameweeks={gameweeks} />
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={gameweeks.length + 2} className="px-2 py-6 text-center text-sm text-muted">
                    No teams selected. Pick some above, or Show all.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
