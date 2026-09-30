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
      elapsed: 100,
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

  it("describes the bar for assistive technology", () => {
    expect(model(window({})).ariaLabel).toBe(
      "5-hour limit: 38% used, 60% of the window elapsed, resets today at 16:00",
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
