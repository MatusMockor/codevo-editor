import { describe, expect, it } from "vitest";
import {
  mergeAgentAccountUsageObservation,
  type AgentAccountUsageSnapshot,
  type AgentAccountUsageWindow,
} from "./agentAccountUsage";
import {
  agentAccountUsageStaleness,
  isAgentAccountUsageWindowExpired,
  mergeAgentAccountUsageRefresh,
  RESET_REFRESH_GRACE_MS,
  resolveAgentAccountUsageResets,
  USAGE_READING_STALE_AFTER_MS,
} from "./agentAccountUsageFreshness";

const MINUTE = 60_000;
const SEP_30_17_12 = Date.UTC(2026, 8, 30, 15, 12, 10);
const OCT_2_10_21 = Date.UTC(2026, 9, 2, 8, 21);
const OCT_2_15_20 = Date.UTC(2026, 9, 2, 13, 20);
const OCT_6_08_00 = Date.UTC(2026, 9, 6, 6, 0);

function window(overrides: Partial<AgentAccountUsageWindow>): AgentAccountUsageWindow {
  return {
    id: "five_hour",
    label: "5-hour limit",
    usedPercent: 3,
    windowDurationMinutes: 300,
    resetsAtEpochMs: null,
    resetsLabel: null,
    ...overrides,
  };
}

function restoredQaSnapshot(): AgentAccountUsageSnapshot {
  return {
    provider: "claudeCode",
    fetchedAtEpochMs: SEP_30_17_12,
    windows: [
      window({ resetsLabel: "Sep 30 at 9:50pm (Europe/Bratislava)" }),
      window({
        id: "seven_day",
        label: "Weekly limit",
        usedPercent: 38,
        windowDurationMinutes: 10_080,
        resetsLabel: "Oct 6 at 8am (Europe/Bratislava)",
      }),
      window({
        id: "seven_day_fable",
        label: "Weekly Fable limit",
        usedPercent: 13,
        windowDurationMinutes: 10_080,
        resetsLabel: "Oct 6 at 8am (Europe/Bratislava)",
      }),
    ],
  };
}

describe("resolveAgentAccountUsageResets", () => {
  it("anchors a Claude reset label to the moment it was fetched", () => {
    const resolved = resolveAgentAccountUsageResets(restoredQaSnapshot());
    expect(resolved.windows.map((entry) => entry.resetsAtEpochMs)).toEqual([
      Date.UTC(2026, 8, 30, 19, 50),
      OCT_6_08_00,
      OCT_6_08_00,
    ]);
    expect(resolved.windows[0]?.resetsLabel).toBe("Sep 30 at 9:50pm (Europe/Bratislava)");
  });

  it("keeps a time-only label in the fetch day instead of the reader's day", () => {
    const fetchedAt = Date.UTC(2026, 9, 1, 14, 0);
    const resolved = resolveAgentAccountUsageResets({
      provider: "claudeCode",
      fetchedAtEpochMs: fetchedAt,
      windows: [window({ resetsLabel: "6:30pm (Europe/Bratislava)" })],
    });
    expect(resolved.windows[0]?.resetsAtEpochMs).toBe(Date.UTC(2026, 9, 1, 16, 30));
    expect(isAgentAccountUsageWindowExpired(resolved.windows[0] ?? window({}), OCT_2_10_21)).toBe(
      true,
    );
  });

  it("resolves a time-only weekly label fetched in the afternoon to the next morning", () => {
    const fetchedAt = Date.UTC(2026, 9, 5, 10, 0);
    const resolved = resolveAgentAccountUsageResets({
      provider: "claudeCode",
      fetchedAtEpochMs: fetchedAt,
      windows: [window({ id: "seven_day", resetsLabel: "8am (Europe/Bratislava)" })],
    });
    expect(resolved.windows[0]?.resetsAtEpochMs).toBe(OCT_6_08_00);
    expect(agentAccountUsageStaleness(resolved, fetchedAt + MINUTE, false)).toEqual({
      kind: "fresh",
      recheckAtEpochMs: OCT_6_08_00 + RESET_REFRESH_GRACE_MS,
    });
  });

  it("leaves an unparseable label without a reset time", () => {
    const snapshot: AgentAccountUsageSnapshot = {
      provider: "claudeCode",
      fetchedAtEpochMs: SEP_30_17_12,
      windows: [window({ resetsLabel: "soon" })],
    };
    expect(resolveAgentAccountUsageResets(snapshot).windows[0]?.resetsAtEpochMs).toBeNull();
  });
});

