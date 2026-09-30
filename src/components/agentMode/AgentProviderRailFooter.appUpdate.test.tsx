// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import { useAppUpdater, type AppUpdaterSurface } from "../../application/useAppUpdater";
import { APP_UPDATE_CHECK_STATUS_MS } from "../../application/useCombinedUpdateCheck";
import type { AppUpdateCheckResult, AppUpdaterGateway } from "../../domain/appUpdater";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { AppUpdaterContext } from "../appUpdaterContext";
import { AgentProviderRailFooter } from "./AgentProviderRailFooter";

const UP_TO_DATE: AppUpdateCheckResult = { kind: "upToDate", currentVersion: "0.1.0" };
const AVAILABLE: AppUpdateCheckResult = {
  kind: "available",
  candidate: {
    candidateRevision: 1,
    currentVersion: "0.1.0",
    version: "0.2.0",
    date: null,
    notesSpan: { kind: "single", notes: null },
  },
};

const PREFERENCES = { loadSkippedVersion: async () => null };
const persistNothing = async (): Promise<void> => undefined;
const neverSchedule = (): (() => void) => () => undefined;

describe("AgentProviderRailFooter app update check", () => {
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
    vi.useRealTimers();
  });

  it("checks the provider CLIs and Codevo itself from the one refresh button", async () => {
    const gateway = fakeGateway(async () => UP_TO_DATE);
    const management = providers();
    render(management, gateway);

    const refresh = button("Check for updates");
    expect(refresh.title).toBe("Check for Codevo and CLI updates");
    await act(async () => refresh.click());

    expect(management.refreshAll).toHaveBeenCalledOnce();
    expect(gateway.check).toHaveBeenCalledOnce();
  });

  it("checks Codevo even when every provider is disabled", async () => {
    const gateway = fakeGateway(async () => UP_TO_DATE);
    const management = providers();
    render(management, gateway, { claudeCode: false, codex: false });

    const refresh = button("Check for updates");
    expect(refresh.disabled).toBe(false);
    expect(refresh.title).toBe("Check for Codevo updates");
    await act(async () => refresh.click());

    expect(management.refreshAll).not.toHaveBeenCalled();
    expect(gateway.check).toHaveBeenCalledOnce();
  });

  it("stays busy until the Codevo check settles", async () => {
    let resolve: (result: AppUpdateCheckResult) => void = () => undefined;
    const gateway = fakeGateway(
      () =>
        new Promise<AppUpdateCheckResult>((settle) => {
          resolve = settle;
        }),
    );
    render(providers(), gateway);

    await act(async () => button("Check for updates").click());
    expect(button("Check for updates").disabled).toBe(true);
    expect(button("Check for updates").getAttribute("aria-busy")).toBe("true");
    expect(button("Check for updates").title).toBe("Checking for updates…");
    expect(appStatus()).toBeNull();

    await act(async () => resolve(UP_TO_DATE));

    expect(button("Check for updates").disabled).toBe(false);
    expect(button("Check for updates").getAttribute("aria-busy")).toBe("false");
  });

  it("reports an up-to-date Codevo briefly after a manual check", async () => {
    vi.useFakeTimers();
    render(
      providers(),
      fakeGateway(async () => UP_TO_DATE),
    );

    const region = liveRegion();
    expect(region?.getAttribute("role")).toBe("status");
    expect(region?.childElementCount).toBe(0);

    await act(async () => button("Check for updates").click());

    const status = appStatus();
    expect(liveRegion()).toBe(region);
    expect(region?.contains(status)).toBe(true);
    expect(status?.hasAttribute("role")).toBe(false);
    expect(status?.classList.contains("agent-provider-footer__pill--success")).toBe(true);
    expect(label(status)).toBe("Codevo is up to date");
    expect(status?.title).toBe("Codevo 0.1.0 is the latest release.");

    act(() => vi.advanceTimersByTime(APP_UPDATE_CHECK_STATUS_MS));
    expect(appStatus()).toBeNull();
    expect(liveRegion()).toBe(region);
    expect(region?.childElementCount).toBe(0);
  });

  it("reports a failed Codevo check with its reason until the next check", async () => {
    let result: () => Promise<AppUpdateCheckResult> = async () => Promise.reject("offline");
    render(
      providers(),
      fakeGateway(() => result()),
    );

    await act(async () => button("Check for updates").click());

    const status = appStatus();
    expect(status?.classList.contains("agent-provider-footer__pill--danger")).toBe(true);
    expect(label(status)).toBe("Update server unreachable");
    expect(status?.title).toBe(
      "Unable to check for Codevo updates: the update server could not be reached.",
    );
    expect(status?.tagName).toBe("SPAN");
    expect(status?.querySelector("svg.lucide-triangle-alert")).not.toBeNull();
    expect(status?.querySelector("svg.lucide-refresh-cw, svg.lucide-rotate-cw")).toBeNull();

    result = async () => UP_TO_DATE;
    await act(async () => button("Check for updates").click());
    expect(label(appStatus())).toBe("Codevo is up to date");
  });

  it("leaves an available Codevo release to the app update toast instead of a footer pill", async () => {
    render(
      providers(),
      fakeGateway(async () => AVAILABLE),
    );

    await act(async () => button("Check for updates").click());

    expect(appStatus()).toBeNull();
    expect(host.textContent).not.toContain("0.2.0");
  });

  it("does not restart a Codevo release flow that is already offered", async () => {
    const gateway = fakeGateway(async () => AVAILABLE);
    const management = providers();
    render(management, gateway);
    await act(async () => button("Check for updates").click());
    expect(gateway.check).toHaveBeenCalledOnce();

    await act(async () => button("Check for updates").click());

    expect(management.refreshAll).toHaveBeenCalledTimes(2);
    expect(gateway.check).toHaveBeenCalledOnce();
  });

  it("disables the refresh with the reason when only an in-progress Codevo release could be checked", async () => {
    const gateway = fakeGateway(async () => AVAILABLE);
    render(providers(), gateway, { claudeCode: false, codex: false });
    await act(async () => button("Check for updates").click());
    expect(gateway.check).toHaveBeenCalledOnce();

    expect(button("Check for updates").disabled).toBe(true);
    expect(button("Check for updates").title).toBe("Codevo 0.2.0 is already available.");
  });

  it("never re-checks Codevo while its update is downloading or ready to restart", async () => {
    let prepared: (preparation: "readyToRestart") => void = () => undefined;
    const gateway = fakeGateway(async () => AVAILABLE);
    gateway.download.mockImplementation(
      () =>
        new Promise((settle) => {
          prepared = settle;
        }),
    );
    const management = providers();
    render(management, gateway);
    await act(async () => button("Check for updates").click());

    act(() => void harnessUpdater.current?.download());
    expect(harnessUpdater.current?.state.kind).toBe("downloading");
    expect(button("Check for updates").title).toBe("Check CLI updates");
    await act(async () => button("Check for updates").click());
    expect(management.refreshAll).toHaveBeenCalledTimes(2);
    expect(gateway.check).toHaveBeenCalledOnce();

    await act(async () => prepared("readyToRestart"));
    expect(harnessUpdater.current?.state.kind).toBe("readyToRestart");
    await act(async () => button("Check for updates").click());
    expect(management.refreshAll).toHaveBeenCalledTimes(3);
    expect(gateway.check).toHaveBeenCalledOnce();
    expect(appStatus()).toBeNull();

    render(management, gateway, { claudeCode: false, codex: false });
    expect(button("Check for updates").disabled).toBe(true);
    expect(button("Check for updates").title).toBe("Codevo 0.2.0 is ready to restart.");
  });

  it("settles a check that is still pending when the footer unmounts without errors", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let resolve: (result: AppUpdateCheckResult) => void = () => undefined;
    let releaseProviders: () => void = () => undefined;
    const management = {
      ...providers(),
      refreshAll: vi.fn(
        () =>
          new Promise<void>((settle) => {
            releaseProviders = settle;
          }),
      ),
    };
    render(
      management,
      fakeGateway(
        () =>
          new Promise<AppUpdateCheckResult>((settle) => {
            resolve = settle;
          }),
      ),
    );
    await act(async () => button("Check for updates").click());
    expect(button("Check for updates").disabled).toBe(true);

    act(() => root.render(null));
    await act(async () => {
      resolve(UP_TO_DATE);
      releaseProviders();
    });

    expect(host.childElementCount).toBe(0);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("keeps the CLI-only check when no Codevo updater is wired", async () => {
    const management = providers();
    render(management, null);

    expect(button("Check for updates").title).toBe("Check CLI updates");
    await act(async () => button("Check for updates").click());
    expect(management.refreshAll).toHaveBeenCalledOnce();
    expect(appStatus()).toBeNull();
  });

  function render(
    management: AgentProviderManagementSurface,
    gateway: AppUpdaterGateway | null,
    providerEnabled = { claudeCode: true, codex: false },
  ): void {
    act(() =>
      root.render(
        gateway === null ? (
          <AgentProviderRailFooter
            management={management}
            onOpenSettings={vi.fn()}
            onOpenSourceControl={vi.fn()}
            providerEnabled={providerEnabled}
          />
        ) : (
          <UpdaterHarness
            gateway={gateway}
            management={management}
            providerEnabled={providerEnabled}
          />
        ),
      ),
    );
  }

  function button(name: string): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
    expect(element).not.toBeNull();
    return element ?? document.createElement("button");
  }

  function appStatus(): HTMLElement | null {
    return host.querySelector<HTMLElement>('[data-pill="app-update"]');
  }

  function liveRegion(): HTMLElement | null {
    return host.querySelector<HTMLElement>(".agent-provider-footer__app-status");
  }
});

