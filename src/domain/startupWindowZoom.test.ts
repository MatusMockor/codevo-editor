import { describe, expect, it } from "vitest";
import { MAX_STARTUP_SETTINGS_LENGTH } from "./startupTheme";
import { readPersistedWindowZoomLevel } from "./startupWindowZoom";

describe("readPersistedWindowZoomLevel", () => {
  it.each([null, "{", "[]", "null", "3", '"zoom"', "true", "{}"])(
    "defaults missing or malformed settings %s to zero",
    (raw) => {
      expect(readPersistedWindowZoomLevel(raw)).toBe(0);
    },
  );

  it.each([undefined, null, "3", true, {}, []])("defaults malformed zoom %j", (windowZoomLevel) => {
    expect(readPersistedWindowZoomLevel(JSON.stringify({ windowZoomLevel }))).toBe(0);
  });

  it.each([
    [-100, -8],
    [100, 8],
    [-3.8, -3],
    [3.8, 3],
    [2, 2],
  ])("normalizes zoom %s to %s before paint", (windowZoomLevel, expected) => {
    expect(readPersistedWindowZoomLevel(JSON.stringify({ windowZoomLevel }))).toBe(expected);
  });

  it("rejects oversized settings before parsing", () => {
    const raw = JSON.stringify({
      windowZoomLevel: 3,
      padding: "x".repeat(MAX_STARTUP_SETTINGS_LENGTH),
    });
    expect(readPersistedWindowZoomLevel(raw)).toBe(0);
  });

  it("accepts settings at the startup size boundary", () => {
    const prefix = JSON.stringify({ windowZoomLevel: 2 });
    expect(readPersistedWindowZoomLevel(prefix.padEnd(MAX_STARTUP_SETTINGS_LENGTH))).toBe(2);
    expect(readPersistedWindowZoomLevel(prefix.padEnd(MAX_STARTUP_SETTINGS_LENGTH + 1))).toBe(0);
  });
});
