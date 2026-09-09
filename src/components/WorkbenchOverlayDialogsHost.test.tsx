// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProviderManagementSurface } from "../application/useAgentProviderManagement";
import type { WorkbenchAppUpdaterComposition } from "../application/workbenchController/useWorkbenchAppUpdaterComposition";
import { defaultAgentCliDiscoveryResult } from "../domain/agentSettings";
import type { AppUpdaterGateway } from "../domain/appUpdater";
import type { LanguageServerPlan } from "../domain/languageServer";
import { defaultAppSettings, defaultWorkspaceSettings } from "../domain/settings";
import type { NodeLaunchConfigurationFileGateway } from "./useNodeLaunchConfigurationsDialogController";
import {
  WorkbenchOverlayDialogsHost,
  type WorkbenchOverlayDialogsHostProps,
} from "./WorkbenchOverlayDialogsHost";

vi.mock("./appLazySurfaces", () => ({
  LazySurfaceHost: () => null,
  LazyWorkbenchSettingsHost: () => null,
}));

describe("WorkbenchOverlayDialogsHost", () => {
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

  it("keeps the language server setup dialog closed until the workbench opens it", async () => {
    await render(hostProps(false));

    expect(dialog()).toBeNull();
  });

  it("hosts the language server setup dialog beside the update toasts", async () => {
    const props = hostProps(true);
    await render(props);

    expect(dialog()?.getAttribute("aria-label")).toBe("PHP IDE Engine Setup");

    const close = dialog()?.querySelector<HTMLButtonElement>('[title="Close"]');
    await act(async () => close?.click());

    expect(props.workbench.setLanguageServerSetupOpen).toHaveBeenCalledWith(false);
  });

  async function render(props: WorkbenchOverlayDialogsHostProps): Promise<void> {
    await act(async () => {
      root.render(<WorkbenchOverlayDialogsHost {...props} />);
      await Promise.resolve();
    });
  }

  function dialog(): HTMLElement | null {
    return host.querySelector(".language-server-setup");
  }
});

function hostProps(languageServerSetupOpen: boolean): WorkbenchOverlayDialogsHostProps {
  const composition: WorkbenchAppUpdaterComposition = {
    appUpdaterGateway: idleGateway(),
    appUpdaterPreferencesGateway: { loadSkippedVersion: async () => null },
    appVersion: "0.1.0",
  };
  return {
    composition,
    onOpenAgentSettings: vi.fn(),
    onOpenRuntimePanel: vi.fn(),
    providerManagement: providerManagement(),
    settingsContainer: null,
    systemFontGateway: { listMonospaceFontFamilies: async () => [] },
    workbench: {
      appSettings: defaultAppSettings(),
      closeNodeLaunchConfigurations: vi.fn(),
      gitRepositoryMappings: [],
      installManagedPhpactor: vi.fn(),
      installingManagedPhpactor: false,
      intelligenceMode: "basic",
      languageServerPlan: setupPlan(),
      languageServerSetupOpen,
      nodeLaunchConfigurationsOpen: false,
      notices: [],
      openNodeLaunchConfigurations: vi.fn(),
      openJavaScriptTypeScriptServiceLog: vi.fn(async () => undefined),
      persistAppUpdaterSkippedVersion: vi.fn(async () => undefined),
      phpTools: null,
      restartJavaScriptTypeScriptService: vi.fn(async () => undefined),
      saveWorkbenchSettings: vi.fn(async () => undefined),
      setLanguageServerSetupOpen: vi.fn(),
      settingsInitialSection: "general",
      settingsOpen: false,
      setSettingsOpen: vi.fn(),
      workspaceDescriptor: null,
      workspaceIdentityDescriptor: null,
      workspaceRoot: null,
      workspaceSettings: defaultWorkspaceSettings(),
      workspaceTrust: null,
    },
    workspaceFiles: fileGateway(),
    workspaceTrusted: false,
  };
}

function setupPlan(): LanguageServerPlan {
  return {
    provider: "phpactor",
    status: "unavailable",
    message: "Phpactor is not installed.",
    command: null,
    initializeRequest: null,
  };
}

function idleGateway(): AppUpdaterGateway {
  return {
    check: async () => ({ kind: "upToDate", currentVersion: "0.1.0" }),
    dispose: async () => undefined,
    download: async () => "readyToInstall",
    installAndRestart: async () => undefined,
  };
}

function providerManagement(): AgentProviderManagementSurface {
  return {
    cliDiscovery: defaultAgentCliDiscoveryResult(),
    providers: {
      claudeCode: {
        executable: { kind: "notFound", installCommand: "npm i -g @anthropic-ai/claude-code" },
        health: { kind: "notConfigured" },
        policy: { kind: "unregistered" },
        updateState: { kind: "idle" },
        liveTurnCount: 0,
      },
      codex: {
        executable: { kind: "notFound", installCommand: "npm i -g @openai/codex" },
        health: { kind: "notConfigured" },
        policy: { kind: "unregistered" },
        updateState: { kind: "idle" },
        liveTurnCount: 0,
      },
    },
    selectedProviderAuthority: null,
    toast: null,
    admissionAuthority: (provider) => ({
      provider,
      revision: 0,
      disposition: { kind: "policyUnavailable", reason: "unregistered" },
    }),
    authority: () => null,
    dismissToast: vi.fn(),
    dismissUpdate: async () => false,
    refresh: async () => undefined,
    retryRegistration: async () => undefined,
    save: async () => false,
    saveWithOutcome: async () => ({ kind: "rejected", reason: "notHydrated" }),
    update: async () => "policyUnavailable",
  };
}

function fileGateway(): NodeLaunchConfigurationFileGateway {
  return {
    createDirectoryForWorkspace: async () => undefined,
    createTextFileWithContentForWorkspace: async () => ({ status: "success", revision: null }),
    readDirectory: async () => [],
    readTextFileSnapshot: async () => ({ content: "", revision: null }),
    writeTextFileForWorkspace: async () => ({ status: "success", revision: null }),
  };
}
