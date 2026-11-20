import { Link, NavLink } from "react-router";
import { useStatus } from "../../api/queries";
import { formatKickoff } from "../../lib/format";

const PAGES = [
  { to: "/", label: "Predictions" },
  { to: "/my-team", label: "My team" },
  { to: "/fixtures", label: "Fixtures" },
];

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
        <nav aria-label="Pages" className="flex gap-1 text-sm">
          {PAGES.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end
              className={({ isActive }) =>
                `rounded-md px-2 py-0.5 font-medium ${isActive ? "bg-accent-soft text-accent-strong" : "text-muted hover:text-ink"}`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
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
