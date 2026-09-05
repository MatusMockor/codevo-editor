// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentProviderManagementSurface,
  AgentProviderManagementToast,
} from "../application/useAgentProviderManagement";
import type { WorkbenchAppUpdaterComposition } from "../application/workbenchController/useWorkbenchAppUpdaterComposition";
import {
  createWorkbenchNotice,
  languageServerCrashNoticeGroupKey,
  type WorkbenchNotice,
} from "../application/workbenchNotice";
import type { AppUpdaterGateway } from "../domain/appUpdater";
import { defaultAgentCliDiscoveryResult } from "../domain/agentSettings";
import { defaultAppSettings, defaultWorkspaceSettings } from "../domain/settings";
import { waitForReact } from "../test/reactTestLifecycle";
import type { NodeLaunchConfigurationFileGateway } from "./useNodeLaunchConfigurationsDialogController";
import {
  WorkbenchAppUpdaterHost,
  type WorkbenchAppUpdaterHostProps,
} from "./WorkbenchAppUpdaterHost";

vi.mock("./appLazySurfaces", () => ({
  LazySurfaceHost: () => null,
  LazyWorkbenchSettingsDialogHost: () => null,
}));

describe("WorkbenchAppUpdaterHost", () => {
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

  it("routes the provider update toast through the notification host with exact actions", async () => {
    const update = vi.fn(async () => null);
    const dismissUpdate = vi.fn(async () => true);
    const props = hostProps({
      providerManagement: {
        ...providerManagement(),
        toast: { kind: "updateAvailable", provider: "codex", version: "0.150.1" },
        dismissUpdate,
        update,
      },
    });
    await render(props);

    expect(host.querySelector(".toast-region")?.textContent).toContain("Codex v0.150.1");
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    dismissUpdate.mockResolvedValueOnce(false);
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="Dismiss notification"]')?.click();
      await Promise.resolve();
    });
    expect(dismissUpdate).toHaveBeenCalledWith("codex", "0.150.1");
    expect(host.querySelector(".toast-region")).not.toBeNull();

    await click("Update");
    expect(update).toHaveBeenCalledWith("codex", "0.150.1");
    await waitForReact(() => {
      expect(host.querySelector(".toast-region")).toBeNull();
    });
  });

  it("opens agent settings from the provider toast and clears the management toast", async () => {
    const configureAgentCli = vi.fn();
    const dismissToast = vi.fn();
    const props = hostProps({
      providerManagement: {
        ...providerManagement(),
        toast: { kind: "updateAvailable", provider: "claudeCode", version: "1.2.3", manual: true },
        dismissToast,
      },
      configureAgentCli,
    });
    await render(props);

    expect(buttonLabels()).not.toContain("Update");
    await click("Settings");
    expect(dismissToast).toHaveBeenCalledOnce();
    expect(configureAgentCli).toHaveBeenCalledOnce();
  });

  it("walks the application update through download and restart as a toast", async () => {
    const gateway = updaterGateway();
    const props = hostProps({ gateway });
    await render(props);

    await waitForReact(() => {
      expect(host.textContent).toContain("Update Available: Codevo v0.2.0");
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();

    await click("Download");
    await waitForReact(() => {
      expect(host.textContent).toContain("Update 0.2.0 downloaded. Click to restart and install.");
    });
    expect(gateway.download).toHaveBeenCalledWith(7);

    await click("Restart");
    await waitForReact(() => {
      expect(gateway.installAndRestart).toHaveBeenCalledWith(7);
    });
  });

  it("keeps urgent workbench notices in front while update toasts wait behind", async () => {
    const gateway = updaterGateway();
    const crash = createWorkbenchNotice(
      "error",
      "Language Server",
      "Crashed",
      languageServerCrashNoticeGroupKey("/workspace") ?? undefined,
    );
    const props = hostProps({
      gateway,
      notices: [crash],
      providerManagement: {
        ...providerManagement(),
        toast: { kind: "updateSucceeded", provider: "codex", version: "0.150.1" },
      },
      workspaceRoot: "/workspace",
    });
    await render(props);

    await waitForReact(() => {
      expect(gateway.check).toHaveBeenCalledOnce();
      expect(host.querySelectorAll(".toast-region__slot")).toHaveLength(2);
    });
    const slots = Array.from(host.querySelectorAll(".toast-region__slot"));
    expect(slots[0]?.classList.contains("toast-region__slot--front")).toBe(true);
    expect(slots[0]?.querySelector('[role="alert"]')?.textContent).toContain("Crashed");
    expect(slots[1]?.textContent).toContain("Codex updated: v0.150.1");
    expect(slots[1]?.getAttribute("aria-hidden")).toBe("true");
    expect(host.textContent).not.toContain("Update Available: Codevo v0.2.0");
  });

  it("stacks the application update behind a provider toast", async () => {
    const gateway = updaterGateway();
    const props = hostProps({
      gateway,
      providerManagement: {
        ...providerManagement(),
        toast: { kind: "updateSucceeded", provider: "codex", version: "0.150.1" },
      },
    });
    await render(props);

    await waitForReact(() => {
      expect(host.querySelectorAll(".toast-region__slot")).toHaveLength(2);
    });
    const slots = Array.from(host.querySelectorAll(".toast-region__slot"));
    expect(slots[0]?.textContent).toContain("Codex updated: v0.150.1");
    expect(slots[1]?.textContent).toContain("Update Available: Codevo v0.2.0");
    expect(slots[1]?.getAttribute("aria-hidden")).toBe("true");
  });

  it("surfaces a refused update as a toast and clears it with the next management toast", async () => {
    const update = vi.fn(async () => "turnActive" as const);
    const management = {
      ...providerManagement(),
      toast: { kind: "updateAvailable", provider: "codex", version: "0.150.1" } as const,
      update,
    };
    const props = hostProps({ providerManagement: management });
    await render(props);

    await click("Update");
    await waitForReact(() => {
      expect(host.textContent).toContain("Provider update not started");
    });
    expect(host.textContent).toContain("A provider turn is running.");

    await render({
      ...props,
      providerManagement: {
        ...management,
        toast: { kind: "updateAvailable", provider: "codex", version: "0.150.2" },
      },
    });
    await waitForReact(() => {
      expect(host.textContent).not.toContain("Provider update not started");
    });
    expect(host.textContent).toContain("Codex v0.150.2");
  });

  it("keeps a failed startup check silent", async () => {
    const gateway = updaterGateway();
    gateway.check.mockRejectedValue(new Error("offline"));
    await render(hostProps({ gateway }));

    await waitForReact(() => {
      expect(gateway.check).toHaveBeenCalledOnce();
    });
    await act(async () => Promise.resolve());
    expect(host.querySelector(".toast-region")).toBeNull();
  });

  async function render(props: WorkbenchAppUpdaterHostProps): Promise<void> {
    await act(async () => {
      root.render(<WorkbenchAppUpdaterHost {...props} />);
    });
  }

  async function click(label: string): Promise<void> {
    const button = Array.from(host.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === label,
    );
    expect(button, `Missing ${label}`).toBeDefined();
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });
  }

  function buttonLabels(): string[] {
    return Array.from(host.querySelectorAll("button")).map((button) => button.textContent ?? "");
  }
});

