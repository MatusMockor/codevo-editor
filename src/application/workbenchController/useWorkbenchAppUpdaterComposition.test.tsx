// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
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
      download: vi.fn(async () => undefined),
      installAndRestart: vi.fn(async () => undefined),
    };
    let updater: AppUpdaterSurface | undefined;
    const host = document.createElement("div");
    const root = createRoot(host);

    function Probe() {
      updater = useWorkbenchAppUpdaterComposition({
        appUpdaterGateway: gateway,
        appVersion: "0.2.0-beta.1",
      });
      return null;
    }

    act(() => root.render(<Probe />));
    await act(async () => readUpdater(updater).check());
    await waitForReact(() => expect(readUpdater(updater).state.kind).toBe("upToDate"));
    expect(readUpdater(updater).state.currentVersion).toBe("0.2.0-beta.1");
    expect(gateway.check).toHaveBeenCalledOnce();

    act(() => root.unmount());
    expect(gateway.dispose).toHaveBeenCalledOnce();
  });
});

function readUpdater(updater: AppUpdaterSurface | undefined): AppUpdaterSurface {
  if (updater === undefined) throw new Error("Updater composition did not render.");
  return updater;
}