describe("agentAccountUsageStaleness", () => {
  it("marks a restored snapshot whose session window reset as stale", () => {
    const staleness = agentAccountUsageStaleness(restoredQaSnapshot(), OCT_2_10_21, true);
    expect(staleness).toEqual({
      kind: "stale",
      key: `reset:five_hour@${Date.UTC(2026, 8, 30, 19, 50)}`,
    });
  });

  it("refreshes a restored snapshot that is old even when no window reset", () => {
    const fetchedAt = OCT_2_10_21 - USAGE_READING_STALE_AFTER_MS;
    const snapshot: AgentAccountUsageSnapshot = {
      provider: "claudeCode",
      fetchedAtEpochMs: fetchedAt,
      windows: [window({ resetsAtEpochMs: OCT_2_15_20 })],
    };
    expect(agentAccountUsageStaleness(snapshot, OCT_2_10_21, true)).toEqual({
      kind: "stale",
      key: `restored:${fetchedAt}`,
    });
    expect(agentAccountUsageStaleness(snapshot, OCT_2_10_21, false)).toEqual({
      kind: "fresh",
      recheckAtEpochMs: OCT_2_15_20 + RESET_REFRESH_GRACE_MS,
    });
  });

  it("schedules the next check at the nearest reset after the grace period", () => {
    const snapshot: AgentAccountUsageSnapshot = {
      provider: "claudeCode",
      fetchedAtEpochMs: OCT_2_10_21,
      windows: [
        window({ id: "seven_day", resetsAtEpochMs: OCT_6_08_00 }),
        window({ resetsAtEpochMs: OCT_2_15_20 }),
      ],
    };
    expect(agentAccountUsageStaleness(snapshot, OCT_2_10_21 + MINUTE, true)).toEqual({
      kind: "fresh",
      recheckAtEpochMs: OCT_2_10_21 + USAGE_READING_STALE_AFTER_MS,
    });
    expect(agentAccountUsageStaleness(snapshot, OCT_2_15_20, false)).toEqual({
      kind: "fresh",
      recheckAtEpochMs: OCT_2_15_20 + RESET_REFRESH_GRACE_MS,
    });
    expect(
      agentAccountUsageStaleness(snapshot, OCT_2_15_20 + RESET_REFRESH_GRACE_MS, false),
    ).toEqual({ kind: "stale", key: `reset:five_hour@${OCT_2_15_20}` });
  });
});

describe("newest reading per limit", () => {
  const current: AgentAccountUsageSnapshot = {
    provider: "claudeCode",
    fetchedAtEpochMs: OCT_2_10_21,
    windows: [
      window({ usedPercent: 1, resetsAtEpochMs: OCT_2_15_20 }),
      window({
        id: "seven_day",
        label: "Weekly limit",
        usedPercent: 62,
        windowDurationMinutes: 10_080,
        resetsAtEpochMs: OCT_6_08_00,
      }),
    ],
  };

  it("ignores a late observation from an earlier window period", () => {
    const merged = mergeAgentAccountUsageObservation(
      current,
      {
        provider: "claudeCode",
        windows: [window({ usedPercent: 18, resetsAtEpochMs: Date.UTC(2026, 9, 2, 2, 20) })],
      },
      OCT_2_10_21 + MINUTE,
    );
    expect(merged.windows.find((entry) => entry.id === "five_hour")?.usedPercent).toBe(1);
  });

  it("accepts a newer reading of the same period despite minute-rounded labels", () => {
    const merged = mergeAgentAccountUsageObservation(
      current,
      {
        provider: "claudeCode",
        windows: [
          window({
            id: "seven_day",
            label: "Weekly limit",
            usedPercent: 63,
            resetsLabel: "Oct 6 at 7:59am (Europe/Bratislava)",
          }),
        ],
      },
      OCT_2_10_21 + MINUTE,
    );
    expect(merged.windows.find((entry) => entry.id === "seven_day")?.usedPercent).toBe(63);
  });

  it("keeps the newer period when a refresh returns an earlier one", () => {
    const merged = mergeAgentAccountUsageRefresh(current, {
      provider: "claudeCode",
      fetchedAtEpochMs: OCT_2_10_21 + MINUTE,
      windows: [
        window({ usedPercent: 18, resetsLabel: "Oct 2 at 4:20am (Europe/Bratislava)" }),
        window({
          id: "seven_day",
          label: "Weekly limit",
          usedPercent: 63,
          windowDurationMinutes: 10_080,
          resetsLabel: "Oct 6 at 7:59am (Europe/Bratislava)",
        }),
      ],
    });
    expect(merged.fetchedAtEpochMs).toBe(OCT_2_10_21 + MINUTE);
    expect(merged.windows.map((entry) => [entry.id, entry.usedPercent])).toEqual([
      ["five_hour", 1],
      ["seven_day", 63],
    ]);
    expect(merged.windows[1]?.resetsAtEpochMs).toBe(OCT_6_08_00 - MINUTE);
  });

  it("accepts a reading whose upcoming reset moved earlier than the stored one", () => {
    const merged = mergeAgentAccountUsageObservation(
      current,
      {
        provider: "claudeCode",
        windows: [
          window({
            id: "seven_day",
            label: "Weekly limit",
            usedPercent: 4,
            resetsAtEpochMs: Date.UTC(2026, 9, 4, 6, 0),
          }),
        ],
      },
      OCT_2_10_21 + MINUTE,
    );
    expect(merged.windows.find((entry) => entry.id === "seven_day")?.usedPercent).toBe(4);
  });

  it("drops limits the refresh no longer reports", () => {
    const merged = mergeAgentAccountUsageRefresh(current, {
      provider: "claudeCode",
      fetchedAtEpochMs: OCT_2_10_21 + MINUTE,
      windows: [window({ id: "seven_day", usedPercent: 63, resetsAtEpochMs: OCT_6_08_00 })],
    });
    expect(merged.windows.map((entry) => entry.id)).toEqual(["seven_day"]);
  });
});
