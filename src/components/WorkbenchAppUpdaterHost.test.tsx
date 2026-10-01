// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentProviderManagementSurface,
  AgentProviderManagementToast,
} from "../application/useAgentProviderManagement";
import {
  useWorkbenchAppUpdaterComposition,
  type WorkbenchAppUpdaterComposition,
} from "../application/workbenchController/useWorkbenchAppUpdaterComposition";
import {
  createWorkbenchNotice,
  languageServerCrashNoticeGroupKey,
  type WorkbenchNotice,
} from "../application/workbenchNotice";
import type { AppUpdaterGateway } from "../domain/appUpdater";
import type { AgentProviderHealthState } from "../domain/agentProviderHealth";
import { defaultAgentCliDiscoveryResult, type AgentCliKind } from "../domain/agentSettings";
import { defaultAppSettings, defaultWorkspaceSettings } from "../domain/settings";
import { waitForReact } from "../test/reactTestLifecycle";
import { AgentProviderRailFooter } from "./agentMode/AgentProviderRailFooter";
import { AppUpdaterContext } from "./appUpdaterContext";
import {
  WorkbenchAppUpdaterHost,
  type WorkbenchAppUpdaterHostProps,
} from "./WorkbenchAppUpdaterHost";

vi.mock("./appLazySurfaces", () => ({
  LazySurfaceHost: ({
    active,
    children,
  }: {
    readonly active: boolean;
    readonly children: ReactNode;
  }) => {
    mocks.settingsSurfaceActive.push(active);
    return active ? <>{children}</> : null;
  },
  LazyWorkbenchSettingsHost: ({ container }: { readonly container: HTMLElement | null }) => {
    mocks.settingsContainers.push(container);
    return null;
  },
}));

const mocks = vi.hoisted(() => ({
  settingsContainers: [] as Array<HTMLElement | null>,
  settingsSurfaceActive: [] as boolean[],
}));

