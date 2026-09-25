// @vitest-environment jsdom

import { StrictMode, useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUpdateChannel } from "../domain/appUpdateChannel";
import type { AppUpdateCheckResult, AppUpdaterGateway } from "../domain/appUpdater";
import { TauriAppUpdaterGateway } from "../infrastructure/tauriAppUpdaterGateway";
import { useAppUpdater, type AppUpdaterSurface } from "./useAppUpdater";

describe("useAppUpdater", () => {
  let host: HTMLDivElement;
  let root: Root;
  let surface: AppUpdaterSurface | null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    surface = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it("keeps check, download, and install as separate user intents", async () => {
    const gateway = gatewayWithUpdate();
    render(gateway);

    await act(async () => surface?.check());
    expect(surface?.state.kind).toBe("available");
    expect(gateway.download).not.toHaveBeenCalled();
    expect(gateway.installAndRestart).not.toHaveBeenCalled();

    await act(async () => surface?.download());
    expect(surface?.state.kind).toBe("readyToInstall");
    expect(gateway.download).toHaveBeenCalledWith(7);
    expect(gateway.installAndRestart).not.toHaveBeenCalled();

    await act(async () => surface?.installAndRestart());
    expect(gateway.installAndRestart).toHaveBeenCalledWith(7);
  });

  it("preserves a prepared Mac update after Later and restores restart without downloading again", async () => {
    const update = {
      currentVersion: "0.1.0",
      version: "0.2.0",
      download: vi.fn(async () => undefined),
      install: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const sameVersionProbe = {
      currentVersion: "0.1.0",
      version: "0.2.0",
      download: vi.fn(async () => undefined),
      install: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const bridge = {
      getInstallMode: async () => "prepareBeforeRestart",
      check: vi.fn().mockResolvedValueOnce(update).mockResolvedValue(sameVersionProbe),
      relaunch: vi.fn(async () => undefined),
    };
    render(new TauriAppUpdaterGateway(bridge, "0.1.0"));
    await act(async () => surface?.check());
    await act(async () => surface?.download());
    expect(surface?.state.kind).toBe("readyToRestart");
    expect(update.install).toHaveBeenCalledOnce();
    expect(bridge.relaunch).not.toHaveBeenCalled();
    act(() => surface?.dismiss());
    expect(surface?.state.kind).toBe("idle");
    await act(async () => surface?.check());
    expect(surface?.state.kind).toBe("readyToRestart");
    expect(bridge.check).toHaveBeenCalledTimes(2);
    expect(sameVersionProbe.close).toHaveBeenCalledOnce();
    expect(sameVersionProbe.download).not.toHaveBeenCalled();
    expect(update.download).toHaveBeenCalledOnce();
    await act(async () => surface?.installAndRestart());
    expect(update.install).toHaveBeenCalledOnce();
    expect(bridge.relaunch).toHaveBeenCalledOnce();
  });

  it("keeps a completed installation truthful when relaunch fails", async () => {
    const gateway = gatewayWithUpdate();
    gateway.download.mockResolvedValue("readyToRestart");
    gateway.installAndRestart.mockRejectedValue(new Error("relaunch failure"));
    render(gateway);
    await act(async () => surface?.check());
    await act(async () => surface?.download());
    await act(async () => surface?.installAndRestart());
    expect(surface?.state).toMatchObject({
      kind: "failed",
      message: "The update is installed. Quit and reopen Codevo to use it.",
    });
  });

  it("checks after the UI-ready scheduler and exposes an available startup release", async () => {
    const gateway = gatewayWithUpdate();
    let start!: () => void;
    render(gateway, {
      scheduleAfterUiInteractive: (task) => {
        start = task;
        return vi.fn();
      },
    });

    await act(async () => start());

    expect(gateway.check).toHaveBeenCalledOnce();
    expect(surface?.state).toMatchObject({ kind: "available", version: "0.2.0" });
  });

  it("keeps startup up-to-date and check failures silent", async () => {
    const logStartupFailure = vi.fn();
    const upToDate = gatewayWithUpdate();
    upToDate.check.mockResolvedValue({ kind: "upToDate", currentVersion: "0.1.0" });
    let start!: () => void;
    render(upToDate, {
      logStartupFailure,
      scheduleAfterUiInteractive: (task) => {
        start = task;
        return vi.fn();
      },
    });
    await act(async () => start());
    expect(surface?.state.kind).toBe("upToDate");
    expect(logStartupFailure).not.toHaveBeenCalled();

    const failing = gatewayWithUpdate();
    failing.check.mockRejectedValue(new Error("offline endpoint"));
    render(failing, {
      logStartupFailure,
      scheduleAfterUiInteractive: (task) => {
        start = task;
        return vi.fn();
      },
    });
    await act(async () => start());
    expect(surface?.state.kind).toBe("idle");
    expect(logStartupFailure).toHaveBeenLastCalledWith(
      "Application update check failed during startup.",
    );
  });

  it("still checks when the persisted skip preference cannot be read", async () => {
    const gateway = gatewayWithUpdate();
    const preferencesGateway = preferenceGateway();
    preferencesGateway.loadSkippedVersion.mockRejectedValue(new Error("settings unavailable"));
    const logStartupFailure = vi.fn();
    let start!: () => void;
    render(gateway, {
      logStartupFailure,
      preferencesGateway,
      scheduleAfterUiInteractive: (task) => {
        start = task;
        return vi.fn();
      },
    });

    await act(async () => start());

    expect(gateway.check).toHaveBeenCalledOnce();
    expect(surface?.state.kind).toBe("available");
    expect(logStartupFailure).toHaveBeenCalledWith(
      "Application update skip preference could not be read.",
    );
  });

  it("retains release data after download failure and releases the native candidate", async () => {
    const gateway = gatewayWithUpdate();
    gateway.download.mockRejectedValue(new Error("secret download failure"));
    render(gateway);
    await act(async () => surface?.check());

    await act(async () => surface?.download());

    expect(surface?.state).toMatchObject({
      kind: "failed",
      operation: "download",
      message: "Unable to prepare the application update.",
      release: { version: "0.2.0", notesSpan: { kind: "single", notes: "Beta update" } },
    });
    expect(gateway.dispose).toHaveBeenCalledOnce();
  });

  it("retains release data after install failure and releases the native candidate", async () => {
    const gateway = gatewayWithUpdate();
    gateway.installAndRestart.mockRejectedValue(new Error("secret install failure"));
    render(gateway);
    await act(async () => surface?.check());
    await act(async () => surface?.download());

    await act(async () => surface?.installAndRestart());

    expect(surface?.state).toMatchObject({
      kind: "failed",
      operation: "installAndRestart",
      message: "Unable to install the application update.",
      release: { version: "0.2.0" },
    });
    expect(gateway.dispose).toHaveBeenCalledOnce();
  });

  it("persists skip-this-version and suppresses only that startup candidate", async () => {
    const gateway = gatewayWithUpdate();
    const preferences = preferenceGateway();
    const persistSkippedVersion = vi.fn(async () => undefined);
    let start!: () => void;
    render(gateway, {
      preferencesGateway: preferences,
      persistSkippedVersion,
      scheduleAfterUiInteractive: (task) => {
        start = task;
        return vi.fn();
      },
    });
    await act(async () => start());
    await act(async () => surface?.skipVersion());
    expect(persistSkippedVersion).toHaveBeenCalledWith("0.2.0");
    expect(surface?.state.kind).toBe("idle");

    preferences.loadSkippedVersion.mockResolvedValue("0.2.0");
    render(gateway, {
      preferencesGateway: preferences,
      scheduleAfterUiInteractive: (task) => {
        start = task;
        return vi.fn();
      },
    });
    await act(async () => start());
    expect(surface?.state.kind).toBe("idle");
  });

  it("drops a stale check completion after the gateway owner changes", async () => {
    let settle!: (value: Awaited<ReturnType<AppUpdaterGateway["check"]>>) => void;
    const first: AppUpdaterGateway = {
      check: vi.fn(
        (): ReturnType<AppUpdaterGateway["check"]> =>
          new Promise((resolve) => {
            settle = resolve;
          }),
      ),
      download: vi.fn(),
      installAndRestart: vi.fn(),
      dispose: vi.fn(async () => undefined),
    };
    const second: AppUpdaterGateway = {
      check: vi.fn(async () => ({ kind: "upToDate", currentVersion: "0.1.0" }) as const),
      download: vi.fn(),
      installAndRestart: vi.fn(),
      dispose: vi.fn(async () => undefined),
    };
    render(first);
    let pending: Promise<void> | undefined;
    act(() => {
      pending = surface?.check();
    });
    render(second);
    settle({ kind: "upToDate", currentVersion: "0.1.0" });
    await act(async () => pending);

    expect(surface?.state.kind).toBe("idle");
  });

  it("publishes bounded fixed failures without leaking gateway details", async () => {
    const gateway = gatewayWithUpdate();
    gateway.check.mockRejectedValue(new Error("secret endpoint and signature"));
    render(gateway);

    await act(async () => surface?.check());

    expect(surface?.state).toEqual({
      kind: "failed",
      currentVersion: "0.1.0",
      operation: "check",
      message: "Unable to check for application updates.",
      release: null,
    });
  });

  it("accepts results after the StrictMode setup cleanup cycle and disposes on unmount", async () => {
    const gateway = gatewayWithUpdate();
    const preferencesGateway = preferenceGateway();
    function Harness() {
      surface = useAppUpdater({
        channel: "beta",
        currentVersion: "0.1.0",
        gateway,
        preferencesGateway,
        persistSkippedVersion: vi.fn(async () => undefined),
        scheduleAfterUiInteractive: neverSchedule,
        settingsHydrated: true,
      });
      return null;
    }
    act(() =>
      root.render(
        <StrictMode>
          <Harness />
        </StrictMode>,
      ),
    );
    await act(async () => surface?.check());
    expect(surface?.state.kind).toBe("available");
    const disposeCallsBeforeUnmount = gateway.dispose.mock.calls.length;
    act(() => root.unmount());
    expect(gateway.dispose).toHaveBeenCalledTimes(disposeCallsBeforeUnmount + 1);
    root = createRoot(host);
  });

  it("checks on the selected channel and drops a check that settles after the channel changed", async () => {
    const gateway = gatewayWithUpdate();
    const control: { settle: ((result: AppUpdateCheckResult) => void) | null } = { settle: null };
    gateway.check.mockImplementationOnce(
      () =>
        new Promise<AppUpdateCheckResult>((resolve) => {
          control.settle = resolve;
        }),
    );
    const selector = renderWithChannelSelector(gateway);

    let firstCheck: Promise<void> | undefined;
    act(() => {
      firstCheck = surface?.check();
    });
    expect(gateway.check).toHaveBeenLastCalledWith("beta");

    act(() => selector.set?.("stable"));
    expect(surface?.state.kind).toBe("idle");
    expect(gateway.dispose).toHaveBeenCalled();

    await act(async () => {
      control.settle?.({
        kind: "available",
        candidate: {
          candidateRevision: 1,
          currentVersion: "0.1.0",
          version: "0.1.1-beta.1",
          date: null,
          notesSpan: { kind: "single", notes: "Beta" },
        },
      });
      await firstCheck;
    });
    expect(surface?.state.kind).toBe("idle");

    await act(async () => surface?.check());
    expect(gateway.check).toHaveBeenLastCalledWith("stable");
    expect(surface?.state.kind).toBe("available");
  });

  it("disposes a downloaded candidate when the channel changes and checks the new channel next", async () => {
    const gateway = gatewayWithUpdate();
    const selector = renderWithChannelSelector(gateway);
    await act(async () => surface?.check());
    await act(async () => surface?.download());
    expect(surface?.state.kind).toBe("readyToInstall");
    const disposeCallsBeforeSwitch = gateway.dispose.mock.calls.length;

    act(() => selector.set?.("stable"));

    expect(surface?.state.kind).toBe("idle");
    expect(gateway.dispose).toHaveBeenCalledTimes(disposeCallsBeforeSwitch + 1);
    await act(async () => surface?.installAndRestart());
    expect(gateway.installAndRestart).not.toHaveBeenCalled();
    await act(async () => surface?.check());
    expect(gateway.check).toHaveBeenLastCalledWith("stable");
  });

  it("reports a channel without any release as a distinct state on a manual check", async () => {
    const gateway = gatewayWithUpdate();
    gateway.check.mockResolvedValue({
      kind: "noRelease",
      currentVersion: "0.1.0",
      channel: "stable",
    });
    render(gateway, { channel: "stable" });

    await act(async () => surface?.check());

    expect(gateway.check).toHaveBeenCalledWith("stable");
    expect(surface?.state).toEqual({
      kind: "noRelease",
      currentVersion: "0.1.0",
      channel: "stable",
    });
    await act(async () => surface?.download());
    expect(gateway.download).not.toHaveBeenCalled();
  });

  it("keeps a startup check without any channel release silent and does not retry it", async () => {
    const gateway = gatewayWithUpdate();
    gateway.check.mockResolvedValue({
      kind: "noRelease",
      currentVersion: "0.1.0",
      channel: "stable",
    });
    const logStartupFailure = vi.fn();
    let start!: () => void;
    render(gateway, {
      channel: "stable",
      logStartupFailure,
      scheduleAfterUiInteractive: (task) => {
        start = task;
        return vi.fn();
      },
    });

    await act(async () => start());

    expect(surface?.state.kind).toBe("noRelease");
    expect(gateway.check).toHaveBeenCalledOnce();
    expect(logStartupFailure).not.toHaveBeenCalled();
  });

  it("defers the startup check until settings hydrate and checks the hydrated stable channel once", async () => {
    const gateway = gatewayWithUpdate();
    const scheduler = recordingScheduler();
    const control = renderWithHydration(gateway, scheduler.schedule);

    await act(async () => scheduler.runAll());
    expect(scheduler.tasks).toHaveLength(0);
    expect(gateway.check).not.toHaveBeenCalled();
    expect(surface?.state.kind).toBe("idle");

    act(() => control.set?.({ channel: "stable", hydrated: true }));
    await act(async () => scheduler.runAll());
    act(() => control.set?.({ channel: "stable", hydrated: true }));
    await act(async () => scheduler.runAll());

    expect(gateway.check).toHaveBeenCalledOnce();
    expect(gateway.check).toHaveBeenCalledWith("stable");
    expect(surface?.state).toMatchObject({ kind: "available", version: "0.2.0" });
  });

  it("runs exactly one startup check on the default beta channel after hydration", async () => {
    const gateway = gatewayWithUpdate();
    const scheduler = recordingScheduler();
    const control = renderWithHydration(gateway, scheduler.schedule);

    act(() => control.set?.({ channel: "beta", hydrated: true }));
    await act(async () => scheduler.runAll());
    await act(async () => scheduler.runAll());

    expect(gateway.check).toHaveBeenCalledOnce();
    expect(gateway.check).toHaveBeenCalledWith("beta");
  });

  function renderWithHydration(
    gateway: AppUpdaterGateway,
    scheduleAfterUiInteractive: (task: () => void) => () => void,
  ): { set: ((next: HydrationState) => void) | null } {
    const preferencesGateway = preferenceGateway();
    const persistSkippedVersion = vi.fn(async () => undefined);
    const control: { set: ((next: HydrationState) => void) | null } = { set: null };
    function HydrationHarness() {
      const [hydration, setHydration] = useState<HydrationState>({
        channel: "beta",
        hydrated: false,
      });
      control.set = setHydration;
      surface = useAppUpdater({
        channel: hydration.channel,
        currentVersion: "0.1.0",
        gateway,
        persistSkippedVersion,
        preferencesGateway,
        scheduleAfterUiInteractive,
        settingsHydrated: hydration.hydrated,
      });
      return null;
    }
    act(() => root.render(<HydrationHarness />));
    return control;
  }

  function renderWithChannelSelector(gateway: AppUpdaterGateway): {
    set: ((channel: AppUpdateChannel) => void) | null;
  } {
    const preferencesGateway = preferenceGateway();
    const persistSkippedVersion = vi.fn(async () => undefined);
    const selector: { set: ((channel: AppUpdateChannel) => void) | null } = { set: null };
    function ChannelHarness() {
      const [channel, setChannel] = useState<AppUpdateChannel>("beta");
      selector.set = setChannel;
      surface = useAppUpdater({
        channel,
        currentVersion: "0.1.0",
        gateway,
        persistSkippedVersion,
        preferencesGateway,
        scheduleAfterUiInteractive: neverSchedule,
        settingsHydrated: true,
      });
      return null;
    }
    act(() => root.render(<ChannelHarness />));
    return selector;
  }

  function render(
    gateway: AppUpdaterGateway,
    overrides: Partial<Parameters<typeof useAppUpdater>[0]> = {},
  ): void {
    const preferencesGateway = overrides.preferencesGateway ?? preferenceGateway();
    function Harness() {
      surface = useAppUpdater({
        channel: "beta",
        currentVersion: "0.1.0",
        gateway,
        preferencesGateway,
        persistSkippedVersion: vi.fn(async () => undefined),
        scheduleAfterUiInteractive: neverSchedule,
        settingsHydrated: true,
        ...overrides,
      });
      return null;
    }
    act(() => root.render(<Harness />));
  }
});

function gatewayWithUpdate() {
  return {
    check: vi.fn<AppUpdaterGateway["check"]>(async () => ({
      kind: "available" as const,
      candidate: {
        candidateRevision: 7,
        currentVersion: "0.1.0",
        version: "0.2.0",
        date: "2026-08-29T12:00:00Z",
        notesSpan: { kind: "single" as const, notes: "Beta update" },
      },
    })),
    download: vi.fn<AppUpdaterGateway["download"]>(async () => "readyToInstall"),
    installAndRestart: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
}

const neverSchedule = () => () => undefined;

interface HydrationState {
  readonly channel: AppUpdateChannel;
  readonly hydrated: boolean;
}

function recordingScheduler() {
  const tasks: Array<() => void> = [];
  return {
    tasks,
    schedule(task: () => void): () => void {
      tasks.push(task);
      return () => {
        const index = tasks.indexOf(task);
        if (index >= 0) tasks.splice(index, 1);
      };
    },
    runAll(): void {
      for (const task of tasks.splice(0)) task();
    },
  };
}

function preferenceGateway() {
  return {
    loadSkippedVersion: vi.fn(async () => null as string | null),
  };
}
