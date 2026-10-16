import { describe, expect, it } from "vitest";
import type { CodexRateLimitResetCredit } from "../../domain/codexRateLimitResets";
import {
  codexResetAvailableModel,
  codexResetConfirmCopy,
  codexResetCountLabel,
  codexResetCreditRow,
  codexResetExpiry,
  codexResetHistoryRows,
  codexResetMoreLabel,
  codexResetSegmentLabel,
  codexResetUsageNote,
  sortCodexResetCredits,
} from "./codexResetCreditsPresentation";

const NOW = Date.UTC(2026, 9, 16, 12, 0);
const CLOCK = { nowEpochMs: NOW, locale: "en-GB", timeZone: "UTC" } as const;
const HOUR_MS = 3_600_000;

function credit(
  id: string,
  expiresAtEpochMs: number | null,
  grantedAtEpochMs = 1,
): CodexRateLimitResetCredit {
  return { id, title: null, description: null, grantedAtEpochMs, expiresAtEpochMs };
}

describe("codexResetExpiry", () => {
  it("labels today and tomorrow with the clock time and warns inside 48 hours", () => {
    expect(codexResetExpiry(Date.UTC(2026, 9, 16, 18, 0), CLOCK)).toMatchObject({
      label: "Expires today, 18:00",
      soon: true,
      expired: false,
      iso: "2026-10-16T18:00:00.000Z",
    });
    expect(codexResetExpiry(Date.UTC(2026, 9, 17, 0, 23), CLOCK)).toMatchObject({
      label: "Expires tomorrow, 00:23",
      soon: true,
    });
  });
  it("adds a relative day count further out", () => {
    expect(codexResetExpiry(Date.UTC(2026, 9, 29, 19, 51), CLOCK)).toMatchObject({
      label: "Expires 29 Oct, 19:51 · in 13 days",
      soon: false,
    });
    expect(codexResetExpiry(Date.UTC(2027, 0, 3, 9, 5), CLOCK).label).toBe(
      "Expires 3 Jan 2027, 09:05 · in 79 days",
    );
  });
  it("switches the warning tone exactly at 48 hours", () => {
    expect(codexResetExpiry(NOW + 48 * HOUR_MS - 1, CLOCK).soon).toBe(true);
    expect(codexResetExpiry(NOW + 48 * HOUR_MS, CLOCK).soon).toBe(false);
  });
  it("reads non-expiring and already expired credits truthfully", () => {
    expect(codexResetExpiry(null, CLOCK)).toEqual({
      label: "Doesn't expire",
      iso: null,
      title: null,
      soon: false,
      expired: false,
    });
    expect(codexResetExpiry(NOW, CLOCK)).toMatchObject({ label: "Expired", expired: true });
  });
  it("does not invent a date for an unknown time zone", () => {
    expect(codexResetExpiry(NOW + HOUR_MS, { ...CLOCK, timeZone: "Mars/Olympus" }).label).toBe(
      "Expiry date unavailable",
    );
  });
});

