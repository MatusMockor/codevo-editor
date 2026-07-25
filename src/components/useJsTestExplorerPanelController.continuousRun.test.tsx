// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JsTestWatchGateway } from "../domain/jsTestCommand";
import type { WorkspaceTestDiscoveryGateway } from "../domain/jsTestDiscovery";
import { useJsTestExplorerPanelController } from "./useJsTestExplorerPanelController";

describe("useJsTestExplorerPanelController native continuous run", () => {
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

  it("keeps native continuous run enabled when rediscovery derives the same command", async () => {
    const discoveryGateway = mutableRunnerDiscoveryGateway();
    const watchGateway = watchGatewayFake();
    const harness = await renderController(root, discoveryGateway.gateway, watchGateway.gateway);

    await waitForReact(() => expect(harness.current().canStartContinuousRun).toBe(true));
    act(() => harness.current().onStartContinuousRun());
    await waitForReact(() => expect(watchGateway.startWatch).toHaveBeenCalledOnce());
    await waitForReact(() => expect(harness.current().continuousRunEnabled).toBe(true));

    await harness.setDiscoveryVersion(1);
    await waitForReact(() =>
      expect(discoveryGateway.completedDetections()).toBeGreaterThanOrEqual(2),
    );

    expect(watchGateway.stopWatch).not.toHaveBeenCalled();
    expect(harness.current().continuousRunEnabled).toBe(true);
  });

  it("replaces native watch exactly once when rediscovery derives a different command", async () => {
    const discoveryGateway = mutableRunnerDiscoveryGateway();
    const watchGateway = watchGatewayFake();
    const harness = await renderController(root, discoveryGateway.gateway, watchGateway.gateway);

    await waitForReact(() => expect(harness.current().canStartContinuousRun).toBe(true));
    act(() => harness.current().onStartContinuousRun());
    await waitForReact(() => expect(watchGateway.startWatch).toHaveBeenCalledOnce());

    discoveryGateway.useJest();
    await harness.setDiscoveryVersion(1);
    await waitForReact(() => expect(watchGateway.stopWatch).toHaveBeenCalledOnce());
    await waitForReact(() => expect(harness.current().canStartContinuousRun).toBe(true));

    act(() => harness.current().onStartContinuousRun());
    await waitForReact(() => expect(watchGateway.startWatch).toHaveBeenCalledTimes(2));

    expect(watchGateway.stopWatch).toHaveBeenCalledOnce();
    expect(watchGateway.startWatch.mock.calls.map(([request]) => request.command.kind)).toEqual([
      "vitest-watch",
      "jest-watch",
    ]);
    expect(harness.current().continuousRunEnabled).toBe(true);
  });

  it("does not expose a retained command after the workspace authority changes", async () => {
    const workspaceBDetection = deferred<{
      readonly content: string;
      readonly status: "ok";
    }>();
    const discoveryGateway: WorkspaceTestDiscoveryGateway = {
      enumerateJsTestFiles: async () => ({ files: [], truncated: false, visited: 0 }),
      readTextFileBounded: async (rootPath, relativePath) => {
        if (rootPath === "/workspace-a" && relativePath === "vitest.config.ts") {
          return { content: "export default {}", status: "ok" };
        }
        if (rootPath === "/workspace-b" && relativePath === "vitest.config.ts") {
          return workspaceBDetection.promise;
        }
        return { status: "tooLarge" };
      },
    };
    const watchGateway = watchGatewayFake();
    const harness = await renderController(
      root,
      discoveryGateway,
      watchGateway.gateway,
      "/workspace-a",
      "workspace-a",
    );

    await waitForReact(() => expect(harness.current().canStartContinuousRun).toBe(true));
    act(() => harness.current().onStartContinuousRun());
    await waitForReact(() => expect(watchGateway.startWatch).toHaveBeenCalledOnce());

    await harness.setWorkspace("/workspace-b", "workspace-b");
    await waitForReact(() => expect(watchGateway.stopWatch).toHaveBeenCalledOnce());
    expect(harness.current().canStartContinuousRun).toBe(false);
    act(() => harness.current().onStartContinuousRun());
    expect(watchGateway.startWatch).toHaveBeenCalledOnce();

    await act(async () =>
      workspaceBDetection.resolve({ content: "export default {}", status: "ok" }),
    );
    await waitForReact(() => expect(harness.current().canStartContinuousRun).toBe(true));
  });
});

