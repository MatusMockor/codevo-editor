// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultAppSettings, defaultWorkspaceSettings } from "../../../domain/settings";
import type {
  SettingsDraft,
  SettingsDraftActions,
  SettingsEnvironment,
} from "../settingsPageProps";
import { SettingsPageHost } from "../settingsPages";
import { SETTINGS_SECTIONS, settingsRowsForSection } from "../settingsRegistry";

const draft: SettingsDraft = {
  appSettings: defaultAppSettings(),
  ignorePatternsText: "",
  trusted: false,
  workspaceSettings: defaultWorkspaceSettings(),
};

const actions: SettingsDraftActions = {
  publishAppSettings: () => undefined,
  save: () => undefined,
  updateAppSettings: () => undefined,
  updateIgnorePatternsText: () => undefined,
  updateTrusted: () => undefined,
  updateWorkspaceSettings: () => undefined,
};

const env: SettingsEnvironment = {
  appUpdater: null,
  gitDetectedRepositoryMappings: [],
  hasWorkspace: true,
  phpTools: null,
  providerManagement: null,
  providerSignIn: null,
  systemFontGateway: { listMonospaceFontFamilies: async () => [] },
  workspaceDescriptor: null,
  workspaceRoot: "/tmp/project",
  onCopyInstallCommand: () => undefined,
  onOpenJavaScriptTypeScriptServiceLog: async () => undefined,
  onOpenNodeLaunchConfigurations: () => undefined,
  onRestartJavaScriptTypeScriptService: async () => undefined,
};

describe("settings page parity", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  for (const section of SETTINGS_SECTIONS) {
    it(`renders exactly the registry rows for ${section.id}`, () => {
      act(() =>
        root.render(
          <SettingsPageHost actions={actions} draft={draft} env={env} section={section.id} />,
        ),
      );

      const rendered = [...host.querySelectorAll("[data-settings-row]")].map((element) =>
        element.getAttribute("data-settings-row"),
      );

      expect(rendered).toEqual(settingsRowsForSection(section.id).map((row) => row.id));
      expect(host.querySelectorAll("h2").length).toBeGreaterThan(0);
    });
  }
});
