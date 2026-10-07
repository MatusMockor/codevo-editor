import { describe, expect, it } from "vitest";
import type { AgentAccountUsageWindow } from "../../domain/agentAccountUsage";
import {
  elapsedLabel,
  latestUsageFetch,
  updatedLabel,
  usageLimitBarModel,
  usageProviderLimitsNotice,
  usageReadingAsOf,
  visibleUsageWindows,
} from "./usagePresentation";

const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);
const HOUR = 3_600_000;
const CLOCK = { locale: "en-GB", timeZone: "Europe/Bratislava" } as const;

function model(value: AgentAccountUsageWindow, nowEpochMs: number = NOW) {
  return usageLimitBarModel(value, nowEpochMs, CLOCK);
}

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
    const bar = model(window({ usedPercent: 72 }));
    expect(bar.elapsedPercent).toBe(60);
    expect(bar.aheadOfPace).toBe(true);
    expect(bar.hot).toBe(false);
    expect(bar.usedLabel).toBe("72% used");
    expect(bar.resetsLabel).toBe("Resets today at 16:00");
    expect(bar.resetsTitle).toBe("Thursday, 24 September 2026 at 16:00 · in 2h 0m");
  });

  it("names the concrete reset day", () => {
    expect(model(window({ resetsAtEpochMs: Date.UTC(2026, 8, 24, 19, 49) })).resetsLabel).toBe(
      "Resets today at 21:49",
    );
    expect(model(window({ resetsAtEpochMs: Date.UTC(2026, 8, 25, 6, 0) })).resetsLabel).toBe(
      "Resets tomorrow at 08:00",
    );
    const weekly = model(window({ resetsAtEpochMs: Date.UTC(2026, 8, 29, 6, 0) }));
    expect(weekly.resetsLabel).toBe("Resets Tue 29 Sept 08:00");
    expect(weekly.resetsTitle).toBe("Tuesday, 29 September 2026 at 08:00 · in 4d 18h");
    expect(model(window({ resetsAtEpochMs: Date.UTC(2027, 0, 2, 7, 0) })).resetsLabel).toBe(
      "Resets Sat, 2 Jan 2027 08:00",
    );
  });

  it("switches today to tomorrow at local midnight", () => {
    const reset = window({ resetsAtEpochMs: Date.UTC(2026, 8, 25, 6, 0) });
    expect(model(reset, Date.UTC(2026, 8, 24, 21, 59)).resetsLabel).toBe(
      "Resets tomorrow at 08:00",
    );
    expect(model(reset, Date.UTC(2026, 8, 24, 22, 0)).resetsLabel).toBe("Resets today at 08:00");
  });

  it("reads the concrete day out of a Claude reset label", () => {
    const bar = model(
      window({ resetsAtEpochMs: null, resetsLabel: "Sep 28 at 8am (Europe/Bratislava)" }),
    );
    expect(bar.resetsLabel).toBe("Resets Mon 28 Sept 08:00");
    expect(bar.resetsTitle).toBe("Monday, 28 September 2026 at 08:00 · in 3d 18h");
    expect(
      model(window({ resetsAtEpochMs: null, resetsLabel: "4:20pm (Europe/Bratislava)" }))
        .resetsLabel,
    ).toBe("Resets today at 16:20");
  });

  it("omits the pace line when the reset time is only a label (Claude)", () => {
    const bar = model(window({ resetsAtEpochMs: null, resetsLabel: "Sep 28, 8ish" }));
    expect(bar.elapsedPercent).toBeNull();
    expect(bar.aheadOfPace).toBe(false);
    expect(bar.resetsLabel).toBe("Resets Sep 28, 8ish");
    expect(bar.resetsTitle).toBeNull();
    expect(bar.ariaLabel).toBe("5-hour limit: 38% used, resets Sep 28, 8ish");
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
    const bar = model(window({ usedPercent }));
    expect(bar.usedPercent).toBe(width);
    expect(bar.hot).toBe(hot);
    expect(bar.usedLabel).toBe(label);
  });

  it.each([
    {
      name: "reset already passed",
      overrides: { resetsAtEpochMs: NOW - HOUR },
      elapsed: null,
      reset: "Reset passed",
    },
    {
      name: "unknown window length",
      overrides: { windowDurationMinutes: null },
      elapsed: null,
      reset: "Resets today at 16:00",
    },
    {
      name: "zero window length",
      overrides: { windowDurationMinutes: 0 },
      elapsed: null,
      reset: "Resets today at 16:00",
    },
    {
      name: "reset further away than the window",
      overrides: { resetsAtEpochMs: NOW + 10 * HOUR },
      elapsed: 0,
      reset: "Resets tomorrow at 00:00",
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
    const bar = model(window(overrides));
    expect(bar.elapsedPercent).toBe(elapsed);
    expect(bar.resetsLabel).toBe(reset);
    expect(bar.aheadOfPace).toBe(elapsed !== null && bar.usedPercent > elapsed + 5);
  });

  it.each([
    { name: "a reset time", overrides: { resetsAtEpochMs: NOW - HOUR } },
    {
      name: "a Claude reset label",
      overrides: { resetsAtEpochMs: null, resetsLabel: "Sep 24 at 1:50pm (Europe/Bratislava)" },
    },
  ])("never presents a reading whose window reset with $name as current usage", ({ overrides }) => {
    const bar = model(window({ usedPercent: 97, ...overrides }));
    expect(bar.reading).toBe("notMeasured");
    expect(bar.usedPercent).toBe(0);
    expect(bar.usedLabel).toBe("Not measured");
    expect(bar.hot).toBe(false);
    expect(bar.aheadOfPace).toBe(false);
    expect(bar.elapsedPercent).toBeNull();
    expect(bar.resetsLabel).toBe("Reset passed");
    expect(bar.ariaLabel).toBe("5-hour limit: not measured since the window reset");
  });

  it("presents a reading whose window is still running as current", () => {
    expect(model(window({})).reading).toBe("current");
    expect(
      usageLimitBarModel(window({}), NOW, CLOCK, usageReadingAsOf(NOW - 5 * 60_000, NOW, CLOCK))
        .reading,
    ).toBe("current");
  });

  it("marks a reading older than the freshness threshold with when it was measured", () => {
    const bar = usageLimitBarModel(
      window({}),
      NOW,
      CLOCK,
      usageReadingAsOf(NOW - 20 * 60_000, NOW, CLOCK),
    );
    expect(bar.reading).toBe("asOf");
    expect(bar.usedLabel).toBe("38% used");
    expect(bar.ariaLabel).toBe(
      "5-hour limit: 38% used, 60% of the window elapsed, resets today at 16:00, last measured today at 13:40",
    );
  });

  it("keeps a reset window unmeasured even when the snapshot is old", () => {
    const bar = usageLimitBarModel(
      window({ resetsAtEpochMs: NOW - HOUR }),
      NOW,
      CLOCK,
      usageReadingAsOf(NOW - 40 * HOUR, NOW, CLOCK),
    );
    expect(bar.reading).toBe("notMeasured");
  });

  it("describes the bar for assistive technology", () => {
    expect(model(window({})).ariaLabel).toBe(
      "5-hour limit: 38% used, 60% of the window elapsed, resets today at 16:00",
    );
  });
});

