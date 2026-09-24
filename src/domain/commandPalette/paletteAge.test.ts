import { describe, expect, it } from "vitest";
import { compactAgeLabel } from "./paletteAge";

const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);

describe("compactAgeLabel", () => {
  it("formats minutes, hours, days and weeks", () => {
    expect(compactAgeLabel(NOW, NOW - 20_000)).toBe("now");
    expect(compactAgeLabel(NOW, NOW - 4 * 60_000)).toBe("4m");
    expect(compactAgeLabel(NOW, NOW - 2 * 3_600_000)).toBe("2h");
    expect(compactAgeLabel(NOW, NOW - 3 * 86_400_000)).toBe("3d");
    expect(compactAgeLabel(NOW, NOW - 15 * 86_400_000)).toBe("2w");
  });

  it("treats future and non-finite times as now", () => {
    expect(compactAgeLabel(NOW, NOW + 60_000)).toBe("now");
    expect(compactAgeLabel(NOW, Number.NaN)).toBe("now");
  });
});
