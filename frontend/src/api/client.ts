/** Small fetch wrapper: JSON in, JSON out, and one error type with a readable message. */

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** FastAPI errors look like {"detail": "text"} or, for validation errors, {"detail": [{loc, msg}, ...]}. */
export function errorMessage(body: unknown, status: number): string {
  if (typeof body === "object" && body !== null && "detail" in body) {
    const detail = body.detail;
    if (typeof detail === "string" && detail) return detail;
    if (Array.isArray(detail)) {
      const parts = detail.flatMap((item: unknown) => {
        if (typeof item !== "object" || item === null || !("msg" in item) || typeof item.msg !== "string") return [];
        const loc: unknown = "loc" in item && Array.isArray(item.loc) ? item.loc.at(-1) : undefined;
        return [typeof loc === "string" ? `${loc}: ${item.msg}` : item.msg];
      });
      if (parts.length) return `Invalid request (${parts.join("; ")})`;
    }
  }
  return `Request failed (${status})`;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    res = await fetch(path, { ...init, headers });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e; // cancelled by TanStack Query
    throw new ApiError(0, "Couldn't reach the server. Is scripts/serve.py running?");
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, errorMessage(body, res.status));
  // The shape is described by the generated OpenAPI types (schema.gen.ts), which the backend's
  // tests keep in sync with the real response models.
  return body as T;
}