describe("WorkbenchAppUpdaterHost", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mocks.settingsContainers.length = 0;
    mocks.settingsSurfaceActive.length = 0;
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
        providers: providersOffering("codex", "0.150.1"),
        toast: { kind: "updateAvailable", provider: "codex", version: "0.150.1" },
        dismissUpdate,
        update,
      },
    });
    await render(props);

    expect(host.querySelector(".toast-update-row__provider")?.textContent).toBe("Codex");
    expect(host.querySelector(".toast-update-row__to")?.textContent).toBe("v0.150.1");
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
        providers: providersOffering("claudeCode", "1.2.3", "manual"),
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
      expect(host.textContent).toContain("Update available: Codevo v0.2.0");
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();

    await click("Update");
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
    expect(host.textContent).not.toContain("Update available: Codevo v0.2.0");
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
    expect(slots[1]?.textContent).toContain("Update available: Codevo v0.2.0");
    expect(slots[1]?.getAttribute("aria-hidden")).toBe("true");
  });

  it("surfaces a refused update as a toast and clears it with the next management toast", async () => {
    const update = vi.fn(async () => "turnActive" as const);
    const management = {
      ...providerManagement(),
      providers: providersOffering("codex", "0.150.1"),
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
        providers: providersOffering("codex", "0.150.2"),
        toast: { kind: "updateAvailable", provider: "codex", version: "0.150.2" },
      },
    });
    await waitForReact(() => {
      expect(host.textContent).not.toContain("Provider update not started");
    });
    expect(host.querySelector(".toast-update-row__to")?.textContent).toBe("v0.150.2");
  });

  it("shows the existing app update toast once when the rail refresh finds a Codevo release", async () => {
    const gateway = updaterGateway();
    gateway.check.mockResolvedValueOnce({ kind: "upToDate", currentVersion: "0.1.0" });
    await render(hostProps({ gateway }), true);
    await waitForReact(() => expect(gateway.check).toHaveBeenCalledOnce());
    await act(async () => Promise.resolve());
    expect(host.textContent).not.toContain("Update available: Codevo");

    const refresh = host.querySelector<HTMLButtonElement>('button[aria-label="Check for updates"]');
    expect(refresh).not.toBeNull();
    await act(async () => refresh?.click());

    await waitForReact(() => {
      expect(host.textContent).toContain("Update available: Codevo v0.2.0");
    });
    expect(gateway.check).toHaveBeenCalledTimes(2);
    expect(host.textContent?.split("Update available: Codevo v0.2.0")).toHaveLength(2);
    expect(host.querySelector('[data-pill="app-update"]')).toBeNull();
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

  it("keeps the settings surface unmounted until the settings route opens", async () => {
    const container = document.createElement("div");
    const props = hostProps({ gateway: updaterGateway(), settingsContainer: container });
    await render(props);

    await waitForReact(() => {
      expect(host.textContent).toContain("Update available: Codevo v0.2.0");
    });
    expect(mocks.settingsSurfaceActive.length).toBeGreaterThan(0);
    expect(mocks.settingsSurfaceActive.every((active) => !active)).toBe(true);
    expect(mocks.settingsContainers).toEqual([]);

    await render({ ...props, workbench: { ...props.workbench, settingsOpen: true } });

    expect(last(mocks.settingsSurfaceActive)).toBe(true);
    expect(last(mocks.settingsContainers)).toBe(container);
  });

  it("hands the frame settings slot to the lazily mounted settings host", async () => {
    const container = document.createElement("div");
    await render(hostProps({ settingsContainer: container, settingsOpen: true }));

    expect(last(mocks.settingsSurfaceActive)).toBe(true);
    expect(last(mocks.settingsContainers)).toBe(container);
  });

  async function render(props: HostFixture, withRailFooter = false): Promise<void> {
    await act(async () => {
      root.render(<HostHarness {...props} withRailFooter={withRailFooter} />);
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
  readonly settingsContainer?: HTMLElement | null;
  readonly settingsOpen?: boolean;
  readonly workspaceRoot?: string;
}): HostFixture {
  const composition: WorkbenchAppUpdaterComposition = {
    appUpdaterGateway: overrides.gateway ?? upToDateGateway(),
    appUpdaterPreferencesGateway: { loadSkippedVersion: async () => null },
    appVersion: "0.1.0",
  };
  return {
    composition,
    persistAppUpdaterSkippedVersion: vi.fn(async () => undefined),
    settingsContainer: overrides.settingsContainer ?? null,
    onOpenAgentSettings: overrides.configureAgentCli ?? vi.fn(),
    onOpenRuntimePanel: vi.fn(),
    providerManagement: overrides.providerManagement ?? providerManagement(),
    systemFontGateway: { listMonospaceFontFamilies: async () => [] },
    workbench: {
      appSettings: defaultAppSettings(),
      gitRepositoryMappings: [],
      installManagedPhpactor: vi.fn(),
      installingManagedPhpactor: false,
      intelligenceMode: "basic",
      notices: overrides.notices ?? [],
      openJavaScriptTypeScriptServiceLog: vi.fn(async () => undefined),
      phpTools: null,
      restartJavaScriptTypeScriptService: vi.fn(async () => undefined),
      saveWorkbenchSettings: vi.fn(async () => undefined),
      setLanguageServerSetupOpen: vi.fn(),
      settingsInitialSection: "general",
      settingsOpen: overrides.settingsOpen ?? false,
      setSettingsOpen: vi.fn(),
      workspaceDescriptor: null,
      workspaceIdentityDescriptor: null,
      workspaceRoot: overrides.workspaceRoot ?? null,
      workspaceSettings: defaultWorkspaceSettings(),
      workspaceTrust: null,
    },
    workspaceTrusted: false,
  };
}

type HostFixture = Omit<WorkbenchAppUpdaterHostProps, "appUpdater"> & {
  readonly composition: WorkbenchAppUpdaterComposition;
  readonly persistAppUpdaterSkippedVersion: (version: string) => Promise<void>;
};

function HostHarness({
  composition,
  persistAppUpdaterSkippedVersion,
  withRailFooter,
  ...props
}: HostFixture & { readonly withRailFooter: boolean }) {
  const appUpdater = useWorkbenchAppUpdaterComposition(composition, {
    persistAppUpdaterSkippedVersion,
  });
  return (
    <>
      <WorkbenchAppUpdaterHost {...props} appUpdater={appUpdater} />
      {withRailFooter ? (
        <AppUpdaterContext.Provider value={appUpdater}>
          <AgentProviderRailFooter
            management={props.providerManagement}
            onOpenSettings={vi.fn()}
            onOpenSourceControl={vi.fn()}
            providerEnabled={{ claudeCode: false, codex: false }}
          />
        </AppUpdaterContext.Provider>
      ) : null}
    </>
  );
}

function upToDateGateway(): AppUpdaterGateway {
  return {
    check: async () => ({ kind: "upToDate", currentVersion: "0.1.0" }),
    download: async () => "readyToInstall",
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
        notesSpan: { kind: "single" as const, notes: null },
      },
    })),
    download: vi.fn<AppUpdaterGateway["download"]>(async () => "readyToInstall"),
    installAndRestart: vi.fn<AppUpdaterGateway["installAndRestart"]>(async () => undefined),
    dispose: vi.fn<AppUpdaterGateway["dispose"]>(async () => undefined),
  };
}

function providersOffering(
  provider: AgentCliKind,
  availableVersion: string,
  installation: "oneClick" | "manual" = "oneClick",
): AgentProviderManagementSurface["providers"] {
  const providers = providerManagement().providers;
  const health: AgentProviderHealthState = {
    kind: "ready",
    installedVersion: "0.1.0",
    auth: { kind: "unknown" },
    update:
      installation === "manual"
        ? { kind: "manualUpdateAvailable", installedVersion: "0.1.0", availableVersion }
        : {
            kind: "available",
            installedVersion: "0.1.0",
            availableVersion,
            installer: {
              kind: "selfUpdate",
              command: provider === "codex" ? "codexUpdate" : "claudeUpdate",
            },
          },
    checkedAtEpochMs: 1,
  };
  return { ...providers, [provider]: { ...providers[provider], health } };
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
    refreshAll: async () => undefined,
    retryRegistration: async () => undefined,
    save: async () => true,
    saveWithOutcome: async () => ({ kind: "persisted", policyRegistered: false }),
    update: vi.fn(async () => null),
  };
}

function last<T>(values: ReadonlyArray<T>): T | undefined {
  return values[values.length - 1];
}
