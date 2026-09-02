// @vitest-environment jsdom

import { StrictMode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUpdaterGateway } from "../domain/appUpdater";
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
      message: "Unable to download the application update.",
      release: { version: "0.2.0", notes: "Beta update" },
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
        currentVersion: "0.1.0",
        gateway,
        preferencesGateway,
        persistSkippedVersion: vi.fn(async () => undefined),
        scheduleAfterUiInteractive: neverSchedule,
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

  function render(
    gateway: AppUpdaterGateway,
    overrides: Partial<Parameters<typeof useAppUpdater>[0]> = {},
  ): void {
    const preferencesGateway = overrides.preferencesGateway ?? preferenceGateway();
    function Harness() {
      surface = useAppUpdater({
        currentVersion: "0.1.0",
        gateway,
        preferencesGateway,
        persistSkippedVersion: vi.fn(async () => undefined),
        scheduleAfterUiInteractive: neverSchedule,
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
        notes: "Beta update",
      },
    })),
    download: vi.fn(async () => undefined),
    installAndRestart: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
}

const neverSchedule = () => () => undefined;

function preferenceGateway() {
  return {
    loadSkippedVersion: vi.fn(async () => null as string | null),
  };
}
