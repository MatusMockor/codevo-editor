import { describe, expect, it } from "vitest";
import { localHistoryRelativeTime } from "./localHistory";

describe("localHistoryRelativeTime", () => {
  const now = 1_700_000_000_000;

  it("reports 'just now' for sub-minute deltas", () => {
    expect(localHistoryRelativeTime(now - 30_000, now)).toBe("just now");
  });

  it("reports minutes ago", () => {
    expect(localHistoryRelativeTime(now - 5 * 60_000, now)).toBe("5 minutes ago");
  });

  it("uses singular units", () => {
    expect(localHistoryRelativeTime(now - 60 * 60_000, now)).toBe("1 hour ago");
  });

  it("reports days ago", () => {
    expect(localHistoryRelativeTime(now - 3 * 86400_000, now)).toBe("3 days ago");
  });

  it("never reports negative time for future timestamps", () => {
    expect(localHistoryRelativeTime(now + 60_000, now)).toBe("just now");
  });
});
