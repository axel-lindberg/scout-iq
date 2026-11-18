import type { SquadPlayerBrief, TeamAnalysis, Transfer } from "../../api/endpoints";

const signed = (n: number, digits = 1) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(digits)}`;

function Names({ players }: { players: SquadPlayerBrief[] }) {
  return (
    <>
      {players.map((p, i) => (
        <span key={p.id}>
          {i > 0 && " + "}
          <span className="font-semibold">{p.name}</span>{" "}
          <span className="text-muted">
            {p.team} £{p.price.toFixed(1)}m
          </span>
        </span>
      ))}
    </>
  );
}

function Move({ t, gameweeks }: { t: Transfer; gameweeks: readonly number[] }) {
  const label = `Sell ${t.out.map((p) => p.name).join(" and ")}, buy ${t.in.map((p) => p.name).join(" and ")}`;
  return (
    <li aria-label={label} className="rounded-lg border border-line bg-surface-2 px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[13px]">
          <span className="text-bad">Sell</span> <Names players={t.out} /> <span aria-hidden="true">→</span>{" "}
          <span className="text-accent">Buy</span> <Names players={t.in} />
        </p>
        <p className="font-mono text-[15px] font-semibold tabular-nums">
          {signed(t.net_gain)} <span className="text-xs font-normal text-muted">net pts</span>
        </p>
      </div>
      <ul className="mt-1 flex flex-wrap gap-1.5 text-[11px]" aria-label="Gain per gameweek">
        {t.gain_per_gameweek.map((g, i) => (
          <li key={gameweeks[i]} className="rounded bg-bg px-1.5 py-px font-mono tabular-nums">
            GW{gameweeks[i]} {signed(g)}
          </li>
        ))}
        {t.hits > 0 && <li className="rounded bg-bad-soft px-1.5 py-px font-mono text-bad">hit −{t.hits}</li>}
        <li className="px-1 text-muted">bank after £{t.bank_after.toFixed(1)}m</li>
      </ul>
    </li>
  );
}

/** Best transfers by expected points gained over the horizon, minus 4 per extra transfer. */
export function Transfers({ analysis }: { analysis: TeamAnalysis }) {
  const { gameweeks, transfers, transfer_pairs: pairs } = analysis;
  const best = transfers[0];
  return (
    <div className="space-y-4">
      {best && best.net_gain <= 0 && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm">
          No single transfer gains points after hits. Consider saving the free transfer.
        </p>
      )}
      <section aria-labelledby="singles-h">
        <h4 id="singles-h" className="mb-1.5 text-sm font-semibold">
          Best single transfers
        </h4>
        {transfers.length === 0 ? (
          <p className="text-sm text-muted">No legal transfer within your budget.</p>
        ) : (
          <ol className="space-y-1.5">
            {transfers.slice(0, 5).map((t) => (
              <Move key={`${t.out[0]?.id ?? 0}-${t.in[0]?.id ?? 0}`} t={t} gameweeks={gameweeks} />
            ))}
          </ol>
        )}
      </section>
      {pairs.length > 0 && (
        <section aria-labelledby="pairs-h">
          <h4 id="pairs-h" className="mb-1.5 text-sm font-semibold">
            Two transfers together
          </h4>
          <ol className="space-y-1.5">
            {pairs.slice(0, 3).map((t) => (
              <Move key={[...t.out, ...t.in].map((p) => p.id).join("-")} t={t} gameweeks={gameweeks} />
            ))}
          </ol>
        </section>
      )}
      <p className="text-xs text-muted">
        Gain = how many more expected points your best XI (with captain) scores over GW{gameweeks[0]}–GW
        {gameweeks.at(-1)}, minus 4 for each transfer beyond your free ones. Only legal moves: same position, within
        bank + selling price, at most 3 per club.
      </p>
    </div>
  );
}
