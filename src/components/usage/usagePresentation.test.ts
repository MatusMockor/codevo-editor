import { describe, expect, it } from "vitest";
import type { AgentAccountUsageWindow } from "../../domain/agentAccountUsage";
import {
  latestUsageFetch,
  updatedLabel,
  usageLimitBarModel,
  usageProviderLimitsNotice,
  visibleUsageWindows,
} from "./usagePresentation";

const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);
const HOUR = 3_600_000;

function window(overrides: Partial<AgentAccountUsageWindow>): AgentAccountUsageWindow {
  return {
    id: "five_hour",
    label: "5-hour limit",
    usedPercent: 38,
    windowDurationMinutes: 300,
    resetsAtEpochMs: NOW + 2 * HOUR,
    resetsLabel: null,
    ...overrides,
  };
}

describe("usageLimitBarModel", () => {
  it("places the pace line at the elapsed share and flags spending ahead of pace", () => {
    const model = usageLimitBarModel(window({ usedPercent: 72 }), NOW);
    expect(model.elapsedPercent).toBe(60);
    expect(model.aheadOfPace).toBe(true);
    expect(model.hot).toBe(false);
    expect(model.usedLabel).toBe("72% used");
    expect(model.resetsLabel).toBe("Resets in 2h 0m");
  });

  it("omits the pace line when the reset time is only a label (Claude)", () => {
    const model = usageLimitBarModel(
      window({ resetsAtEpochMs: null, resetsLabel: "Sep 28 at 8am (Europe/Bratislava)" }),
      NOW,
    );
    expect(model.elapsedPercent).toBeNull();
    expect(model.aheadOfPace).toBe(false);
    expect(model.resetsLabel).toBe("Resets Sep 28 at 8am (Europe/Bratislava)");
    expect(model.ariaLabel).toBe(
      "5-hour limit: 38% used, resets Sep 28 at 8am (Europe/Bratislava)",
    );
  });

  it.each([
    { name: "0% window", usedPercent: 0, width: 0, hot: false, label: "0% used" },
    { name: "89.9% window", usedPercent: 89.9, width: 89.9, hot: false, label: "89.9% used" },
    { name: "90% window", usedPercent: 90, width: 90, hot: true, label: "90% used" },
    { name: "100% used", usedPercent: 100, width: 100, hot: true, label: "100% used" },
    { name: "above 100%", usedPercent: 140, width: 100, hot: true, label: "100% used" },
    { name: "negative", usedPercent: -5, width: 0, hot: false, label: "0% used" },
    { name: "NaN", usedPercent: Number.NaN, width: 0, hot: false, label: "0% used" },
    {
      name: "Infinity",
      usedPercent: Number.POSITIVE_INFINITY,
      width: 0,
      hot: false,
      label: "0% used",
    },
  ])("clamps the $name bar to 0-100", ({ usedPercent, width, hot, label }) => {
    const model = usageLimitBarModel(window({ usedPercent }), NOW);
    expect(model.usedPercent).toBe(width);
    expect(model.hot).toBe(hot);
    expect(model.usedLabel).toBe(label);
  });

  it.each([
    {
      name: "reset already passed",
      overrides: { resetsAtEpochMs: NOW - HOUR },
      elapsed: 100,
      reset: "Reset passed",
    },
    {
      name: "unknown window length",
      overrides: { windowDurationMinutes: null },
      elapsed: null,
      reset: "Resets in 2h 0m",
    },
    {
      name: "zero window length",
      overrides: { windowDurationMinutes: 0 },
      elapsed: null,
      reset: "Resets in 2h 0m",
    },
    {
      name: "reset further away than the window",
      overrides: { resetsAtEpochMs: NOW + 10 * HOUR },
      elapsed: 0,
      reset: "Resets in 10h 0m",
    },
    {
      name: "reset time beyond the representable date range",
      overrides: { resetsAtEpochMs: 9e15 },
      elapsed: null,
      reset: "Reset unavailable",
    },
    {
      name: "reset time beyond the representable date range with a label",
      overrides: { resetsAtEpochMs: 9e15, resetsLabel: "Sep 28" },
      elapsed: null,
      reset: "Resets Sep 28",
    },
    {
      name: "no reset time and no label",
      overrides: { resetsAtEpochMs: null, resetsLabel: null },
      elapsed: null,
      reset: "Reset unavailable",
    },
  ])("handles $name", ({ overrides, elapsed, reset }) => {
    const model = usageLimitBarModel(window(overrides), NOW);
    expect(model.elapsedPercent).toBe(elapsed);
    expect(model.resetsLabel).toBe(reset);
    expect(model.aheadOfPace).toBe(elapsed !== null && model.usedPercent > elapsed + 5);
  });

  it("describes the bar for assistive technology", () => {
    expect(usageLimitBarModel(window({}), NOW).ariaLabel).toBe(
      "5-hour limit: 38% used, 60% of the window elapsed, resets in 2h 0m",
    );
  });
});

describe("visibleUsageWindows", () => {
  const windows = Array.from({ length: 5 }, (_, index) => window({ id: `w${index}` }));

  it("keeps every window when they fit", () => {
    const visible = visibleUsageWindows(windows, 5);
    expect(visible.windows.map((entry) => entry.id)).toEqual(["w0", "w1", "w2", "w3", "w4"]);
    expect(visible.hiddenCount).toBe(0);
  });

  it("reports how many windows did not fit", () => {
    const visible = visibleUsageWindows(windows, 3);
    expect(visible.windows.map((entry) => entry.id)).toEqual(["w0", "w1", "w2"]);
    expect(visible.hiddenCount).toBe(2);
  });

  it("treats a non-positive limit as showing nothing", () => {
    expect(visibleUsageWindows(windows, 0)).toEqual({ windows: [], hiddenCount: 5 });
  });
});

describe("usageProviderLimitsNotice", () => {
  it.each([
    [{ kind: "idle" } as const, "Available after the next provider turn."],
    [{ kind: "loading" } as const, "Updating…"],
    [{ kind: "unavailable" } as const, "No limits reported by the latest turn."],
    [
      {
        kind: "ready",
        snapshot: { provider: "codex", fetchedAtEpochMs: NOW, windows: [] },
      } as const,
      "The provider reported no limit windows.",
    ],
  ])("explains why %j has no bars", (state, notice) => {
    expect(usageProviderLimitsNotice(state)).toBe(notice);
  });

  it("returns null when bars are available", () => {
    expect(
      usageProviderLimitsNotice({
        kind: "ready",
        snapshot: { provider: "codex", fetchedAtEpochMs: NOW, windows: [window({})] },
      }),
    ).toBeNull();
  });
});

describe("usage freshness", () => {
  it("reports the newest ready snapshot", () => {
    expect(
      latestUsageFetch({
        claudeCode: {
          kind: "ready",
          snapshot: { provider: "claudeCode", fetchedAtEpochMs: NOW - 5 * 60_000, windows: [] },
        },
        codex: {
          kind: "ready",
          snapshot: { provider: "codex", fetchedAtEpochMs: NOW - 9 * 60_000, windows: [] },
        },
      }),
    ).toBe(NOW - 5 * 60_000);
    expect(
      latestUsageFetch({ claudeCode: { kind: "idle" }, codex: { kind: "unavailable" } }),
    ).toBeNull();
    expect(updatedLabel(NOW - 2 * 60_000, NOW)).toBe("Updated 2m ago");
    expect(updatedLabel(NOW, NOW)).toBe("Updated just now");
    expect(updatedLabel(NOW + 60_000, NOW)).toBe("Updated just now");
  });
});
