import { useEffect, useRef } from "react";
import type { ComparedPlayer, Comparison } from "../../api/endpoints";
import { useComparison } from "../../api/queries";
import { AvailabilityBadge } from "../../components/AvailabilityBadge";
import { ErrorText } from "../../components/Card";
import { fmt } from "../../lib/format";

interface Props {
  names: string[];
  onClose: () => void;
}

function PlayerCard({ p }: { p: ComparedPlayer }) {
  const f = p.recent_form;
  const rows: [string, string][] = [
    ["Avg pts, last 5", fmt(f.avg_points_last5, 2)],
    ["Avg mins, last 3", fmt(f.avg_minutes_last3, 1)],
    ["Avg xGI, last 5", fmt(f.avg_xgi_last5, 2)],
    ["Season avg pts", fmt(f.season_avg_points, 2)],
  ];
  return (
    <article className="rounded-lg border border-line bg-surface p-3 text-[13px]" aria-label={p.name}>
      <h4 className="heading text-lg">{p.name}</h4>
      <p className="text-muted">
        {p.team} · {p.position} · £{p.price.toFixed(1)}m · {p.fixtures}
      </p>
      <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
        <dt className="text-muted">xPts</dt>
        <dd className="text-right font-mono text-[15px] font-medium tabular-nums">
          {p.expected_points_adjusted.toFixed(2)}
        </dd>
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd className="text-right font-mono tabular-nums">{value}</dd>
          </div>
        ))}
        <dt className="text-muted">Availability</dt>
        <dd className="text-right">
          <AvailabilityBadge player={p} tooltip={false} />
        </dd>
      </dl>
      {p.news && <p className="mt-2 border-t border-line pt-2 text-muted">{p.news}</p>}
    </article>
  );
}

/** What the backend couldn't match: names it can't tell apart, and names it doesn't know. */
function MatchProblems({ data }: { data: Comparison }) {
  const ambiguous = Object.entries(data.ambiguous ?? {});
  const notFound = data.not_found ?? [];
  if (!ambiguous.length && !notFound.length) return null;
  return (
    <div role="status" className="mb-3 space-y-1 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-ink">
      {ambiguous.map(([name, options]) => (
        <p key={name}>
          <strong>“{name}”</strong> matches several players: {options.join(", ")}. Not shown.
        </p>
      ))}
      {notFound.length > 0 && (
        <p>
          <strong>Not found:</strong> {notFound.map((n) => `“${n}”`).join(", ")} (not in this season's squads).
        </p>
      )}
    </div>
  );
}

export function ComparePanel({ names, onClose }: Props) {
  const { data, error, isPending } = useComparison(names);
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus(); // move keyboard and screen-reader users to the result
  }, [names]);

  useEffect(() => {
    // Escape closes the comparison while focus is inside it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && panel.current?.contains(document.activeElement)) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <section ref={panel} aria-labelledby="cmp-h" className="mb-4 rounded-xl border border-line bg-surface-2 p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 id="cmp-h" ref={heading} tabIndex={-1} className="heading text-xl outline-none">
          Comparison
        </h3>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
      {isPending && <p className="text-sm text-muted">Comparing…</p>}
      {error && <ErrorText>Couldn't compare players: {error.message}</ErrorText>}
      {data && (
        <>
          <MatchProblems data={data} />
          {data.players.length > 0 ? (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2.5">
              {data.players.map((p) => (
                <PlayerCard key={`${p.full_name}-${p.team}`} p={p} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">No players to compare.</p>
          )}
        </>
      )}
    </section>
  );
}
