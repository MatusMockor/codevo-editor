import { describe, expect, it } from "vitest";
import { relativeTime } from "./relativeTime";

describe("relativeTime", () => {
  const now = 1_700_000_000_000;

  it("reports 'just now' for sub-minute deltas", () => {
    expect(relativeTime(now - 30_000, now)).toBe("just now");
  });

  it("reports minutes ago", () => {
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5 minutes ago");
  });

  it("uses singular units", () => {
    expect(relativeTime(now - 60 * 60_000, now)).toBe("1 hour ago");
  });

  it("reports days ago", () => {
    expect(relativeTime(now - 3 * 86400_000, now)).toBe("3 days ago");
  });

  it("never reports negative time for future timestamps", () => {
    expect(relativeTime(now + 60_000, now)).toBe("just now");
  });
});