describe("codexResetAvailableModel", () => {
  const snapshot = { history: [], historyTruncated: false };
  it("orders credits by soonest expiry, never-expiring last, then grant time and id", () => {
    const sorted = sortCodexResetCredits([
      credit("never", null),
      credit("late", NOW + 9 * HOUR_MS),
      credit("b", NOW + HOUR_MS, 5),
      credit("a", NOW + HOUR_MS, 5),
      credit("early-grant", NOW + HOUR_MS, 2),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["early-grant", "a", "b", "late", "never"]);
  });
  it("falls back to a default title and keeps the description as a tooltip only", () => {
    expect(codexResetCreditRow(credit("x", null), CLOCK)).toMatchObject({
      title: "Limit reset",
      tooltip: null,
    });
    expect(
      codexResetCreditRow(
        { ...credit("y", null), title: "Full reset", description: "Both" },
        CLOCK,
      ),
    ).toMatchObject({ title: "Full reset", tooltip: "Both" });
  });
  it("reports unknown, empty, count-only and detailed availability", () => {
    expect(
      codexResetAvailableModel({ ...snapshot, availableCount: null, credits: null }, CLOCK),
    ).toEqual({ kind: "unreported" });
    expect(
      codexResetAvailableModel({ ...snapshot, availableCount: 0, credits: [] }, CLOCK),
    ).toEqual({
      kind: "empty",
    });
    expect(
      codexResetAvailableModel({ ...snapshot, availableCount: 1, credits: null }, CLOCK),
    ).toEqual({
      kind: "countOnly",
      label: "1 reset available",
    });
    expect(
      codexResetAvailableModel({ ...snapshot, availableCount: 2, credits: [] }, CLOCK),
    ).toEqual({
      kind: "countOnly",
      label: "2 resets available",
    });
    const detailed = codexResetAvailableModel(
      { ...snapshot, availableCount: 3, credits: [credit("a", null)] },
      CLOCK,
    );
    expect(detailed).toMatchObject({
      kind: "credits",
      moreLabel: "2 more resets available - Codex didn't send their details.",
    });
  });
});

describe("codex reset copy", () => {
  it("uses singular and plural forms", () => {
    expect(codexResetCountLabel(1)).toBe("1 reset available");
    expect(codexResetCountLabel(3)).toBe("3 resets available");
    expect(codexResetMoreLabel(0)).toBeNull();
    expect(codexResetMoreLabel(1)).toBe("1 more reset available - Codex didn't send its details.");
    expect(codexResetMoreLabel(4)).toBe(
      "4 more resets available - Codex didn't send their details.",
    );
    expect(codexResetSegmentLabel(null)).toBe("Available");
    expect(codexResetSegmentLabel(2)).toBe("Available 2");
  });
  it("names the confirmed credit and adds the usage note only when present", () => {
    const row = codexResetCreditRow({ ...credit("a", null), title: "Full reset" }, CLOCK);
    expect(codexResetConfirmCopy(row, false, null)).toEqual({
      question: "Use this Full reset now?",
      detail: "Eligible Codex limits reset immediately. This can't be undone.",
      action: "Use reset",
    });
    expect(codexResetConfirmCopy(null, false, "You're at 5% of your weekly limit.")).toEqual({
      question: "Use a limit reset now?",
      detail:
        "Eligible Codex limits reset immediately. You're at 5% of your weekly limit. This can't be undone.",
      action: "Use reset",
    });
  });
  it("words a retry of an unknown result as a check of the same reset", () => {
    expect(codexResetConfirmCopy(null, true, "You're at 5% of your weekly limit.")).toEqual({
      question: "Check the result of the last reset?",
      detail:
        "Codevo retries the same reset. No additional credit is used if it already went through.",
      action: "Retry reset",
    });
  });
  it("sorts history newest first with use time and default titles", () => {
    const rows = codexResetHistoryRows(
      [
        {
          operationId: "old",
          usedAtEpochMs: Date.UTC(2026, 9, 5, 9, 41),
          creditTitle: "Full reset",
        },
        { operationId: "new", usedAtEpochMs: Date.UTC(2026, 9, 16, 14, 2), creditTitle: null },
        { operationId: "mid", usedAtEpochMs: Date.UTC(2026, 9, 15, 8, 0), creditTitle: null },
      ],
      CLOCK,
    );
    expect(rows.map((row) => [row.key, row.title, row.usedLabel])).toEqual([
      ["new", "Limit reset", "Used today, 14:02"],
      ["mid", "Limit reset", "Used yesterday, 08:00"],
      ["old", "Full reset", "Used 5 Oct, 09:41"],
    ]);
    expect(rows[0]?.iso).toBe("2026-10-16T14:02:00.000Z");
  });
});

describe("codexResetUsageNote", () => {
  const window = (id: string, label: string, usedPercent: number, resetsAtEpochMs: number) => ({
    id,
    label,
    usedPercent,
    windowDurationMinutes: 300,
    resetsAtEpochMs,
    resetsLabel: null,
  });
  it("quotes the most used current window", () => {
    const note = codexResetUsageNote(
      {
        kind: "ready",
        snapshot: {
          provider: "codex",
          fetchedAtEpochMs: NOW - 60_000,
          windows: [
            window("five", "5-hour limit", 2, NOW + HOUR_MS),
            window("week", "Weekly limit", 5, NOW + 50 * HOUR_MS),
          ],
        },
      },
      NOW,
    );
    expect(note).toBe("You're at 5% of your weekly limit.");
  });
  it("stays silent for stale, passed or missing readings", () => {
    expect(codexResetUsageNote(undefined, NOW)).toBeNull();
    expect(codexResetUsageNote({ kind: "loading" }, NOW)).toBeNull();
    const ready = (fetchedAtEpochMs: number, resetsAtEpochMs: number) =>
      codexResetUsageNote(
        {
          kind: "ready",
          snapshot: {
            provider: "codex",
            fetchedAtEpochMs,
            windows: [window("five", "5-hour limit", 40, resetsAtEpochMs)],
          },
        },
        NOW,
      );
    expect(ready(NOW - 60_000, NOW - 1)).toBeNull();
    expect(ready(NOW - 7 * 24 * HOUR_MS, NOW + HOUR_MS)).toBeNull();
  });
});
