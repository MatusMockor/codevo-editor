import { describe, expect, it } from "vitest";
import { defaultAppSettings, defaultWorkspaceSettings } from "../../domain/settings";
import type { AppSettings, WorkspaceSettings } from "../../domain/settings";
import { settingsDraftPersistence } from "./settingsDraftPersistence";
import type { SettingsSaveInput } from "./settingsPageProps";

describe("settingsDraftPersistence", () => {
  it("publishes and saves every draft change", () => {
    const harness = draftHarness(true);

    harness.actions.updateAppSettings({ ...defaultAppSettings(), theme: "light" });
    harness.actions.updateWorkspaceSettings({ ...defaultWorkspaceSettings(), autoSave: true });
    harness.actions.updateTrusted(true);

    expect(harness.published.appSettings.map((settings) => settings.theme)).toEqual(["light"]);
    expect(harness.saved).toHaveLength(3);
    expect(harness.saved[0]?.appSettings.theme).toBe("light");
    expect(harness.saved[1]?.workspaceSettings.autoSave).toBe(true);
    expect(harness.saved[2]?.trusted).toBe(true);
  });

  it("publishes a provider intent without a second write through the generic autosave", () => {
    const harness = draftHarness(true);
    const proposed = { ...defaultAppSettings(), agentCliKind: "codex" as const };

    harness.actions.publishAppSettings(proposed);

    expect(harness.published.appSettings).toEqual([proposed]);
    expect(harness.appSettingsRef.current).toBe(proposed);
    expect(harness.saved).toEqual([]);
  });

  it("reports no trust authority when the draft has no workspace", () => {
    const harness = draftHarness(false);

    harness.actions.save({});

    expect(harness.saved[0]?.trusted).toBeNull();
  });
});

function draftHarness(hasWorkspace: boolean) {
  const appSettingsRef = { current: defaultAppSettings() };
  const workspaceSettingsRef = { current: defaultWorkspaceSettings() };
  const trustedRef = { current: false };
  const published = {
    appSettings: [] as AppSettings[],
    trusted: [] as boolean[],
    workspaceSettings: [] as WorkspaceSettings[],
  };
  const saved: SettingsSaveInput[] = [];
  const actions = settingsDraftPersistence({
    appSettingsRef,
    hasWorkspace,
    onSave: async (input) => {
      saved.push(input);
    },
    setAppSettings: (settings) => published.appSettings.push(settings as AppSettings),
    setTrusted: (trusted) => published.trusted.push(trusted as boolean),
    setWorkspaceSettings: (settings) =>
      published.workspaceSettings.push(settings as WorkspaceSettings),
    trustedRef,
    workspaceSettingsRef,
  });

  return { actions, appSettingsRef, published, saved, trustedRef, workspaceSettingsRef };
}
