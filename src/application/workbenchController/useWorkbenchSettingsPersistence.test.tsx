// @vitest-environment jsdom

import { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  type AppSettings,
} from "../../domain/settings";
import { createWorkspaceSettingsByRootSnapshot } from "../workspaceSettingsForRoot";
import { createWorkspaceSettingsSaveCoordinator } from "../workspaceSettingsSaveCoordinator";
import { useWorkbenchSettingsPersistence } from "./useWorkbenchSettingsPersistence";

describe("useWorkbenchSettingsPersistence app settings owner", () => {
  it("serializes skip persistence with an unrelated save without losing either field", async () => {
    let settleFirst!: () => void;
    const saveAppSettings = vi
      .fn<(settings: AppSettings) => Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            settleFirst = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    let surface:
      | {
          readonly appSettings: AppSettings;
          readonly persistAppSettings: (settings: AppSettings) => Promise<void>;
          readonly persistAppUpdaterSkippedVersion: (version: string) => Promise<void>;
          readonly persistTheme: () => Promise<void>;
        }
      | undefined;
    const host = document.createElement("div");
    const root = createRoot(host);

    function Probe() {
      const [appSettings, setAppSettings] = useState(defaultAppSettings);
      const [workspaceSettings, setWorkspaceSettings] = useState(defaultWorkspaceSettings);
      const appSettingsRef = useRef(appSettings);
      appSettingsRef.current = appSettings;
      const persistence = useWorkbenchSettingsPersistence({
        appSettingsRef,
        currentWorkspaceRootRef: useRef<string | null>(null),
        reportError: vi.fn(),
        setAppSettings,
        setWorkspaceSettings,
        settingsGateway: {
          loadAppSettings: async () => appSettingsRef.current,
          saveAppSettings,
          loadWorkspaceSettings: async () => workspaceSettings,
          saveWorkspaceSettings: async () => undefined,
        },
        workspaceIdentityByRootRef: useRef({}),
        workspaceSettingsByRoot: createWorkspaceSettingsByRootSnapshot(),
        workspaceSettingsRef: useRef(workspaceSettings),
        workspaceSettingsSaveCoordinator: createWorkspaceSettingsSaveCoordinator(),
      });
      surface = {
        appSettings,
        ...persistence,
        persistTheme: () =>
          persistence.persistAppSettings({ ...appSettingsRef.current, theme: "light" }),
      };
      return null;
    }

    act(() => root.render(<Probe />));
    let skipSave!: Promise<void>;
    let themeSave!: Promise<void>;
    act(() => {
      const current = readSurface(surface);
      skipSave = current.persistAppUpdaterSkippedVersion("0.2.0");
      themeSave = current.persistTheme();
    });
    await act(async () => Promise.resolve());
    expect(saveAppSettings).toHaveBeenCalledTimes(1);
    expect(readSurface(surface).appSettings).toMatchObject({
      appUpdaterSkippedVersion: "0.2.0",
      theme: "light",
    });

    await act(async () => {
      settleFirst();
      await Promise.all([skipSave, themeSave]);
    });
    expect(saveAppSettings).toHaveBeenCalledTimes(2);
    expect(saveAppSettings.mock.calls[1]?.[0]).toMatchObject({
      appUpdaterSkippedVersion: "0.2.0",
      theme: "light",
    });
    act(() => root.unmount());
  });
});

function readSurface<T>(surface: T | undefined): T {
  if (surface === undefined) throw new Error("Settings persistence did not render.");
  return surface;
}
