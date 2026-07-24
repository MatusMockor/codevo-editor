// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  NodePackageScriptsGateway,
  NodePackageScriptsResult,
} from "../domain/nodePackageScripts";
import { useNodePackageScripts } from "./useNodePackageScripts";

describe("useNodePackageScripts", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: ReturnType<typeof useNodePackageScripts>;

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

  it("loads a bounded snapshot and refreshes when discovery is invalidated", async () => {
    const gateway = createGateway();
    let invalidate!: () => void;
    await render(gateway, (controls) => ({ invalidate: (invalidate = controls.invalidate) }));

    expect(gateway.listNodePackageScripts).toHaveBeenCalledWith("/workspace-1", {
      maxManifests: 2_000,
      maxScripts: 20_000,
      maxVisited: 100_000,
    });
    expect(latest).toMatchObject({
      error: null,
      loading: false,
      total: 1,
      truncated: true,
      visited: 12,
    });
    expect(latest.scripts[0]?.scriptName).toBe("build");

    await act(async () => invalidate());
    expect(gateway.listNodePackageScripts).toHaveBeenCalledTimes(2);
  });

  it("reports current failures without discarding the previous complete snapshot", async () => {
    const gateway = createGateway();
    await render(gateway);
    vi.mocked(gateway.listNodePackageScripts).mockRejectedValueOnce(new Error("native closed"));

    await act(async () => void (await latest.refresh()));

    expect(latest.loading).toBe(false);
    expect(latest.error).toBe("native closed");
    expect(latest.scripts).toHaveLength(1);
  });

  it("drops stale responses after a root switch and does not expose the old owner", async () => {
    let resolveOld!: (result: NodePackageScriptsResult) => void;
    const gateway = createGateway();
    vi.mocked(gateway.listNodePackageScripts).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );
    let switchOwner!: () => void;
    await render(gateway, (controls) => ({ switchOwner: (switchOwner = controls.switchOwner) }));

    await act(async () => switchOwner());
    expect(latest.scripts[0]?.packageName).toBe("demo");
    await act(async () => resolveOld(snapshot("stale")));

    expect(latest.scripts[0]?.packageName).toBe("demo");
    expect(gateway.listNodePackageScripts).toHaveBeenLastCalledWith(
      "/workspace-2",
      expect.anything(),
    );
  });

  it("invalidates an older request generation when a newer refresh wins", async () => {
    let resolveOld!: (result: NodePackageScriptsResult) => void;
    const gateway = createGateway();
    vi.mocked(gateway.listNodePackageScripts).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );
    await render(gateway);

    await act(async () => void (await latest.refresh()));
    expect(latest.scripts[0]?.packageName).toBe("demo");
    await act(async () => resolveOld(snapshot("stale")));
    expect(latest.scripts[0]?.packageName).toBe("demo");
  });

  it("clears visible state while disabled and ignores in-flight completion", async () => {
    let resolve!: (result: NodePackageScriptsResult) => void;
    const gateway = createGateway();
    vi.mocked(gateway.listNodePackageScripts).mockReturnValueOnce(
      new Promise((settle) => {
        resolve = settle;
      }),
    );
    let setEnabled!: (enabled: boolean) => void;
    await render(gateway, (controls) => ({ setEnabled: (setEnabled = controls.setEnabled) }));

    await act(async () => setEnabled(false));
    expect(latest).toMatchObject({ loading: false, scripts: [], total: 0 });
    await act(async () => resolve(snapshot("stale")));
    expect(latest.scripts).toEqual([]);
  });

  it("does not update state after unmount", async () => {
    let resolve!: (result: NodePackageScriptsResult) => void;
    const gateway = createGateway();
    vi.mocked(gateway.listNodePackageScripts).mockReturnValueOnce(
      new Promise((settle) => {
        resolve = settle;
      }),
    );
    await render(gateway);
    act(() => root.unmount());
    await act(async () => resolve(snapshot("late")));
  });

  async function render(
    gateway: NodePackageScriptsGateway,
    capture: (controls: Controls) => unknown = () => undefined,
  ): Promise<void> {
    await act(async () => {
      root.render(
        <Harness
          gateway={gateway}
          onReady={(state, controls) => {
            latest = state;
            capture(controls);
          }}
        />,
      );
    });
  }
});

interface Controls {
  readonly invalidate: () => void;
  readonly setEnabled: (enabled: boolean) => void;
  readonly switchOwner: () => void;
}

function Harness({
  gateway,
  onReady,
}: {
  gateway: NodePackageScriptsGateway;
  onReady: (state: ReturnType<typeof useNodePackageScripts>, controls: Controls) => void;
}) {
  const [owner, setOwner] = useState(1);
  const [enabled, setEnabled] = useState(true);
  const [discoveryVersion, setDiscoveryVersion] = useState(0);
  const state = useNodePackageScripts({
    discoveryEnabled: enabled,
    discoveryVersion,
    gateway,
    rootPath: `/workspace-${owner}`,
    workspaceId: `workspace-${owner}`,
  });
  onReady(state, {
    invalidate: () => setDiscoveryVersion((current) => current + 1),
    setEnabled,
    switchOwner: () => setOwner((current) => current + 1),
  });
  return null;
}

function createGateway(): NodePackageScriptsGateway {
  return { listNodePackageScripts: vi.fn(async () => snapshot("demo")) };
}

function snapshot(packageName: string): NodePackageScriptsResult {
  return {
    scripts: [
      {
        key: "node-package-script:package.json:build",
        manifestRelativePath: "package.json",
        packageName,
        packageManager: "npm",
        packageRootRelativePath: "",
        scriptName: "build",
      },
    ],
    total: 1,
    truncated: true,
    visited: 12,
  };
}