function hostProps(overrides: {
  readonly configureAgentCli?: () => void;
  readonly gateway?: AppUpdaterGateway;
  readonly notices?: WorkbenchNotice[];
  readonly providerManagement?: AgentProviderManagementSurface;
  readonly workspaceRoot?: string;
}): WorkbenchAppUpdaterHostProps {
  const composition: WorkbenchAppUpdaterComposition = {
    appUpdaterGateway: overrides.gateway ?? upToDateGateway(),
    appUpdaterPreferencesGateway: { loadSkippedVersion: async () => null },
    appVersion: "0.1.0",
  };
  return {
    composition,
    onOpenAgentSettings: overrides.configureAgentCli ?? vi.fn(),
    onOpenRuntimePanel: vi.fn(),
    providerManagement: overrides.providerManagement ?? providerManagement(),
    systemFontGateway: { listMonospaceFontFamilies: async () => [] },
    workbench: {
      appSettings: defaultAppSettings(),
      closeNodeLaunchConfigurations: vi.fn(),
      gitRepositoryMappings: [],
      installManagedPhpactor: vi.fn(),
      installingManagedPhpactor: false,
      intelligenceMode: "basic",
      nodeLaunchConfigurationsOpen: false,
      notices: overrides.notices ?? [],
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
      workspaceRoot: overrides.workspaceRoot ?? null,
      workspaceSettings: defaultWorkspaceSettings(),
      workspaceTrust: null,
    },
    workspaceFiles: fileGateway(),
    workspaceTrusted: false,
  };
}

function upToDateGateway(): AppUpdaterGateway {
  return {
    check: async () => ({ kind: "upToDate", currentVersion: "0.1.0" }),
    download: async () => undefined,
    installAndRestart: async () => undefined,
    dispose: async () => undefined,
  };
}

function updaterGateway() {
  return {
    check: vi.fn<AppUpdaterGateway["check"]>(async () => ({
      kind: "available",
      candidate: {
        candidateRevision: 7,
        currentVersion: "0.1.0",
        version: "0.2.0",
        date: null,
        notes: null,
      },
    })),
    download: vi.fn<AppUpdaterGateway["download"]>(async () => undefined),
    installAndRestart: vi.fn<AppUpdaterGateway["installAndRestart"]>(async () => undefined),
    dispose: vi.fn<AppUpdaterGateway["dispose"]>(async () => undefined),
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

function providerManagement(
  toast: AgentProviderManagementToast | null = null,
): AgentProviderManagementSurface {
  const preference = {
    enabled: true,
    healthCheckIntervalSeconds: 300,
    checkForUpdates: true,
    dismissedUpdateVersion: null,
  };
  const view = {
    executable: { kind: "notFound", installCommand: "npm i -g @openai/codex" },
    health: { kind: "notConfigured" },
    policy: { kind: "unregistered" },
    updateState: { kind: "idle" },
    liveTurnCount: 0,
  } as const;
  return {
    cliDiscovery: defaultAgentCliDiscoveryResult(),
    providers: { claudeCode: view, codex: view },
    selectedProviderAuthority: null,
    toast,
    admissionAuthority: (provider) => ({
      provider,
      revision: 1,
      disposition: { kind: "disabled" },
    }),
    authority: (provider) => ({ provider, settingsRevision: 1, preference, cliPath: null }),
    dismissToast: vi.fn(),
    dismissUpdate: vi.fn(async () => true),
    refresh: async () => undefined,
    retryRegistration: async () => undefined,
    save: async () => true,
    saveWithOutcome: async () => ({ kind: "persisted", policyRegistered: false }),
    update: vi.fn(async () => null),
  };
}
