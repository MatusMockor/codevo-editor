import { describe, expect, it } from "vitest";
import {
  DEFAULT_WINDOW_ZOOM_LEVEL,
  MAX_WINDOW_ZOOM_LEVEL,
  MIN_WINDOW_ZOOM_LEVEL,
  normalizeWindowZoomLevel,
  transitionWindowZoomLevel,
  windowZoomFactor,
} from "./windowZoom";

describe("window zoom policy", () => {
  it.each([undefined, null, "2", {}, [], true, Number.NaN, Infinity, -Infinity])(
    "defaults malformed level %j to zero",
    (value) => {
      expect(normalizeWindowZoomLevel(value)).toBe(DEFAULT_WINDOW_ZOOM_LEVEL);
    },
  );

  it.each([
    [-100, MIN_WINDOW_ZOOM_LEVEL],
    [100, MAX_WINDOW_ZOOM_LEVEL],
    [2.9, 2],
    [-2.9, -2],
    [0, 0],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeWindowZoomLevel(input)).toBe(expected);
  });

  it("steps once, respects both bounds, and resets every supported level", () => {
    for (let level = MIN_WINDOW_ZOOM_LEVEL; level <= MAX_WINDOW_ZOOM_LEVEL; level += 1) {
      expect(transitionWindowZoomLevel(level, "in")).toBe(
        Math.min(level + 1, MAX_WINDOW_ZOOM_LEVEL),
      );
      expect(transitionWindowZoomLevel(level, "out")).toBe(
        Math.max(level - 1, MIN_WINDOW_ZOOM_LEVEL),
      );
      expect(transitionWindowZoomLevel(level, "reset")).toBe(DEFAULT_WINDOW_ZOOM_LEVEL);
    }
    expect(transitionWindowZoomLevel(Number.NaN, "in")).toBe(1);
    expect(transitionWindowZoomLevel(Infinity, "out")).toBe(-1);
  });

  it("scales by twenty percent per level and clamps direct scale input", () => {
    expect(windowZoomFactor(0)).toBe(1);
    expect(windowZoomFactor(1)).toBe(1.2);
    expect(windowZoomFactor(-1)).toBeCloseTo(1 / 1.2);
    expect(windowZoomFactor(MAX_WINDOW_ZOOM_LEVEL)).toBeCloseTo(1.2 ** 8);
    expect(windowZoomFactor(MIN_WINDOW_ZOOM_LEVEL)).toBeCloseTo(1.2 ** -8);
    expect(windowZoomFactor(100)).toBe(windowZoomFactor(MAX_WINDOW_ZOOM_LEVEL));
    expect(windowZoomFactor(-100)).toBe(windowZoomFactor(MIN_WINDOW_ZOOM_LEVEL));
    expect(windowZoomFactor(Number.NaN)).toBe(1);
  });
});
