/**
 * Shared API client — the single network layer for the dashboard.
 *
 * All components should import { apiGet, apiPost, ... } instead of calling
 * fetch directly. Keeping request shaping, error normalization, and the base
 * URL in one place eliminates the per-file `API_BASE` + `if (!res.ok)` drift.
 */

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export class ApiError extends Error {
  status: number;
  detail?: unknown;

  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const hasBody = init.body !== undefined;
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  if (!res.ok) {
    let message = `Server responded ${res.status}`;
    let detail: unknown;
    try {
      detail = await res.json();
      if (typeof detail === "object" && detail !== null && "detail" in detail) {
        message = String((detail as { detail: string }).detail);
      }
    } catch {
      // response body was not JSON — keep the generic message
    }
    throw new ApiError(res.status, message, detail);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "PUT",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}

export async function apiBlob(path: string): Promise<Blob> {
  const res = await fetch(apiUrl(path));
  if (!res.ok) throw new ApiError(res.status, `Server responded ${res.status}`);
  return res.blob();
}

export function download(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}