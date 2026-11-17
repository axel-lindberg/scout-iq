import type { SquadPlayer, TeamAnalysis } from "../../api/endpoints";
import { POSITION_ORDER } from "../../lib/squad";

const FLAG_DOT = { fit: "bg-accent", doubtful: "bg-warn", out: "bg-bad" } as const;

function Chip({ p, bench }: { p: SquadPlayer; bench?: number }) {
  const next = p.gameweeks[0];
  const role = p.is_captain ? "C" : p.is_vice_captain ? "V" : null;
  return (
    <li
      className="relative flex w-[88px] flex-col items-center rounded-lg border border-line bg-surface px-1 pt-2 pb-1.5 text-center shadow-[0_1px_2px_rgb(0_0_0/0.08)]"
      aria-label={`${p.name}${p.is_captain ? ", captain" : p.is_vice_captain ? ", vice-captain" : ""}${bench ? `, bench ${bench}` : ""}`}
    >
      {role && (
        <span
          className={`absolute -top-2 -right-1.5 grid size-5 place-items-center rounded-full text-[11px] font-bold ${role === "C" ? "bg-ink text-surface" : "border border-line bg-surface text-ink"}`}
          aria-hidden="true"
        >
          {role}
        </span>
      )}
      <span className="flex max-w-full items-center gap-1">
        <span className={`size-1.5 shrink-0 rounded-full ${FLAG_DOT[p.availability]}`} aria-hidden="true" />
        <span className="truncate text-[13px] font-semibold">{p.name}</span>
      </span>
      <span className="max-w-full truncate text-[11px] text-muted">
        {p.team} · {next?.fixtures || "blank"}
      </span>
      <span className="font-mono text-[13px] font-medium tabular-nums">{(p.expected_points[0] ?? 0).toFixed(1)}</span>
    </li>
  );
}

/** The best XI for the next gameweek on a pitch, captain marked, bench below in order. */
export function Pitch({ analysis }: { analysis: TeamAnalysis }) {
  const byId = new Map(analysis.squad.map((p) => [p.id, p]));
  const starters = analysis.lineup.starters.flatMap((id) => byId.get(id) ?? []);
  const bench = analysis.lineup.bench.flatMap((id) => byId.get(id) ?? []);
  return (
    <figure aria-label={`Best XI for gameweek ${analysis.lineup.gameweek}`}>
      <div className="space-y-3 rounded-xl border border-line bg-accent-soft px-2 py-4 sm:px-4">
        {POSITION_ORDER.map((pos) => (
          <ul key={pos} aria-label={pos} className="flex flex-wrap justify-center gap-2">
            {starters
              .filter((p) => p.position === pos)
              .map((p) => (
                <Chip key={p.id} p={p} />
              ))}
          </ul>
        ))}
      </div>
      <p className="mt-3 mb-1.5 text-xs font-semibold tracking-[0.05em] text-muted uppercase">Bench, in order</p>
      <ul aria-label="Bench" className="flex flex-wrap gap-2">
        {bench.map((p, i) => (
          <Chip key={p.id} p={p} bench={i + 1} />
        ))}
      </ul>
      <figcaption className="mt-2 text-xs text-muted">
        {analysis.lineup.formation} · {analysis.lineup.expected_points.toFixed(1)} expected points with the captain
        doubled. C = captain, V = vice-captain; the dot shows availability.
      </figcaption>
    </figure>
  );
}
