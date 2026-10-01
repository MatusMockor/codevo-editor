// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProviderManagementSurface } from "../application/useAgentProviderManagement";
import type { AgentProviderSignInSurface } from "../application/useAgentProviderSignIn";
import { defaultAgentCliDiscoveryResult } from "../domain/agentSettings";
import type { LanguageServerPlan } from "../domain/languageServer";
import { defaultAppSettings, defaultWorkspaceSettings } from "../domain/settings";
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
  return {
    appUpdater: {
      state: { kind: "idle", currentVersion: "0.1.0" },
      check: vi.fn(async () => undefined),
      dismiss: vi.fn(),
      download: vi.fn(async () => undefined),
      installAndRestart: vi.fn(async () => undefined),
      skipVersion: vi.fn(async () => undefined),
    },
    onOpenRuntimePanel: vi.fn(),
    settingsContainer: null,
    systemFontGateway: { listMonospaceFontFamilies: async () => [] },
    workbench: {
      agents: {
        configureAgentCli: vi.fn(),
        providerManagement: providerManagement(),
        providerSignIn: {} as AgentProviderSignInSurface,
      },
      appSettings: defaultAppSettings(),
      gitRepositoryMappings: [],
      installManagedPhpactor: vi.fn(),
      installingManagedPhpactor: false,
      intelligenceMode: "basic",
      languageServerPlan: setupPlan(),
      languageServerSetupOpen,
      notices: [],
      openJavaScriptTypeScriptServiceLog: vi.fn(async () => undefined),
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
    refreshAll: async () => undefined,
    retryRegistration: async () => undefined,
    save: async () => false,
    saveWithOutcome: async () => ({ kind: "rejected", reason: "notHydrated" }),
    update: async () => "policyUnavailable",
  };
}
