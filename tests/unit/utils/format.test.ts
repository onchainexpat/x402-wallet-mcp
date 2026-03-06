import { describe, it, expect } from "vitest";
import {
  usdcToAtomic,
  atomicToUsdc,
  formatUsdc,
  parseUsdcAmount,
} from "../../../src/utils/format.js";

describe("usdcToAtomic", () => {
  it("converts whole numbers", () => {
    expect(usdcToAtomic("1")).toBe(1_000_000n);
    expect(usdcToAtomic("100")).toBe(100_000_000n);
    expect(usdcToAtomic("0")).toBe(0n);
  });

  it("converts decimals", () => {
    expect(usdcToAtomic("1.50")).toBe(1_500_000n);
    expect(usdcToAtomic("0.002")).toBe(2_000n);
    expect(usdcToAtomic("0.000001")).toBe(1n);
    expect(usdcToAtomic("5.00")).toBe(5_000_000n);
  });

  it("truncates beyond 6 decimals", () => {
    expect(usdcToAtomic("1.1234567")).toBe(1_123_456n);
    expect(usdcToAtomic("0.0000001")).toBe(0n);
  });

  it("pads short decimals", () => {
    expect(usdcToAtomic("1.5")).toBe(1_500_000n);
    expect(usdcToAtomic("1.05")).toBe(1_050_000n);
  });
});

describe("atomicToUsdc", () => {
  it("converts atomic to human-readable", () => {
    expect(atomicToUsdc(1_000_000n)).toBe("1.000000");
    expect(atomicToUsdc(1_500_000n)).toBe("1.500000");
    expect(atomicToUsdc(2_000n)).toBe("0.002000");
    expect(atomicToUsdc(1n)).toBe("0.000001");
    expect(atomicToUsdc(0n)).toBe("0.000000");
  });

  it("handles large amounts", () => {
    expect(atomicToUsdc(1_000_000_000_000n)).toBe("1000000.000000");
  });

  it("handles negative amounts", () => {
    expect(atomicToUsdc(-1_500_000n)).toBe("-1.500000");
  });
});

describe("formatUsdc", () => {
  it("formats with dollar sign and trimmed zeros", () => {
    expect(formatUsdc(1_500_000n)).toBe("$1.50");
    expect(formatUsdc(1_000_000n)).toBe("$1.00");
    expect(formatUsdc(2_000n)).toBe("$0.002");
    expect(formatUsdc(0n)).toBe("$0.00");
    expect(formatUsdc(100n)).toBe("$0.0001");
    expect(formatUsdc(1n)).toBe("$0.000001");
  });

  it("keeps at least 2 decimal places", () => {
    expect(formatUsdc(5_000_000n)).toBe("$5.00");
    expect(formatUsdc(10_000_000n)).toBe("$10.00");
  });

  it("handles large amounts", () => {
    expect(formatUsdc(50_000_000n)).toBe("$50.00");
    expect(formatUsdc(999_999_999n)).toBe("$999.999999");
  });
});

describe("parseUsdcAmount", () => {
  it("parses human-readable strings", () => {
    expect(parseUsdcAmount("1.50")).toBe(1_500_000n);
    expect(parseUsdcAmount("0.002")).toBe(2_000n);
  });

  it("treats long integer strings as atomic", () => {
    expect(parseUsdcAmount("1500000")).toBe(1_500_000n);
    expect(parseUsdcAmount("2000000")).toBe(2_000_000n);
  });

  it("treats short integers as human-readable", () => {
    expect(parseUsdcAmount("5")).toBe(5_000_000n);
    expect(parseUsdcAmount("100")).toBe(100_000_000n);
  });
});
