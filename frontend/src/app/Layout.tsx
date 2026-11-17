import { Outlet } from "react-router";
import { StatusHeader } from "../features/status/StatusHeader";

/** Shared page frame: header with season status, then the current page. */
export function Layout() {
  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-accent px-3 py-2 text-on-accent focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <StatusHeader />
      <main id="main" tabIndex={-1} className="mx-auto max-w-[1400px] px-4 py-4 outline-none sm:px-6 sm:py-5">
        <Outlet />
      </main>
    </div>
  );
}
