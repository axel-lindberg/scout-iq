import { Link } from "react-router";
import { useStatus } from "../../api/queries";
import { formatKickoff } from "../../lib/format";

export function StatusHeader() {
  const { data, error, isPending } = useStatus();
  return (
    <header className="border-t-4 border-b border-t-accent border-b-line bg-surface">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-baseline gap-x-5 gap-y-1 px-4 py-3 sm:px-6">
        <h1 className="heading text-[26px] tracking-[0.02em]">
          <Link to="/" className="rounded-sm">
            scout<span className="text-accent">-iq</span>
          </Link>
        </h1>
        {isPending && <p className="text-sm text-muted">Loading…</p>}
        {error && (
          <p role="alert" className="text-sm">
            <span className="heading text-lg text-bad">Couldn't reach the server</span>{" "}
            <span className="text-muted">{error.message}</span>
          </p>
        )}
        {data && (
          <>
            <p className="heading text-lg font-semibold tracking-[0.04em]">
              {data.season} · Gameweek {data.gameweek}
            </p>
            <p className="text-[13px] text-muted">
              Data through GW {data.data_through_gw} · first kickoff{" "}
              <time dateTime={data.first_kickoff}>{formatKickoff(data.first_kickoff)}</time>
            </p>
          </>
        )}
      </div>
    </header>
  );
}
