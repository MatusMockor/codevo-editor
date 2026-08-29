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
    });
  });

  it("accepts results after the StrictMode setup cleanup cycle and disposes on unmount", async () => {
    const gateway = gatewayWithUpdate();
    function Harness() {
      surface = useAppUpdater({ currentVersion: "0.1.0", gateway });
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

  function render(gateway: AppUpdaterGateway): void {
    function Harness() {
      surface = useAppUpdater({ currentVersion: "0.1.0", gateway });
      return null;
    }
    act(() => root.render(<Harness />));
  }
});

function gatewayWithUpdate() {
  return {
    check: vi.fn(async () => ({
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
