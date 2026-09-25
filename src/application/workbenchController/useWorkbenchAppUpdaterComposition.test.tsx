// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { AppUpdateChannel } from "../../domain/appUpdateChannel";
import type { AppUpdaterGateway } from "../../domain/appUpdater";
import type { AppUpdaterSurface } from "../useAppUpdater";
import { waitForReact } from "../../test/reactTestLifecycle";
import { useWorkbenchAppUpdaterComposition } from "./useWorkbenchAppUpdaterComposition";

describe("useWorkbenchAppUpdaterComposition", () => {
  it("binds the package version and required updater gateway into one owned surface", async () => {
    const gateway: AppUpdaterGateway = {
      check: vi.fn<AppUpdaterGateway["check"]>(async () => ({
        kind: "upToDate",
        currentVersion: "0.2.0-beta.1",
      })),
      dispose: vi.fn(async () => undefined),
      download: vi.fn(async () => "readyToInstall" as const),
      installAndRestart: vi.fn(async () => undefined),
    };
    let updater: AppUpdaterSurface | undefined;
    const appUpdaterPreferencesGateway = {
      loadSkippedVersion: vi.fn(async () => null),
    };
    const host = document.createElement("div");
    const root = createRoot(host);

    function Probe() {
      updater = useWorkbenchAppUpdaterComposition(
        {
          appUpdaterGateway: gateway,
          appUpdaterPreferencesGateway,
          appVersion: "0.2.0-beta.1",
        },
        vi.fn(async () => undefined),
        "beta",
        true,
      );
      return null;
    }

    act(() => root.render(<Probe />));
    await waitForReact(() => expect(readUpdater(updater).state.kind).toBe("upToDate"));
    expect(readUpdater(updater).state.currentVersion).toBe("0.2.0-beta.1");
    expect(gateway.check).toHaveBeenCalledOnce();

    act(() => root.unmount());
    expect(gateway.dispose).toHaveBeenCalledOnce();
  });
});

describe("useWorkbenchAppUpdaterComposition startup hydration", () => {
  it("waits for app settings hydration and checks only the hydrated stable channel", async () => {
    const gateway: AppUpdaterGateway = {
      check: vi.fn<AppUpdaterGateway["check"]>(async () => ({
        kind: "upToDate",
        currentVersion: "0.2.0",
      })),
      dispose: vi.fn(async () => undefined),
      download: vi.fn(async () => "readyToInstall" as const),
      installAndRestart: vi.fn(async () => undefined),
    };
    const composition = {
      appUpdaterGateway: gateway,
      appUpdaterPreferencesGateway: { loadSkippedVersion: vi.fn(async () => null) },
      appVersion: "0.2.0",
    };
    const persistSkippedVersion = vi.fn(async () => undefined);
    let updater: AppUpdaterSurface | undefined;
    const host = document.createElement("div");
    const root = createRoot(host);

    function Probe({
      channel,
      hydrated,
    }: {
      readonly channel: AppUpdateChannel;
      readonly hydrated: boolean;
    }) {
      updater = useWorkbenchAppUpdaterComposition(
        composition,
        persistSkippedVersion,
        channel,
        hydrated,
      );
      return null;
    }

    act(() => root.render(<Probe channel="beta" hydrated={false} />));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(gateway.check).not.toHaveBeenCalled();
    expect(readUpdater(updater).state.kind).toBe("idle");

    act(() => root.render(<Probe channel="stable" hydrated />));
    await waitForReact(() => expect(readUpdater(updater).state.kind).toBe("upToDate"));
    expect(gateway.check).toHaveBeenCalledOnce();
    expect(gateway.check).toHaveBeenCalledWith("stable");

    act(() => root.unmount());
  });
});

function readUpdater(updater: AppUpdaterSurface | undefined): AppUpdaterSurface {
  if (updater === undefined) throw new Error("Updater composition did not render.");
  return updater;
}
