import { describe, expect, it } from "vitest";
import { nextCommandMarkerLine } from "./terminalCommandNavigation";

describe("nextCommandMarkerLine", () => {
  it.each([
    [[2, 8, 14], 10, "up", 8],
    [[2, 8, 14], 10, "down", 14],
    [[2, 8, 14], 2, "up", null],
    [[2, 8, 14], 14, "down", null],
    [[], 10, "up", null],
    [[], 10, "down", null],
    [[2, 8, 14], 8, "up", 2],
    [[2, 8, 14], 8, "down", 14],
  ] as const)(
    "selects %s from viewport %s moving %s",
    (markerLines, viewportTopLine, direction, expected) => {
      expect(
        nextCommandMarkerLine(markerLines, viewportTopLine, direction),
      ).toBe(expected);
    },
  );
});
