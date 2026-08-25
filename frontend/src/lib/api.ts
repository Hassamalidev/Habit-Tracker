const RAW_BASE = import.meta.env.VITE_API_URL ?? "";
// In dev this stays empty and Vite proxies /api; in production it points at Render.
export const API_BASE = RAW_BASE.replace(/\/$/, "");

const TOKEN_KEY = "habit-token";

/** Identifies this tab so the server can skip echoing our own writes back. */
export const CLIENT_ID = (() => {
  const key = "habit-client-id";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
  }
  return id;
})();

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

/** Pull a readable sentence out of whatever shape FastAPI returned. */
async function explain(response: Response): Promise<string> {
  try {
    const body = await response.json();
    const detail = body?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail.length) {
      const first = detail[0];
      const field = Array.isArray(first?.loc) ? first.loc.at(-1) : null;
      const message = first?.msg ?? "Invalid value";
      return field ? `${field}: ${message}` : message;
    }
  } catch {
    /* fall through to the generic message below */
  }
  if (response.status === 401) return "Your session has expired. Please sign in again.";
  if (response.status >= 500) return "The server is unavailable. Try again shortly.";
  return `Request failed (${response.status})`;
}

export async function request<T>(
  path: string,
  options: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const { auth = true, headers, ...rest } = options;
  const token = getToken();

  const response = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      "X-Client-Id": CLIENT_ID,
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });

  if (response.status === 401 && auth) {
    // The token is gone or stale; drop it so the router falls back to sign-in.
    setToken(null);
    window.dispatchEvent(new CustomEvent("habit:signed-out"));
  }

  if (!response.ok) throw new ApiError(response.status, await explain(response));
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown, auth = true) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}), auth }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

/** The CSV export needs the token on a plain download, not an XHR response. */
export async function downloadCsv() {
  const response = await fetch(`${API_BASE}/api/analytics/export.csv`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!response.ok) throw new ApiError(response.status, await explain(response));

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `habits-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
