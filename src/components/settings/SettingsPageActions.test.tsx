// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  type AppSettings,
} from "../../domain/settings";
import { SettingsPageActions } from "./SettingsPageActions";
import type { SettingsDraft, SettingsDraftActions, SettingsEnvironment } from "./settingsPageProps";
import type { SettingsSectionId } from "./settingsRegistry";

describe("SettingsPageActions", () => {
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

  it("restores General visual defaults without touching providers or keymap", () => {
    const updateAppSettings = vi.fn<(settings: AppSettings) => void>();
    const appSettings: AppSettings = {
      ...defaultAppSettings(),
      editorFontSize: 22,
      appearance: { palette: "zinc-orange", colorScheme: "light", syntaxTheme: "dracula" },
      agentCliKind: "codex",
    };

    renderActions("general", { actions: actionsWith({ updateAppSettings }), appSettings });
    act(() => buttonNamed("Restore defaults")?.click());

    const restored = updateAppSettings.mock.calls[0]?.[0];
    expect(restored?.editorFontSize).toBe(defaultAppSettings().editorFontSize);
    expect(restored?.appearance).toEqual(defaultAppSettings().appearance);
    expect(restored?.agentCliKind).toBe("codex");
  });

  it("runs CLI diagnostics for both providers from the Providers top bar", () => {
    const refresh = vi.fn<(provider: string) => Promise<void>>(async () => undefined);
    const management: Pick<AgentProviderManagementSurface, "refresh"> = { refresh };

    renderActions("agents", {
      env: { ...environment(), providerManagement: management as AgentProviderManagementSurface },
    });
    act(() => buttonNamed("Run CLI diagnostics")?.click());

    expect(refresh).toHaveBeenCalledWith("claudeCode");
    expect(refresh).toHaveBeenCalledWith("codex");
  });

  it("disables CLI diagnostics while provider management is unavailable", () => {
    renderActions("agents", {});

    expect(buttonNamed("Run CLI diagnostics")?.disabled).toBe(true);
  });

  it("renders nothing for sections without page actions", () => {
    for (const section of [
      "environments",
      "keymap",
      "index",
      "snippets",
      "archive",
      "php",
    ] as const) {
      renderActions(section, {});
      expect(host.textContent).toBe("");
    }
  });

  function renderActions(
    section: SettingsSectionId,
    options: {
      readonly actions?: SettingsDraftActions;
      readonly appSettings?: AppSettings;
      readonly env?: SettingsEnvironment;
    },
  ): void {
    act(() =>
      root.render(
        <SettingsPageActions
          actions={options.actions ?? actionsWith({})}
          draft={draftWith(options.appSettings ?? defaultAppSettings())}
          env={options.env ?? environment()}
          section={section}
        />,
      ),
    );
  }

  function buttonNamed(name: string): HTMLButtonElement | null {
    return (
      [...host.querySelectorAll("button")].find((button) => button.textContent === name) ?? null
    );
  }
});

function draftWith(appSettings: AppSettings): SettingsDraft {
  return {
    appSettings,
    ignorePatternsText: "",
    trusted: false,
    workspaceSettings: defaultWorkspaceSettings(),
  };
}

function actionsWith(overrides: Partial<SettingsDraftActions>): SettingsDraftActions {
  return {
    publishAppSettings: vi.fn(),
    save: vi.fn(),
    updateAppSettings: vi.fn(),
    updateIgnorePatternsText: vi.fn(),
    updateTrusted: vi.fn(),
    updateWorkspaceSettings: vi.fn(),
    ...overrides,
  };
}

function environment(): SettingsEnvironment {
  return {
    appUpdater: null,
    gitDetectedRepositoryMappings: [],
    hasWorkspace: true,
    onCopyInstallCommand: () => undefined,
    onOpenJavaScriptTypeScriptServiceLog: async () => undefined,
    onOpenNodeLaunchConfigurations: () => undefined,
    onRestartJavaScriptTypeScriptService: async () => undefined,
    phpTools: null,
    providerManagement: null,
    providerSignIn: null,
    systemFontGateway: { listMonospaceFontFamilies: async () => [] },
    workspaceDescriptor: null,
    workspaceRoot: "/workspace",
  };
}
