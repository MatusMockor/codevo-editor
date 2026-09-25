import { describe, expect, it } from "vitest";
import {
  normalizeLastCloneParentPath,
  normalizeRecentWorkspaceOpenedAt,
  recordRecentWorkspaceOpenedAt,
} from "./projectOnboardingSettings";

describe("project onboarding settings", () => {
  it("keeps only an absolute bounded last clone parent", () => {
    expect(normalizeLastCloneParentPath("/Users/dev/src/")).toBe("/Users/dev/src");
    expect(normalizeLastCloneParentPath("relative")).toBeNull();
    expect(normalizeLastCloneParentPath(`/${"a".repeat(5000)}`)).toBeNull();
    expect(normalizeLastCloneParentPath("/a\u0000b")).toBeNull();
    expect(normalizeLastCloneParentPath(42)).toBeNull();
  });

  it("normalizes opened-at records to bounded positive integers", () => {
    expect(
      normalizeRecentWorkspaceOpenedAt({ "/a": 10, "/b": -1, c: 5, "/d": 1.5, "/e": "x" }),
    ).toEqual({ "/a": 10 });
    expect(normalizeRecentWorkspaceOpenedAt([])).toEqual({});
    expect(normalizeRecentWorkspaceOpenedAt(null)).toEqual({});
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`/p${i}`, i + 1]));
    const kept = normalizeRecentWorkspaceOpenedAt(many);
    expect(Object.keys(kept)).toHaveLength(25);
    expect(Math.min(...Object.values(kept))).toBe(16);
  });

  it("records the opened path and prunes paths that left the recent list", () => {
    expect(
      recordRecentWorkspaceOpenedAt({ "/old": 1, "/keep": 2 }, ["/new", "/keep"], "/new/", 99),
    ).toEqual({ "/keep": 2, "/new": 99 });
    expect(recordRecentWorkspaceOpenedAt(undefined, ["/a"], "/a", 5)).toEqual({ "/a": 5 });
  });
});
