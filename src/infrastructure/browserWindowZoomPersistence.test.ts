import { describe, expect, it } from "vitest";
import { defaultAppSettings, normalizeAppSettings } from "../domain/settings";
import { transitionWindowZoomLevel } from "../domain/windowZoom";
import {
  APP_SETTINGS_KEY,
  BrowserSettingsGateway,
  type KeyValueStorage,
} from "./browserSettingsGateway";

describe("persisted window zoom", () => {
  it("defaults older settings without window zoom to zero", async () => {
    const storage = memoryStorage();
    storage.setItem(APP_SETTINGS_KEY, JSON.stringify({ editorFontSize: 18 }));
    expect((await new BrowserSettingsGateway(storage).loadAppSettings()).windowZoomLevel).toBe(0);
    expect(defaultAppSettings().windowZoomLevel).toBe(0);
  });

  it.each([undefined, null, "3", true, {}, [], Number.NaN, Infinity, -Infinity])(
    "repairs malformed persisted zoom %j",
    async (windowZoomLevel) => {
      const storage = memoryStorage();
      storage.setItem(APP_SETTINGS_KEY, JSON.stringify({ windowZoomLevel }));
      const gateway = new BrowserSettingsGateway(storage);
      const settings = await gateway.loadAppSettings();
      expect(settings.windowZoomLevel).toBe(0);
      expect(normalizeAppSettings({ windowZoomLevel }).windowZoomLevel).toBe(0);
      await gateway.saveAppSettings(settings);
      expect((await new BrowserSettingsGateway(storage).loadAppSettings()).windowZoomLevel).toBe(0);
    },
  );

  it.each([
    [-100, -8],
    [100, 8],
    [-3.8, -3],
    [3.8, 3],
  ])("normalizes persisted zoom %s to %s", async (windowZoomLevel, expected) => {
    const storage = memoryStorage();
    storage.setItem(APP_SETTINGS_KEY, JSON.stringify({ windowZoomLevel }));
    const gateway = new BrowserSettingsGateway(storage);
    const settings = await gateway.loadAppSettings();
    expect(settings.windowZoomLevel).toBe(expected);
    await gateway.saveAppSettings(settings);
    expect((await new BrowserSettingsGateway(storage).loadAppSettings()).windowZoomLevel).toBe(
      expected,
    );
  });

  it("roundtrips zoom transitions while preserving independent appearance and font settings", async () => {
    const storage = memoryStorage();
    const gateway = new BrowserSettingsGateway(storage);
    const original = {
      ...defaultAppSettings(),
      appearance: { palette: "slate-blue", colorScheme: "light", syntaxTheme: "oneLight" } as const,
      editorFontSize: 19,
      agentThreadFontSize: 18,
    };
    await gateway.saveAppSettings(original);
    for (const action of ["in", "in", "out", "reset"] as const) {
      const settings = await gateway.loadAppSettings();
      const windowZoomLevel = transitionWindowZoomLevel(settings.windowZoomLevel, action);
      await gateway.saveAppSettings({ ...settings, windowZoomLevel });
      const loaded = await new BrowserSettingsGateway(storage).loadAppSettings();
      expect(loaded).toEqual({ ...original, windowZoomLevel });
    }
    expect(storage.getItem(APP_SETTINGS_KEY)).toContain('"windowZoomLevel":0');
  });
});

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
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
