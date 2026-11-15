/**
 * A fake backend for tests: replaces global fetch, routes "METHOD /path" to a handler and
 * records every request so tests can assert on what the UI asked for.
 */
import { vi } from "vitest";

export interface Call {
  method: string;
  url: URL;
  body: unknown;
}

type Body = Record<string, unknown> | unknown[]; // a JSON body (plain objects only, so it can't be a function)
type Result = Response | Body | Promise<Response | Body>;
type Handler = Result | ((call: Call) => Result);

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function mockApi(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const call: Call = {
      method: init?.method ?? "GET",
      url: new URL(href, "http://localhost"),
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
    };
    calls.push(call);
    const handler = routes[`${call.method} ${call.url.pathname}`];
    if (handler === undefined) return json(404, { detail: "Not Found" });
    const result: Response | Body = await (typeof handler === "function" ? handler(call) : handler);
    return result instanceof Response ? result : json(200, result);
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    calls,
    /** Requests to one path, e.g. callsTo("/api/predictions"). */
    callsTo: (path: string) => calls.filter((c) => c.url.pathname === path),
  };
}

/** A promise you resolve from the test, to hold a request "in flight". */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