const harnessUpdater: { current: AppUpdaterSurface | null } = { current: null };

function UpdaterHarness({
  gateway,
  management,
  providerEnabled,
}: {
  readonly gateway: AppUpdaterGateway;
  readonly management: AgentProviderManagementSurface;
  readonly providerEnabled: { readonly claudeCode: boolean; readonly codex: boolean };
}) {
  const updater = useAppUpdater({
    currentVersion: "0.1.0",
    gateway,
    preferencesGateway: PREFERENCES,
    persistSkippedVersion: persistNothing,
    scheduleAfterUiInteractive: neverSchedule,
  });
  harnessUpdater.current = updater;
  return (
    <AppUpdaterContext.Provider value={updater}>
      <AgentProviderRailFooter
        management={management}
        onOpenSettings={vi.fn()}
        onOpenSourceControl={vi.fn()}
        providerEnabled={providerEnabled}
      />
    </AppUpdaterContext.Provider>
  );
}

function providers(): AgentProviderManagementSurface & {
  readonly refreshAll: ReturnType<typeof vi.fn<() => Promise<void>>>;
} {
  return { ...unconfiguredAgentProviderManagement(), refreshAll: vi.fn(async () => undefined) };
}

function fakeGateway(check: () => Promise<AppUpdateCheckResult>): AppUpdaterGateway & {
  readonly check: ReturnType<typeof vi.fn<AppUpdaterGateway["check"]>>;
  readonly download: ReturnType<typeof vi.fn<AppUpdaterGateway["download"]>>;
} {
  return {
    check: vi.fn<AppUpdaterGateway["check"]>(check),
    dispose: async () => undefined,
    download: vi.fn<AppUpdaterGateway["download"]>(async () => "readyToInstall"),
    installAndRestart: async () => undefined,
  };
}

function label(element: HTMLElement | null): string {
  return element?.querySelector(".agent-provider-footer__pill-label")?.textContent ?? "";
}
