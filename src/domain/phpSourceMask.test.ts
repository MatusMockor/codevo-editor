import { describe, expect, it } from "vitest";
import { maskPhpSource, memoizePhpMask } from "./phpSourceMask";

function syntheticPhpSource(label: string, targetBytes: number): string {
  const line = `$total += compute($items[$index], '${label}-single', "double $quoted ${label}"); // trailing ${label}\n`;
  const repeats = Math.ceil(targetBytes / line.length);
  return `<?php\n${line.repeat(repeats)}`;
}

function expectMaskInvariants(source: string, masked: string): void {
  expect(masked.length).toBe(source.length);

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") {
      expect(masked[index]).toBe("\n");
    }
  }

  expect(masked.includes("'")).toBe(false);
  expect(masked.includes('"')).toBe(false);
}

describe("maskPhpSource memoization", () => {
  it("masks strings and comments while preserving length and newlines", () => {
    const source = syntheticPhpSource("alpha", 2_000);
    const masked = maskPhpSource(source);

    expectMaskInvariants(source, masked);
    expect(masked.includes("alpha-single")).toBe(false);
    expect(masked.includes("trailing alpha")).toBe(false);
    expect(masked.includes("$total += compute($items[$index],")).toBe(true);
  });

  it("returns identical output for repeated calls with the same source", () => {
    const source = syntheticPhpSource("repeat", 2_000);
    const first = maskPhpSource(source);
    const second = maskPhpSource(source);
    const third = maskPhpSource(source);

    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("returns identical output for equal content held in a different string instance", () => {
    const original = syntheticPhpSource("copy", 2_000);
    const duplicate = syntheticPhpSource("copy", 2_000);

    expect(maskPhpSource(duplicate)).toBe(maskPhpSource(original));
  });

  it("masks distinct sources correctly while the memo is full", () => {
    const sources = ["one", "two", "three", "four", "five", "six"].map((label) =>
      syntheticPhpSource(label, 1_000),
    );
    const maskedFirstPass = sources.map((source) => maskPhpSource(source));

    sources.forEach((source, index) => {
      const masked = maskedFirstPass[index] ?? "";
      expectMaskInvariants(source, masked);
      expect(masked.includes(`$quoted`)).toBe(false);
    });
  });

  it("re-masks an evicted source to the same output", () => {
    const sources = ["ev-a", "ev-b", "ev-c", "ev-d", "ev-e", "ev-f"].map((label) =>
      syntheticPhpSource(label, 1_000),
    );
    const firstSource = sources[0] ?? "";
    const firstMasked = maskPhpSource(firstSource);

    sources.slice(1).forEach((source) => maskPhpSource(source));

    const remasked = maskPhpSource(firstSource);

    expect(remasked).toEqual(firstMasked);
    expectMaskInvariants(firstSource, remasked);
  });

  it("serves repeated masking of a large source from the memo", () => {
    const source = syntheticPhpSource("perf", 200_000);

    const firstStart = performance.now();
    const firstMasked = maskPhpSource(source);
    const firstDuration = performance.now() - firstStart;

    expectMaskInvariants(source, firstMasked);

    const repeatedStart = performance.now();
    for (let iteration = 0; iteration < 50; iteration += 1) {
      const masked = maskPhpSource(source);
      expect(masked.length).toBe(source.length);
    }
    const repeatedDuration = performance.now() - repeatedStart;

    expect(repeatedDuration).toBeLessThan(Math.max(firstDuration * 3, 25));
  });
});

describe("memoizePhpMask", () => {
  it("computes each distinct source once while within capacity", () => {
    let calls = 0;
    const memoized = memoizePhpMask((source) => {
      calls += 1;
      return source.toUpperCase();
    });

    expect(memoized("abc")).toBe("ABC");
    expect(memoized("abc")).toBe("ABC");
    expect(memoized("def")).toBe("DEF");
    expect(memoized("abc")).toBe("ABC");
    expect(calls).toBe(2);
  });

  it("recomputes a source evicted past capacity", () => {
    let calls = 0;
    const memoized = memoizePhpMask((source) => {
      calls += 1;
      return source.toUpperCase();
    }, 2);

    memoized("a");
    memoized("b");
    memoized("c");
    expect(calls).toBe(3);

    expect(memoized("a")).toBe("A");
    expect(calls).toBe(4);
  });

  it("keeps recently used entries alive under eviction pressure", () => {
    let calls = 0;
    const memoized = memoizePhpMask((source) => {
      calls += 1;
      return source.toUpperCase();
    }, 2);

    memoized("a");
    memoized("b");
    memoized("a");
    memoized("c");
    expect(memoized("a")).toBe("A");
    expect(calls).toBe(3);
  });
});
