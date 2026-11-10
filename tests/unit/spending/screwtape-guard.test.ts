import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkWithScrewtape,
  isScrewtapeGuardEnabled,
} from "../../../src/spending/screwtape-guard.js";

const input = {
  url: "https://seller.example/report",
  payTo: "0xabc",
  amountAtomic: 5000n,
  network: "eip155:8453",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("isScrewtapeGuardEnabled", () => {
  it("is off by default", () => {
    expect(isScrewtapeGuardEnabled({})).toBe(false);
    expect(isScrewtapeGuardEnabled({ SCREWTAPE_API_KEY: "sk" })).toBe(false);
  });

  it("turns on only for an explicit flag", () => {
    expect(isScrewtapeGuardEnabled({ SCREWTAPE_GUARD: "1" })).toBe(true);
    expect(isScrewtapeGuardEnabled({ SCREWTAPE_GUARD: "true" })).toBe(true);
    expect(isScrewtapeGuardEnabled({ SCREWTAPE_GUARD: "yes" })).toBe(true);
    expect(isScrewtapeGuardEnabled({ SCREWTAPE_GUARD: "on" })).toBe(true);
    expect(isScrewtapeGuardEnabled({ SCREWTAPE_GUARD: "0" })).toBe(false);
  });
});

describe("checkWithScrewtape", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("allows a pass + unique result", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { verdict: "pass" }))
      .mockResolvedValueOnce(jsonResponse(200, { duplicate: { status: "unique" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await checkWithScrewtape(input, { SCREWTAPE_API_KEY: "sk_test" });
    expect(result).toEqual({ allowed: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect((firstInit.headers as Record<string, string>).Authorization).toBe("Bearer sk_test");
  });

  it("blocks a fail verdict", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(200, { verdict: "fail" })));
    const result = await checkWithScrewtape(input, {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/fail/);
  });

  it("blocks a duplicate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(jsonResponse(200, { verdict: "pass" }))
        .mockResolvedValueOnce(jsonResponse(200, { duplicate: { status: "duplicate" } })),
    );
    const result = await checkWithScrewtape(input, {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/duplicate/);
  });

  it("fails closed when the service is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const result = await checkWithScrewtape(input, {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/offline/);
  });

  it("fails open when configured", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const result = await checkWithScrewtape(input, { SCREWTAPE_FAIL_MODE: "open" });
    expect(result.allowed).toBe(true);
  });
});
