// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});
afterEach(() => vi.restoreAllMocks());

it("retains dismissal in memory when storage fails", async () => {
  const store = await import("./browserComposerUsageDismissals");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage unavailable");
  });
  store.dismissComposerUsageWindows(["first"]);
  expect(store.parseComposerUsageDismissals(store.loadComposerUsageDismissals())).toEqual(
    new Set(["first"]),
  );
  store.dismissComposerUsageWindows(["second"]);
  expect(store.parseComposerUsageDismissals(store.loadComposerUsageDismissals())).toEqual(
    new Set(["first", "second"]),
  );
});

it("bounds retained identities and accepts its own escaped serialization", async () => {
  const store = await import("./browserComposerUsageDismissals");
  const keys = Array.from({ length: 70 }, (_, index) => `${index}:${"\u0001".repeat(4000)}`);
  store.dismissComposerUsageWindows(keys);
  expect([...store.parseComposerUsageDismissals(store.loadComposerUsageDismissals())]).toEqual(
    keys.slice(-64),
  );
});

it("rejects malformed and oversized persisted state", async () => {
  const store = await import("./browserComposerUsageDismissals");
  for (const raw of [
    "broken",
    "{}",
    "[1]",
    JSON.stringify(["x".repeat(4097)]),
    "x".repeat(1_600_000),
  ]) {
    expect(store.parseComposerUsageDismissals(raw).size).toBe(0);
  }
});
