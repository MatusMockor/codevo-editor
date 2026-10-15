// @vitest-environment jsdom

import { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { waitForReact } from "../test/reactTestLifecycle";
import type {
  NodePackageTaskEvent,
  StartNodePackageTaskRequest,
} from "../domain/nodePackageScripts";
import { DEFAULT_WORKSPACE_PATH_POLICY } from "../domain/workspacePath";
import {
  useWorkbenchNodePackageScripts,
  type NodePackageScriptsWorkbenchGateway,
} from "./useNodePackageScriptWorkbench";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("useWorkbenchNodePackageScripts integration", () => {
  it("discovers and refreshes while untrusted without enabling execution subscriptions", async () => {
    const unsubscribeTask = vi.fn();
    const unsubscribeOutput = vi.fn();
    const unsubscribeProblems = vi.fn();
    const listNodePackageScripts = vi.fn(async () => ({
      scripts: [script],
      total: 1,
      truncated: false,
      visited: 1,
    }));
    const subscribeNodePackageTaskEvents = vi.fn(async () => unsubscribeTask);
    const subscribeNodePackageTaskOutputEvents = vi.fn(async () => unsubscribeOutput);
    const subscribeNodePackageTaskProblemsEvents = vi.fn(async () => unsubscribeProblems);
    const startNodePackageTask = vi.fn(async (request: StartNodePackageTaskRequest) => ({
      runId: request.runId,
    }));
    const gateway: NodePackageScriptsWorkbenchGateway = {
      listNodePackageScripts,
      startNodePackageTask,
      acknowledgeNodePackageTaskStart: async () => undefined,
      stopNodePackageTask: async () => undefined,
      subscribeNodePackageTaskEvents,
      subscribeNodePackageTaskOutputEvents,
      subscribeNodePackageTaskProblemsEvents,
    };
    const harness = await renderHarness(gateway, false);

    expect(harness.current().available).toBe(false);
    expect(harness.current().scripts).toEqual([script]);
    expect(subscribeNodePackageTaskEvents).not.toHaveBeenCalled();
    expect(subscribeNodePackageTaskOutputEvents).not.toHaveBeenCalled();
    expect(subscribeNodePackageTaskProblemsEvents).not.toHaveBeenCalled();
    act(() => harness.current().run(script));
    expect(harness.hasTerminalConsumer()).toBe(false);
    expect(startNodePackageTask).not.toHaveBeenCalled();

    await act(async () => void (await harness.current().refresh()));
    expect(listNodePackageScripts).toHaveBeenCalledTimes(2);
    await harness.setTrusted(true);
    expect(harness.current().available).toBe(true);
    expect(harness.current().scripts).toEqual([script]);
    expect(listNodePackageScripts).toHaveBeenCalledTimes(2);
    expect(subscribeNodePackageTaskEvents).toHaveBeenCalledOnce();
    expect(subscribeNodePackageTaskOutputEvents).not.toHaveBeenCalled();
    expect(subscribeNodePackageTaskProblemsEvents).not.toHaveBeenCalled();

    await harness.setTrusted(false);
    expect(harness.current().available).toBe(false);
    expect(harness.current().scripts).toEqual([script]);
    expect(unsubscribeTask).toHaveBeenCalledOnce();
    expect(unsubscribeOutput).not.toHaveBeenCalled();
    expect(unsubscribeProblems).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("dispatches start without output or problems feeds", async () => {
    let statusHandler: (event: NodePackageTaskEvent) => void = () => undefined;
    let startRequest: StartNodePackageTaskRequest | null = null;
    const start = vi.fn(async (request: StartNodePackageTaskRequest) => {
      startRequest = request;
      return { runId: request.runId };
    });
    const subscribeNodePackageTaskOutputEvents = vi.fn(async () => () => undefined);
    const subscribeNodePackageTaskProblemsEvents = vi.fn(async () => () => undefined);
    const gateway: NodePackageScriptsWorkbenchGateway = {
      listNodePackageScripts: async () => ({
        scripts: [script],
        total: 1,
        truncated: false,
        visited: 1,
      }),
      startNodePackageTask: start,
      acknowledgeNodePackageTaskStart: async () => undefined,
      stopNodePackageTask: async () => undefined,
      subscribeNodePackageTaskEvents: async (handler) => {
        statusHandler = handler;
        return () => undefined;
      },
      subscribeNodePackageTaskOutputEvents,
      subscribeNodePackageTaskProblemsEvents,
    };
    const harness = await renderHarness(gateway);
    await act(async () => {
      for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
    });
    expect(harness.current().scripts).toEqual([script]);
    act(() => harness.current().run(script));
    await act(async () => harness.deliverSession(9));
    await waitForReact(() => expect(start).toHaveBeenCalledOnce());
    expect(startRequest).toMatchObject({ problemMatcher: "typescript" });
    expect(subscribeNodePackageTaskOutputEvents).not.toHaveBeenCalled();
    expect(subscribeNodePackageTaskProblemsEvents).not.toHaveBeenCalled();
    expect(harness.current()).not.toHaveProperty("problemNotices");

    act(() => statusHandler({ ...startRequest!, status: "stopped" }));
    expect(harness.current().pending).toBe(false);
    harness.unmount();
  });
});

const script = {
  key: "node-package-script:package.json:typecheck",
  manifestRelativePath: "package.json",
  packageName: "demo",
  packageManager: "npm",
  packageRootRelativePath: "",
  scriptName: "typecheck",
} as const;
async function renderHarness(gateway: NodePackageScriptsWorkbenchGateway, initialTrusted = true) {
  const root = createRoot(document.createElement("div"));
  let current: ReturnType<typeof useWorkbenchNodePackageScripts> | null = null;
  let terminalConsumer: ((sessionId: number | null) => void) | null = null;
  let setTrustedState: ((trusted: boolean) => void) | null = null;
  const reportErrorForActiveWorkspaceRoot = vi.fn();
  function Harness() {
    const currentWorkspaceRootRef = useRef<string | null>("/workspace");
    const [trusted, setTrusted] = useState(initialTrusted);
    setTrustedState = setTrusted;
    current = useWorkbenchNodePackageScripts({
      currentWorkspaceRootRef,
      discoveryVersion: 0,
      gateway,
      hasJavaScriptTypeScriptWorkspace: true,
      identity: {
        canonicalRoot: "/workspace",
        policy: DEFAULT_WORKSPACE_PATH_POLICY,
        selectedPath: "/workspace",
        workspaceId: "ws-1",
      },
      reportErrorForActiveWorkspaceRoot,
      requestTerminalSession: (consumer) => {
        terminalConsumer = consumer;
      },
      rootPath: "/workspace",
      trusted,
      workspaceId: "ws-1",
    });
    return null;
  }
  await act(async () => root.render(<Harness />));
  return {
    current: () => current!,
    deliverSession: (sessionId: number) => terminalConsumer?.(sessionId),
    hasTerminalConsumer: () => terminalConsumer !== null,
    reportErrorForActiveWorkspaceRoot,
    setTrusted: async (trusted: boolean) => {
      await act(async () => setTrustedState?.(trusted));
    },
    unmount: () => act(() => root.unmount()),
  };
}