describe("usageReadingAsOf", () => {
  it("stays silent while the reading is fresh", () => {
    expect(usageReadingAsOf(NOW - 14 * 60_000, NOW, CLOCK)).toBeNull();
  });

  it.each([
    { observedAt: NOW - 20 * 60_000, label: "As of today at 13:40" },
    { observedAt: NOW - 22 * HOUR, label: "As of yesterday at 16:00" },
    { observedAt: Date.UTC(2026, 8, 20, 15, 12), label: "As of Sun 20 Sept 17:12" },
  ])("names when an old reading was measured ($label)", ({ observedAt, label }) => {
    expect(usageReadingAsOf(observedAt, NOW, CLOCK)?.label).toBe(label);
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

  it("words elapsed time once for every label built on it", () => {
    const cases = [
      [0, "just now"],
      [59_999, "just now"],
      [60_000, "1m ago"],
      [59 * 60_000 + 59_999, "59m ago"],
      [60 * 60_000, "1h ago"],
      [23 * 3_600_000 + 59 * 60_000, "23h ago"],
      [24 * 3_600_000, "1d ago"],
      [9 * 86_400_000, "9d ago"],
    ] as const;
    for (const [elapsedMs, label] of cases) {
      expect(elapsedLabel(NOW - elapsedMs, NOW)).toBe(label);
      expect(updatedLabel(NOW - elapsedMs, NOW)).toBe(`Updated ${label}`);
    }
    expect(elapsedLabel(NOW + 60_000, NOW)).toBe("just now");
  });
});
