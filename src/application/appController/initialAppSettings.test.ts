import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE } from "../../domain/appearance";
import { defaultAppSettings } from "../../domain/settings";
import { initialAppSettings, initialAppSettingsFrom } from "./initialAppSettings";

describe("initialAppSettings", () => {
  it("keeps defaults when synchronous settings readers are absent", () => {
    expect(initialAppSettings({})).toEqual(defaultAppSettings());
  });

  it("initializes zoom independently from the appearance reader", () => {
    expect(initialAppSettings({ readInitialWindowZoomLevel: () => 3 })).toEqual({
      ...defaultAppSettings(),
      windowZoomLevel: 3,
    });
  });

  it("initializes appearance and normalized zoom together", () => {
    const appearance = { ...DEFAULT_APPEARANCE, palette: "ink-mint" } as const;
    const initializer = initialAppSettingsFrom({
      readInitialAppearance: () => appearance,
      readInitialWindowZoomLevel: () => 40,
    });
    expect(initializer()).toEqual({ ...defaultAppSettings(), appearance, windowZoomLevel: 8 });
  });

  it.each([
    [-40, -8],
    [-3.8, -3],
    [3.8, 3],
    [Number.NaN, 0],
    [Infinity, 0],
  ])("normalizes an initial level of %s to %s", (level, expected) => {
    expect(initialAppSettings({ readInitialWindowZoomLevel: () => level }).windowZoomLevel).toBe(
      expected,
    );
  });

  it("falls back safely when the synchronous zoom reader fails", () => {
    expect(
      initialAppSettings({ readInitialWindowZoomLevel: () => JSON.parse("{") as number })
        .windowZoomLevel,
    ).toBe(0);
  });
});