async function renderController(
  root: Root,
  discoveryGateway: WorkspaceTestDiscoveryGateway,
  watchGateway: JsTestWatchGateway,
  initialRootPath = "/workspace",
  initialWorkspaceId = "workspace-id",
) {
  let discoveryVersion = 0;
  let rootPath = initialRootPath;
  let workspaceId = initialWorkspaceId;
  let current: ReturnType<typeof useJsTestExplorerPanelController> | null = null;

  function Harness() {
    current = useJsTestExplorerPanelController({
      coverageGateway: {
        run: async () => ({ message: "unused", status: "unavailable" }),
      },
      coverageInvalidationVersion: 0,
      debugStartBlocked: false,
      discoveryGateway,
      discoveryVersion,
      isDebugStartBlocked: () => false,
      isOpen: false,
      onOpenLocation: () => undefined,
      openDebugPanel: () => undefined,
      rootPath,
      runGateway: {
        run: async () => ({ message: "unused", status: "unavailable" }),
      },
      runRequestVersion: 0,
      startDebug: async () => undefined,
      watchGateway,
      workspaceId,
      workspaceTrusted: true,
    });
    return null;
  }

  await act(async () => root.render(<Harness />));

  return {
    current: () => {
      if (!current) throw new Error("Controller is not mounted.");
      return current;
    },
    setDiscoveryVersion: async (next: number) => {
      discoveryVersion = next;
      await act(async () => root.render(<Harness />));
    },
    setWorkspace: async (nextRootPath: string, nextWorkspaceId: string) => {
      rootPath = nextRootPath;
      workspaceId = nextWorkspaceId;
      await act(async () => root.render(<Harness />));
    },
  };
}

function mutableRunnerDiscoveryGateway() {
  let runner: "vitest" | "jest" = "vitest";
  let completedDetections = 0;
  const gateway: WorkspaceTestDiscoveryGateway = {
    enumerateJsTestFiles: async () => ({ files: [], truncated: false, visited: 0 }),
    readTextFileBounded: vi.fn<WorkspaceTestDiscoveryGateway["readTextFileBounded"]>(
      async (_rootPath, relativePath) => {
        if (relativePath === "node_modules/.bin/vitest") {
          completedDetections += 1;
        }
        if (runner === "vitest" && relativePath === "vitest.config.ts") {
          return { content: "export default {}", status: "ok" };
        }
        if (runner === "jest" && relativePath === "jest.config.ts") {
          return { content: "export default {}", status: "ok" };
        }
        if (runner === "jest" && relativePath === ".git") {
          return { content: "gitdir: .git", status: "ok" };
        }
        return { status: "tooLarge" };
      },
    ),
  };
  return {
    completedDetections: () => completedDetections,
    gateway,
    useJest: () => {
      runner = "jest";
    },
  };
}

function watchGatewayFake() {
  const startWatch = vi.fn<JsTestWatchGateway["startWatch"]>(async (request) => ({
    owner: {
      epoch: request.epoch,
      watchId: request.watchId,
      workspaceId: request.workspaceId,
    },
    structuredResults: "unavailable-in-watch-mode",
  }));
  const stopWatch = vi.fn<JsTestWatchGateway["stopWatch"]>(async () => undefined);
  const gateway: JsTestWatchGateway = {
    acknowledgeWatchStart: async () => undefined,
    startWatch,
    stopWatch,
    subscribeWatchOutput: async () => () => undefined,
    subscribeWatchStatus: async () => () => undefined,
  };
  return { gateway, startWatch, stopWatch };
}

async function waitForReact(assertion: () => void | Promise<void>): Promise<void> {
  await act(async () => vi.waitFor(assertion));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
