import type { SquadPlayer, TeamAnalysis } from "../../api/endpoints";
import { AvailabilityBadge } from "../../components/AvailabilityBadge";
import { aheadOpacity } from "../../lib/format";

function Row({ p, gameweeks }: { p: SquadPlayer; gameweeks: readonly number[] }) {
  return (
    <tr>
      <th scope="row" className="px-2 py-1.5 text-left font-normal whitespace-nowrap">
        <span className="font-semibold">{p.name}</span> <span className="text-muted">{p.team}</span>
        {p.is_captain && <span className="ml-1 text-xs font-bold">(C)</span>}
        {p.is_vice_captain && <span className="ml-1 text-xs font-bold">(V)</span>}
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

/** Every squad player's expected points per gameweek (later ones faded: less certain). */
export function SquadTable({ analysis }: { analysis: TeamAnalysis }) {
  const { gameweeks } = analysis;
  const starters = analysis.squad.filter((p) => p.in_xi);
  const bench = analysis.squad.filter((p) => !p.in_xi);
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
            <Row key={p.id} p={p} gameweeks={gameweeks} />
          ))}
          <tr>
            <td colSpan={gameweeks.length + 5} className="px-2 pt-3 pb-1 text-xs font-semibold tracking-[0.05em] text-muted uppercase">
              Bench
            </td>
          </tr>
          {bench.map((p) => (
            <Row key={p.id} p={p} gameweeks={gameweeks} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
