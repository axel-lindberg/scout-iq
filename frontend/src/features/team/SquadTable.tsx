import type { SquadPlayer, TeamAnalysis } from "../../api/endpoints";
import { AvailabilityBadge } from "../../components/AvailabilityBadge";
import { aheadOpacity } from "../../lib/format";
import type { Lineup } from "../../lib/plan";

function Row({ p, gameweeks, lineup }: { p: SquadPlayer; gameweeks: readonly number[]; lineup: Lineup | null }) {
  const captain = lineup ? lineup.captain === p.id : p.is_captain;
  const vice = lineup ? lineup.vice === p.id : p.is_vice_captain;
  return (
    <tr>
      <th scope="row" className="px-2 py-1.5 text-left font-normal whitespace-nowrap">
        <span className="font-semibold">{p.name}</span> <span className="text-muted">{p.team}</span>
        {captain && <span className="ml-1 text-xs font-bold">(C)</span>}
        {vice && <span className="ml-1 text-xs font-bold">(V)</span>}
      </th>
      <td className="px-2 py-1.5 text-[12px] font-semibold">{p.position}</td>
      <td className="px-2 py-1.5 text-right font-mono text-[13px] tabular-nums">{p.price.toFixed(1)}</td>
      {gameweeks.map((gw, i) => {
        const g = p.gameweeks.find((x) => x.gameweek === gw);
        return (
          <td key={gw} className="px-2 py-1 text-right whitespace-nowrap" style={{ opacity: aheadOpacity(i) }}>
            <span className="block font-mono text-[13px] tabular-nums">{(p.expected_points[i] ?? 0).toFixed(1)}</span>
            <span className="block text-[11px] text-muted">{g?.fixtures || "blank"}</span>
          </td>
        );
      })}
      <td className="px-2 py-1.5 text-right font-mono font-medium tabular-nums">
        {p.expected_points_horizon_adjusted.toFixed(1)}
      </td>
      <td className="px-2 py-1.5">
        <AvailabilityBadge player={p} />
      </td>
    </tr>
  );
}

/**
 * Every squad player's expected points per gameweek (later ones faded: less certain). Grouped by
 * `lineup` (your XI and bench order) when given, else by the backend's best XI.
 */
export function SquadTable({ analysis, lineup = null }: { analysis: TeamAnalysis; lineup?: Lineup | null }) {
  const { gameweeks } = analysis;
  const byId = new Map(analysis.squad.map((p) => [p.id, p]));
  const starters = lineup ? lineup.starters.flatMap((id) => byId.get(id) ?? []) : analysis.squad.filter((p) => p.in_xi);
  const bench = lineup ? lineup.bench.flatMap((id) => byId.get(id) ?? []) : analysis.squad.filter((p) => !p.in_xi);
  const order = ["GK", "DEF", "MID", "FWD"];
  if (lineup) starters.sort((a, b) => order.indexOf(a.position) - order.indexOf(b.position));
  const head = "px-2 py-1.5 font-semibold";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm [&_td]:border-b [&_td]:border-line [&_tbody_th]:border-b [&_tbody_th]:border-line">
        <caption className="sr-only">Expected points per gameweek for every player in the squad</caption>
        <thead>
          <tr className="text-left text-xs tracking-[0.04em] text-muted uppercase [&_th]:border-b [&_th]:border-line">
            <th scope="col" className={head}>
              Player
            </th>
            <th scope="col" className={head}>
              Pos
            </th>
            <th scope="col" className={`${head} text-right`}>
              £m
            </th>
            {gameweeks.map((gw, i) => (
              <th
                key={gw}
                scope="col"
                className={`${head} text-right`}
                style={{ opacity: aheadOpacity(i) }}
                title={i ? `${i} gameweek${i > 1 ? "s" : ""} after the next: less certain` : "Next gameweek"}
              >
                GW{gw}
              </th>
            ))}
            <th scope="col" className={`${head} text-right`}>
              Total
            </th>
            <th scope="col" className={head}>
              Availability
            </th>
          </tr>
        </thead>
        <tbody>
          {starters.map((p) => (
            <Row key={p.id} p={p} gameweeks={gameweeks} lineup={lineup} />
          ))}
          <tr>
            <td colSpan={gameweeks.length + 5} className="px-2 pt-3 pb-1 text-xs font-semibold tracking-[0.05em] text-muted uppercase">
              Bench
            </td>
          </tr>
          {bench.map((p) => (
            <Row key={p.id} p={p} gameweeks={gameweeks} lineup={lineup} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
