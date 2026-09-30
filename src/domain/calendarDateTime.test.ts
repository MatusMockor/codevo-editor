import { describe, expect, it } from "vitest";
import {
  calendarDateTime,
  isKnownTimeZone,
  zonedWallTimeToEpochMs,
  type CalendarClock,
} from "./calendarDateTime";

const ZONE = "Europe/Bratislava";
const NOW = Date.UTC(2026, 8, 30, 21, 15);

function clock(nowEpochMs: number = NOW): CalendarClock {
  return { nowEpochMs, locale: "en-GB", timeZone: ZONE };
}

describe("calendarDateTime", () => {
  it("names today with the time only", () => {
    const at = calendarDateTime(Date.UTC(2026, 8, 30, 14, 20), clock());
    expect(at).toMatchObject({ relation: "today", day: "today", time: "16:20" });
    expect(at?.title).toBe("Wednesday, 30 September 2026 at 16:20");
    expect(at?.iso).toBe("2026-09-30T14:20:00.000Z");
  });

  it("names yesterday and tomorrow", () => {
    expect(calendarDateTime(Date.UTC(2026, 8, 29, 6, 0), clock())).toMatchObject({
      relation: "yesterday",
      day: "yesterday",
      time: "08:00",
    });
    expect(calendarDateTime(Date.UTC(2026, 9, 1, 6, 0), clock())).toMatchObject({
      relation: "tomorrow",
      day: "tomorrow",
      time: "08:00",
    });
  });

  it("shows the weekday and date within the same year", () => {
    expect(calendarDateTime(Date.UTC(2026, 9, 6, 6, 0), clock())).toMatchObject({
      relation: "sameYear",
      day: "Tue 6 Oct",
      time: "08:00",
    });
  });

  it("adds the year for another year", () => {
    expect(calendarDateTime(Date.UTC(2025, 8, 29, 6, 0), clock())).toMatchObject({
      relation: "otherYear",
      day: "Mon, 29 Sept 2025",
      time: "08:00",
    });
  });

  it("moves the day label at local midnight, not UTC midnight", () => {
    const beforeMidnight = Date.UTC(2026, 8, 30, 21, 59, 59);
    const afterMidnight = Date.UTC(2026, 8, 30, 22, 0, 0);
    const reset = Date.UTC(2026, 9, 1, 6, 0);
    expect(calendarDateTime(reset, clock(beforeMidnight))?.day).toBe("tomorrow");
    expect(calendarDateTime(reset, clock(afterMidnight))?.day).toBe("today");
    expect(calendarDateTime(beforeMidnight, clock(afterMidnight))?.day).toBe("yesterday");
  });

  it("keeps calendar days apart across a daylight saving change", () => {
    const afterFallBack = Date.UTC(2026, 9, 25, 12, 0);
    expect(calendarDateTime(Date.UTC(2026, 9, 24, 22, 30), clock(afterFallBack))?.day).toBe(
      "today",
    );
    expect(calendarDateTime(Date.UTC(2026, 9, 24, 21, 30), clock(afterFallBack))?.day).toBe(
      "yesterday",
    );
  });

  it("drops unusable instants and zones instead of throwing", () => {
    expect(calendarDateTime(Number.NaN, clock())).toBeNull();
    expect(calendarDateTime(8_640_000_000_000_001, clock())).toBeNull();
    expect(calendarDateTime(NOW, { ...clock(), nowEpochMs: Number.NaN })).toBeNull();
    expect(calendarDateTime(NOW, { ...clock(), timeZone: "Mars/Olympus" })).toBeNull();
  });
});

describe("zonedWallTimeToEpochMs", () => {
  it("reads a wall-clock time in the given zone", () => {
    expect(
      zonedWallTimeToEpochMs({ year: 2026, month: 9, day: 30, hour: 16, minute: 20 }, ZONE),
    ).toBe(Date.UTC(2026, 8, 30, 14, 20));
    expect(
      zonedWallTimeToEpochMs({ year: 2026, month: 12, day: 1, hour: 8, minute: 0 }, ZONE),
    ).toBe(Date.UTC(2026, 11, 1, 7, 0));
  });

  it("rejects dates that do not exist", () => {
    expect(
      zonedWallTimeToEpochMs({ year: 2026, month: 2, day: 30, hour: 8, minute: 0 }, ZONE),
    ).toBeNull();
    expect(
      zonedWallTimeToEpochMs({ year: 2026, month: 9, day: 30, hour: 24, minute: 0 }, ZONE),
    ).toBeNull();
  });
});

describe("isKnownTimeZone", () => {
  it("accepts IANA zones and rejects unknown ones", () => {
    expect(isKnownTimeZone(ZONE)).toBe(true);
    expect(isKnownTimeZone("Mars/Olympus")).toBe(false);
  });
});
