import { describe, expect, it } from "vitest";
import { claudeUsageResetEpochMs } from "./claudeUsageResetLabel";

const NOW = Date.UTC(2026, 8, 30, 9, 0);

describe("claudeUsageResetEpochMs", () => {
  it.each([
    ["Sep 30 at 4:20pm (Europe/Bratislava)", Date.UTC(2026, 8, 30, 14, 20)],
    ["Oct 6 at 8am (Europe/Bratislava)", Date.UTC(2026, 9, 6, 6, 0)],
    ["Oct 6, 2026 at 8am (Europe/Bratislava)", Date.UTC(2026, 9, 6, 6, 0)],
    ["Dec 1 at 12am (Europe/Bratislava)", Date.UTC(2026, 10, 30, 23, 0)],
    ["Sep 30 at 12pm (UTC)", Date.UTC(2026, 8, 30, 12, 0)],
    ["4:20pm (Europe/Bratislava)", Date.UTC(2026, 8, 30, 14, 20)],
  ])("reads %s", (label, expected) => {
    expect(claudeUsageResetEpochMs(label, NOW)).toBe(expected);
  });

  it("picks the nearest year when the label has none", () => {
    const newYearsEve = Date.UTC(2026, 11, 31, 20, 0);
    expect(claudeUsageResetEpochMs("Jan 2 at 8am (UTC)", newYearsEve)).toBe(
      Date.UTC(2027, 0, 2, 8, 0),
    );
  });

  it("picks the nearest day when the label is a time only", () => {
    const lateEvening = Date.UTC(2026, 8, 30, 21, 30);
    expect(claudeUsageResetEpochMs("1am (UTC)", lateEvening)).toBe(Date.UTC(2026, 9, 1, 1, 0));
  });

  it.each([
    "",
    "Sep 28",
    "8pm",
    "Oct 6 at 8am",
    "soon",
    "Sep 31 at 8am (UTC)",
    "Sep 30 at 13pm (UTC)",
    "Sep 30 at 4:61pm (UTC)",
    "Sep 30 at 4pm (Mars/Olympus)",
    "Sep 30 at 4pm (UTC) and more",
  ])("rejects %j", (label) => {
    expect(claudeUsageResetEpochMs(label, NOW)).toBeNull();
  });
});
