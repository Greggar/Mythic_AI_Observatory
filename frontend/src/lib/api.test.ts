import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiGet, apiPost, apiPut, apiDelete, apiBlob, apiUrl } from "./api";

const ORIGINAL_FETCH = globalThis.fetch;

const jsonResponse = (body: unknown, status = 200) => {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    blob: () => Promise.resolve(new Blob([JSON.stringify(body)])),
  } as Response;
};

const errorResponse = (status: number, detail: unknown) => {
  return {
    ok: false,
    status,
    json: () => Promise.resolve(detail),
  } as Response;
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("apiUrl", () => {
  it("prepends the base URL", () => {
    const url = apiUrl("/api/traces");
    expect(url.endsWith("/api/traces")).toBe(true);
  });
});

describe("apiGet", () => {
  it("returns parsed JSON on 2xx", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ id: "abc" }));
    const data = await apiGet<{ id: string }>("/api/traces/abc");
    expect(data.id).toBe("abc");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(init?.method).toBeUndefined();
    expect(init?.headers).toEqual({});
  });

  it("throws ApiError with parsed detail on non-2xx", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(errorResponse(404, { detail: "no such trace" }));
    const err = (await apiGet("/api/traces/missing").catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
    expect(err.message).toContain("no such trace");
  });

  it("falls back to a generic message when the error body is not JSON", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.reject(new Error("not json")),
    } as Response);
    const err = (await apiGet("/api/traces").catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(503);
    expect(err.message).toBe("Server responded 503");
  });

  it("returns undefined-shaped data on 204", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: () => Promise.reject(new Error("no body")),
    } as Response);
    await expect(apiGet("/api/traces/abc")).resolves.toBeUndefined();
  });
});

describe("request shaping (post/put/delete)", () => {
  it("apiPost sends JSON content-type only when a body exists", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    await apiPost("/api/models/select", { model: "qwen" });
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(init?.method).toBe("POST");
    expect(headers["Content-Type"]).toContain("application/json");
    expect(JSON.parse(init?.body as string)).toEqual({ model: "qwen" });
  });

  it("apiPost omits content-type when no body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    await apiPost("/api/network/scan");
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(init?.headers).toEqual({});
    expect(init?.body).toBeUndefined();
  });

  it("apiPut sends the body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    await apiPut("/api/schema", { content: "x" });
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(init?.body as string)).toEqual({ content: "x" });
  });

  it("apiDelete issues a DELETE without a body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    await apiDelete("/api/traces/abc");
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(init?.method).toBe("DELETE");
    expect(init?.body).toBeUndefined();
  });
});

describe("apiBlob", () => {
  it("returns a blob on 2xx", async () => {
    const blob = new Blob(["id,prompt\n1,hello"]);
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: () => Promise.resolve(blob) } as Response);
    const result = await apiBlob("/api/export/traces.csv");
    expect(await result.text()).toContain("id,prompt");
  });

  it("throws ApiError on non-2xx", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);
    await expect(apiBlob("/api/export/traces.csv")).rejects.toMatchObject({ status: 500 });
  });
});