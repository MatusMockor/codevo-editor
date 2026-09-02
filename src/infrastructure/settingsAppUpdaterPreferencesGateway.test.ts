import { describe, expect, it, vi } from "vitest";
import { defaultAppSettings } from "../domain/settings";
import { SettingsAppUpdaterPreferencesGateway } from "./settingsAppUpdaterPreferencesGateway";

describe("SettingsAppUpdaterPreferencesGateway", () => {
  it("reads the exact skipped version from canonical AppSettings", async () => {
    const settings = { ...defaultAppSettings(), appUpdaterSkippedVersion: "0.2.0" };
    const settingsGateway = {
      loadAppSettings: vi.fn(async () => settings),
      saveAppSettings: vi.fn(async () => undefined),
    };
    const gateway = new SettingsAppUpdaterPreferencesGateway(settingsGateway);
    await expect(gateway.loadSkippedVersion()).resolves.toBe("0.2.0");
    expect(settingsGateway.saveAppSettings).not.toHaveBeenCalled();
  });
});
