import { describe, expect, it } from "vitest";
import { initialAppSettings } from "../application/appController/initialAppSettings";
import { DEFAULT_APPEARANCE } from "../domain/appearance";
import { defaultAppSettings } from "../domain/settings";
import { MAX_STARTUP_SETTINGS_LENGTH } from "../domain/startupTheme";
import {
  APP_SETTINGS_KEY,
  BrowserSettingsGateway,
  type KeyValueStorage,
} from "./browserSettingsGateway";

function memoryStorage(raw: string | null): KeyValueStorage {
  const values = new Map<string, string>();
  if (raw !== null) values.set(APP_SETTINGS_KEY, raw);
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("BrowserSettingsGateway initial window zoom", () => {
  it.each([null, "{", "[]", "null", '"zoom"', "{}", '{"windowZoomLevel":"2"}'])(
    "uses the same zero fallback for startup and hydration of %s",
    async (raw) => {
      const gateway = new BrowserSettingsGateway(memoryStorage(raw));
      expect(gateway.readInitialWindowZoomLevel()).toBe(0);
      expect(initialAppSettings(gateway).windowZoomLevel).toBe(0);
      expect((await gateway.loadAppSettings()).windowZoomLevel).toBe(0);
    },
  );

  it.each([
    [-100, -8],
    [100, 8],
    [-3.8, -3],
    [3.8, 3],
    [2, 2],
  ])("keeps startup, first render and hydrated zoom %s at %s", async (level, expected) => {
    const gateway = new BrowserSettingsGateway(
      memoryStorage(JSON.stringify({ windowZoomLevel: level })),
    );
    expect(gateway.readInitialWindowZoomLevel()).toBe(expected);
    expect(initialAppSettings(gateway).windowZoomLevel).toBe(expected);
    expect((await gateway.loadAppSettings()).windowZoomLevel).toBe(expected);
  });

  it("keeps oversized appearance and zoom at their defaults through hydration", async () => {
    const raw = JSON.stringify({
      appearance: { palette: "ink-mint", colorScheme: "light", syntaxTheme: "dracula" },
      windowZoomLevel: 3,
      padding: "x".repeat(MAX_STARTUP_SETTINGS_LENGTH),
    });
    const gateway = new BrowserSettingsGateway(memoryStorage(raw));
    const initial = initialAppSettings(gateway);
    const hydrated = await gateway.loadAppSettings();
    expect(initial.windowZoomLevel).toBe(0);
    expect(hydrated.windowZoomLevel).toBe(initial.windowZoomLevel);
    expect(initial.appearance).toEqual(DEFAULT_APPEARANCE);
    expect(hydrated.appearance).toEqual(initial.appearance);
  });

  it("roundtrips saved zoom and appearance into the next first render", async () => {
    const storage = memoryStorage(null);
    const gateway = new BrowserSettingsGateway(storage);
    const settings = {
      ...defaultAppSettings(),
      windowZoomLevel: -2,
      appearance: { palette: "ink-mint", colorScheme: "light", syntaxTheme: "dracula" } as const,
    };
    await gateway.saveAppSettings(settings);
    const reopened = new BrowserSettingsGateway(storage);
    const initial = initialAppSettings(reopened);
    expect(initial.windowZoomLevel).toBe(-2);
    expect(initial.appearance).toEqual(settings.appearance);
    expect((await reopened.loadAppSettings()).windowZoomLevel).toBe(initial.windowZoomLevel);
  });

  it("falls back safely for both startup and hydration when storage fails", async () => {
    const gateway = new BrowserSettingsGateway({
      ...memoryStorage(null),
      getItem: () => JSON.parse("{") as string,
    });
    expect(gateway.readInitialWindowZoomLevel()).toBe(0);
    expect(initialAppSettings(gateway)).toEqual(defaultAppSettings());
    expect(await gateway.loadAppSettings()).toEqual(defaultAppSettings());
  });
});
