import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import type { TeamAnalysis } from "../../api/endpoints";
import { queryKeys, useLoadTeam } from "../../api/queries";
import { Card } from "../../components/Card";
import {
  rememberedTeamId,
  rememberTeamId,
  requestFor,
  saveTeam,
  useSavedTeam,
  type SavedTeam,
} from "../../lib/teamStore";
import { Planner } from "./Planner";
import { SquadBuilder } from "./SquadBuilder";
import { TeamSettings } from "./TeamSettings";

function LoadById({ onLoaded }: { onLoaded: (a: TeamAnalysis) => void }) {
  const id = useId();
  const load = useLoadTeam();
  const [teamId, setTeamId] = useState(rememberedTeamId);
  const [invalid, setInvalid] = useState(false);

  async function submit() {
    const n = Number(teamId.trim());
    if (!Number.isInteger(n) || n <= 0) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    rememberTeamId(String(n));
    try {
      onLoaded(await load.mutateAsync(n));
    } catch {
      /* shown below from load.error */
    }
  }

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-id`} className="text-xs font-medium text-muted">
          FPL team ID
        </label>
        <input
          id={`${id}-id`}
          className="field w-40 tabular-nums"
          inputMode="numeric"
          autoComplete="off"
          placeholder="e.g. 1234567"
          value={teamId}
          aria-invalid={invalid}
          aria-describedby={`${id}-help`}
          onChange={(e) => {
            setTeamId(e.target.value);
          }}
        />
      </div>
      <button type="submit" className="btn btn-primary" disabled={load.isPending}>
        {load.isPending ? "Loading…" : "Load team"}
      </button>
      <p id={`${id}-help`} className="w-full text-xs text-muted">
        The number in your Points page address: fantasy.premierleague.com/entry/<b>1234567</b>/event/… Public data
        only: scout-iq never asks for your FPL password.
      </p>
      {invalid && (
        <p role="alert" className="w-full text-sm text-bad">
          A team ID is a whole number, like 1234567.
        </p>
      )}
      {load.error && !invalid && (
        <p role="alert" className="w-full text-sm text-bad">
          Couldn't load the team: {load.error.message}
        </p>
      )}
    </form>
  );
}

/** The My team page body: load or pick a squad, then the analysis. */
export function MyTeamPanel() {
  const team = useSavedTeam();
  const queryClient = useQueryClient();
  const [building, setBuilding] = useState(false);

  const onLoaded = (a: TeamAnalysis) => {
    const t: SavedTeam = {
      source: "fpl",
      playerIds: a.player_ids,
      bank: a.bank,
      freeTransfers: a.free_transfers,
      entry: a.entry ?? null,
      plan: null,
    };
    queryClient.setQueryData(queryKeys.team(requestFor(t)), a); // no second request for the same squad
    saveTeam(t);
    setBuilding(false);
  };

  const onBuilt = (ids: number[]) => {
    saveTeam({ source: "manual", playerIds: ids, bank: team?.bank ?? 0, freeTransfers: team?.freeTransfers ?? 1, entry: null, plan: null });
    setBuilding(false);
  };

  const entry = team?.entry;
  return (
    <div className="min-w-0 space-y-4">
      <Card aria-labelledby="team-h">
        <h2 id="team-h" className="heading mb-3 text-[22px]">
          My team
        </h2>
        {building ? (
          <SquadBuilder
            initial={team?.playerIds ?? []}
            onDone={onBuilt}
            onCancel={() => {
              setBuilding(false);
            }}
          />
        ) : (
          <div className="space-y-3">
            <LoadById onLoaded={onLoaded} />
            <p className="text-sm">
              <span className="text-muted">No team ID?</span>{" "}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-accent"
                onClick={() => {
                  setBuilding(true);
                }}
              >
                {team ? "Edit the squad by hand" : "Pick your 15 players by hand"}
              </button>
            </p>
          </div>
        )}
        {team && !building && (
          <div className="mt-4 space-y-3 border-t border-line pt-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm">
                {entry ? (
                  <>
                    <span className="font-semibold">{entry.team_name}</span>{" "}
                    <span className="text-muted">
                      · squad at the GW{entry.picks_gameweek} deadline
                      {entry.overall_rank ? ` · overall rank ${entry.overall_rank.toLocaleString()}` : ""}
                    </span>
                  </>
                ) : (
                  <span className="font-semibold">Squad picked by hand</span>
                )}
              </p>
              <button
                type="button"
                className="text-xs text-muted underline underline-offset-2 hover:text-ink"
                onClick={() => {
                  saveTeam(null);
                }}
              >
                Forget this team
              </button>
            </div>
            <TeamSettings key={`${team.source}-${team.playerIds.join(",")}`} team={team} />
          </div>
        )}
      </Card>
      {team && !building && <Planner team={team} />}
    </div>
  );
}
