// @vitest-environment jsdom

import { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { waitForReact } from "../test/reactTestLifecycle";
import type {
  NodePackageTaskEvent,
  StartNodePackageTaskRequest,
} from "../domain/nodePackageScripts";
import type { NodePackageTaskProblemsEvent } from "../domain/nodePackageTaskProblems";
import { DEFAULT_WORKSPACE_PATH_POLICY } from "../domain/workspacePath";
import {
  useWorkbenchNodePackageScripts,
  type NodePackageScriptsWorkbenchGateway,
} from "./useNodePackageScriptWorkbench";
import type { WorkbenchNotice } from "./workbenchNotice";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("useWorkbenchNodePackageScripts integration", () => {
  it("runs the selected script from a live dirty package.json capture", async () => {
    const gateway = selectedScriptGateway();
    const harness = await renderHarness(gateway);
    await act(async () => {
      for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
    });
    const content = '{"scripts":{"typecheck":"tsc --noEmit","dirty-only":"custom"}}';
    let accepted = false;
    act(() => {
      accepted = harness.current().runSelectedScript({
        anchorOffset: content.indexOf('"typecheck"'),
        content,
        documentPath: "/workspace/package.json",
        modelIdentity: {},
        modelVersion: 4,
      });
    });

    expect(accepted).toBe(true);
    expect(harness.hasTerminalConsumer()).toBe(true);
    expect(harness.current().task).toMatchObject({
      manifestRelativePath: "package.json",
      scriptName: "typecheck",
    });
    expect(
      harness.current().runSelectedScript({
        anchorOffset: content.indexOf('"typecheck"'),
        content,
        documentPath: "/workspace/package.json",
        modelIdentity: {},
        modelVersion: 4,
      }),
    ).toBe(false);
    harness.unmount();
  });

  it("reports an eligible invalid editor selection without starting a task", async () => {
    const harness = await renderHarness(selectedScriptGateway());
    await act(async () => {
      for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
    });
    act(() => {
      expect(
        harness.current().runSelectedScript({
          anchorOffset: 0,
          content: '{"scripts":{"typecheck":"tsc"}}',
          documentPath: "/workspace/package.json",
          modelIdentity: {},
          modelVersion: 1,
        }),
      ).toBe(false);
    });

    expect(harness.hasTerminalConsumer()).toBe(false);
    expect(harness.reportErrorForActiveWorkspaceRoot).toHaveBeenCalledWith(
      "/workspace",
      "Node Package Script",
      expect.objectContaining({
        message: "Could not find a valid npm script at the selection.",
      }),
    );
    harness.unmount();
  });

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
    expect(subscribeNodePackageTaskOutputEvents).toHaveBeenCalledOnce();
    expect(subscribeNodePackageTaskProblemsEvents).toHaveBeenCalledOnce();

    await harness.setTrusted(false);
    expect(harness.current().available).toBe(false);
    expect(harness.current().scripts).toEqual([script]);
    expect(unsubscribeTask).toHaveBeenCalledOnce();
    expect(unsubscribeOutput).toHaveBeenCalledOnce();
    expect(unsubscribeProblems).toHaveBeenCalledOnce();
    harness.unmount();
  });

  it("waits for problem listeners and maps an immediate ACK snapshot to navigation", async () => {
    const outputReady = deferred<void>();
    let statusHandler: (event: NodePackageTaskEvent) => void = () => undefined;
    let problemsHandler: (event: NodePackageTaskProblemsEvent) => void = () => undefined;
    let startRequest: StartNodePackageTaskRequest | null = null;
    const start = vi.fn(async (request: StartNodePackageTaskRequest) => {
      startRequest = request;
      return { runId: request.runId };
    });
    const gateway: NodePackageScriptsWorkbenchGateway = {
      listNodePackageScripts: async () => ({
        scripts: [script],
        total: 1,
        truncated: false,
        visited: 1,
      }),
      startNodePackageTask: start,
      acknowledgeNodePackageTaskStart: async () => {
        const owner = startRequest!;
        problemsHandler({ kind: "reset", owner, sequence: 1 });
        problemsHandler({
          kind: "append",
          owner,
          sequence: 2,
          problems: [problem],
          total: 1,
          truncated: false,
        });
        problemsHandler({
          kind: "complete",
          owner,
          sequence: 3,
          problems: [problem],
          total: 1,
          truncated: false,
        });
      },
      stopNodePackageTask: async () => undefined,
      subscribeNodePackageTaskEvents: async (handler) => {
        statusHandler = handler;
        return () => undefined;
      },
      subscribeNodePackageTaskOutputEvents: async () => {
        await outputReady.promise;
        return () => undefined;
      },
      subscribeNodePackageTaskProblemsEvents: async (handler) => {
        problemsHandler = handler;
        return () => undefined;
      },
    };
    const harness = await renderHarness(gateway);
    await act(async () => {
      for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
    });
    expect(harness.current().scripts).toEqual([script]);
    act(() => harness.current().run(script));
    await act(async () => harness.deliverSession(9));
    expect(start).not.toHaveBeenCalled();
    await act(async () => {
      outputReady.resolve();
      for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
    });
    await waitForReact(() => expect(start).toHaveBeenCalledOnce());
    expect(startRequest).toMatchObject({ problemMatcher: "typescript" });
    expect(harness.current().problemNotices[0]).toMatchObject({
      source: "TypeScript",
      navigationTarget: {
        path: "/workspace/src/index.ts",
        range: { start: { lineNumber: 4, column: 2 } },
      },
    });
    expect(harness.notices()[0]?.navigationTarget?.path).toBe("/workspace/src/index.ts");

    act(() => statusHandler({ ...startRequest!, status: "exited", exitCode: 0 }));
    expect(harness.current().problemNotices).toHaveLength(1);
    act(() =>
      problemsHandler({
        kind: "clear",
        owner: { ...startRequest!, runId: "stale" },
        sequence: 4,
      }),
    );
    expect(harness.current().problemNotices).toHaveLength(1);
    act(() => statusHandler({ ...startRequest!, status: "stopped" }));
    expect(harness.current().problemNotices).toEqual([]);
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
const problem = {
  filePath: "/workspace/src/index.ts",
  lineNumber: 4,
  column: 2,
  severity: "error",
  message: "Type mismatch",
  code: "TS2322",
  source: "TypeScript",
} as const;

async function renderHarness(gateway: NodePackageScriptsWorkbenchGateway, initialTrusted = true) {
  const root = createRoot(document.createElement("div"));
  let current: ReturnType<typeof useWorkbenchNodePackageScripts> | null = null;
  let composedNotices: WorkbenchNotice[] = [];
  let terminalConsumer: ((sessionId: number | null) => void) | null = null;
  let setTrustedState: ((trusted: boolean) => void) | null = null;
  const reportErrorForActiveWorkspaceRoot = vi.fn();
  function Harness() {
    const currentWorkspaceRootRef = useRef<string | null>("/workspace");
    const [notices, setNotices] = useState<WorkbenchNotice[]>([]);
    const [trusted, setTrusted] = useState(initialTrusted);
    setTrustedState = setTrusted;
    composedNotices = notices;
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
      setNotices,
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
    notices: () => composedNotices,
    reportErrorForActiveWorkspaceRoot,
    setTrusted: async (trusted: boolean) => {
      await act(async () => setTrustedState?.(trusted));
    },
    unmount: () => act(() => root.unmount()),
  };
}

function selectedScriptGateway(): NodePackageScriptsWorkbenchGateway {
  return {
    acknowledgeNodePackageTaskStart: async () => undefined,
    listNodePackageScripts: async () => ({
      scripts: [script],
      total: 1,
      truncated: false,
      visited: 1,
    }),
    startNodePackageTask: async ({ runId }) => ({ runId }),
    stopNodePackageTask: async () => undefined,
    subscribeNodePackageTaskEvents: async () => () => undefined,
    subscribeNodePackageTaskOutputEvents: async () => () => undefined,
    subscribeNodePackageTaskProblemsEvents: async () => () => undefined,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
