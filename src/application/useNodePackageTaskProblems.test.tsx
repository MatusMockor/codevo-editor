// @vitest-environment jsdom

import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NodePackageTaskState } from "./nodePackageTaskLifecycle";
import type {
  NodePackageTaskOutputEvent,
  NodePackageTaskProblemsEvent,
  NodePackageTaskProblemsGateway,
} from "../domain/nodePackageTaskProblems";
import { useNodePackageTaskProblems } from "./useNodePackageTaskProblems";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => {
  document.body.innerHTML = "";
});

const owner = {
  runId: "run-1",
  workspaceId: "ws-1",
  sessionId: 4,
  manifestRelativePath: "package.json",
  scriptName: "typecheck",
};
const problem = {
  filePath: "/workspace/index.ts",
  lineNumber: 2,
  column: 3,
  severity: "error",
  message: "No overload",
  code: "TS2769",
  source: "TypeScript",
} as const;

describe("useNodePackageTaskProblems", () => {
  it("owns events, keeps a natural exit snapshot, and clears on stop or lost trust", async () => {
    const harness = await renderHarness();
    await act(async () =>
      harness.emitProblems({
        kind: "complete",
        owner,
        sequence: 3,
        problems: [problem],
        total: 1,
        truncated: false,
      }),
    );
    expect(harness.current().notices).toHaveLength(1);

    await harness.rerender(exitedTask());
    expect(harness.current().state?.complete).toBe(true);

    await harness.rerender(stoppedTask());
    expect(harness.current().state).toBeNull();

    await harness.rerender(startingTask(), false);
    await act(async () => harness.emitProblems({ kind: "reset", owner, sequence: 4 }));
    expect(harness.current().state).toBeNull();
    harness.unmount();
    expect(harness.unsubscribed()).toBe(2);
  });

  it("drops stale and foreign output before forwarding it", async () => {
    const outputs: NodePackageTaskOutputEvent[] = [];
    const harness = await renderHarness((event) => outputs.push(event));
    const event = { owner, sequence: 2, stream: "stdout", data: "ok", truncated: false } as const;
    await act(async () => {
      harness.emitOutput(event);
      harness.emitOutput(event);
      harness.emitOutput({ ...event, owner: { ...owner, runId: "foreign" }, sequence: 3 });
      harness.emitOutput({ ...event, sequence: 3, data: "", truncated: true });
      harness.emitOutput({ ...event, sequence: 4, data: "later" });
    });
    expect(outputs).toEqual([event, { ...event, sequence: 3, data: "", truncated: true }]);
    harness.unmount();
  });

  it("clears an owned snapshot when the workspace root changes", async () => {
    const harness = await renderHarness();
    await act(async () =>
      harness.emitProblems({
        kind: "complete",
        owner,
        sequence: 2,
        problems: [problem],
        total: 1,
        truncated: false,
      }),
    );
    expect(harness.current().state).not.toBeNull();
    await harness.rerender(startingTask(), true, "/other", "ws-2");
    expect(harness.current().state).toBeNull();
    harness.unmount();
  });

  it("cancels pending readiness and skips the second subscription after unmount", async () => {
    const outputSubscription = deferred<() => void>();
    const unsubscribeOutput = vi.fn();
    const subscribeProblems = vi.fn(async () => () => undefined);
    const gateway: NodePackageTaskProblemsGateway = {
      subscribeNodePackageTaskOutputEvents: () => outputSubscription.promise,
      subscribeNodePackageTaskProblemsEvents: subscribeProblems,
    };
    const harness = await renderCustomHarness(gateway);
    const readiness = harness.current().ready;

    harness.unmount();
    await expect(readiness).rejects.toMatchObject({ name: "AbortError" });
    await act(async () => outputSubscription.resolve(unsubscribeOutput));

    expect(unsubscribeOutput).toHaveBeenCalledOnce();
    expect(subscribeProblems).not.toHaveBeenCalled();
  });

  it("unsubscribes a problems listener that resolves after cleanup", async () => {
    const problemsSubscription = deferred<() => void>();
    const unsubscribeOutput = vi.fn();
    const unsubscribeProblems = vi.fn();
    const gateway: NodePackageTaskProblemsGateway = {
      subscribeNodePackageTaskOutputEvents: async () => unsubscribeOutput,
      subscribeNodePackageTaskProblemsEvents: () => problemsSubscription.promise,
    };
    const harness = await renderCustomHarness(gateway);
    const readiness = harness.current().ready;

    harness.unmount();
    await expect(readiness).rejects.toMatchObject({ name: "AbortError" });
    await act(async () => problemsSubscription.resolve(unsubscribeProblems));

    expect(unsubscribeOutput).toHaveBeenCalledOnce();
    expect(unsubscribeProblems).toHaveBeenCalledOnce();
  });

  it("rejects the replaced gateway gate while the new gate becomes ready", async () => {
    const firstOutputSubscription = deferred<() => void>();
    const firstUnsubscribe = vi.fn();
    const firstProblemsSubscription = vi.fn(async () => () => undefined);
    const firstGateway: NodePackageTaskProblemsGateway = {
      subscribeNodePackageTaskOutputEvents: () => firstOutputSubscription.promise,
      subscribeNodePackageTaskProblemsEvents: firstProblemsSubscription,
    };
    const secondGateway: NodePackageTaskProblemsGateway = {
      subscribeNodePackageTaskOutputEvents: async () => () => undefined,
      subscribeNodePackageTaskProblemsEvents: async () => () => undefined,
    };
    const harness = await renderCustomHarness(firstGateway);
    const replacedReadiness = harness.current().ready;

    await harness.rerender(secondGateway);
    await expect(replacedReadiness).rejects.toMatchObject({ name: "AbortError" });
    await expect(harness.current().ready).resolves.toBeUndefined();
    await act(async () => firstOutputSubscription.resolve(firstUnsubscribe));

    expect(firstUnsubscribe).toHaveBeenCalledOnce();
    expect(firstProblemsSubscription).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("keeps readiness usable through StrictMode effect replay", async () => {
    const gateway: NodePackageTaskProblemsGateway = {
      subscribeNodePackageTaskOutputEvents: async () => () => undefined,
      subscribeNodePackageTaskProblemsEvents: async () => () => undefined,
    };
    const harness = await renderCustomHarness(gateway, true);

    await expect(harness.current().ready).resolves.toBeUndefined();
    harness.unmount();
  });
});

async function renderCustomHarness(
  initialGateway: NodePackageTaskProblemsGateway,
  strictMode = false,
) {
  const host = document.createElement("div");
  const root = createRoot(host);
  let gateway = initialGateway;
  let current: ReturnType<typeof useNodePackageTaskProblems> | null = null;
  function Harness() {
    current = useNodePackageTaskProblems({
      enabled: true,
      gateway,
      rootPath: "/workspace",
      task: startingTask(),
      workspaceId: "ws-1",
    });
    return null;
  }
  const render = () =>
    root.render(
      strictMode ? (
        <StrictMode>
          <Harness />
        </StrictMode>
      ) : (
        <Harness />
      ),
    );
  await act(async () => render());
  return {
    current: () => current!,
    rerender: async (nextGateway: NodePackageTaskProblemsGateway) => {
      gateway = nextGateway;
      await act(async () => render());
    },
    unmount: () => act(() => root.unmount()),
  };
}

async function renderHarness(onOutput?: (event: NodePackageTaskOutputEvent) => void) {
  const host = document.createElement("div");
  const root = createRoot(host);
  let outputHandler: (event: NodePackageTaskOutputEvent) => void = () => undefined;
  let problemsHandler: (event: NodePackageTaskProblemsEvent) => void = () => undefined;
  let unsubscribeCount = 0;
  const gateway: NodePackageTaskProblemsGateway = {
    subscribeNodePackageTaskOutputEvents: async (handler) => {
      outputHandler = handler;
      return () => {
        unsubscribeCount += 1;
      };
    },
    subscribeNodePackageTaskProblemsEvents: async (handler) => {
      problemsHandler = handler;
      return () => {
        unsubscribeCount += 1;
      };
    },
  };
  let props = {
    enabled: true,
    rootPath: "/workspace",
    task: startingTask() as NodePackageTaskState,
    workspaceId: "ws-1",
  };
  let current: ReturnType<typeof useNodePackageTaskProblems> | null = null;
  function Harness() {
    current = useNodePackageTaskProblems({
      enabled: props.enabled,
      gateway,
      onOutput,
      rootPath: props.rootPath,
      task: props.task,
      workspaceId: props.workspaceId,
    });
    return null;
  }
  await act(async () => root.render(<Harness />));
  return {
    current: () => current!,
    emitOutput: (event: NodePackageTaskOutputEvent) => outputHandler(event),
    emitProblems: (event: NodePackageTaskProblemsEvent) => problemsHandler(event),
    rerender: async (
      task: NodePackageTaskState,
      enabled = true,
      rootPath = props.rootPath,
      workspaceId = props.workspaceId,
    ) => {
      props = { task, enabled, rootPath, workspaceId };
      await act(async () => root.render(<Harness />));
    },
    unmount: () => act(() => root.unmount()),
    unsubscribed: () => unsubscribeCount,
  };
}

function startingTask(): NodePackageTaskState {
  return { ...owner, status: "starting" };
}

function exitedTask(): NodePackageTaskState {
  return {
    runId: owner.runId,
    workspaceId: owner.workspaceId,
    manifestRelativePath: owner.manifestRelativePath,
    scriptName: owner.scriptName,
    sessionId: null,
    status: "exited",
    exitCode: 0,
  };
}

function stoppedTask(): NodePackageTaskState {
  return {
    runId: owner.runId,
    workspaceId: owner.workspaceId,
    manifestRelativePath: owner.manifestRelativePath,
    scriptName: owner.scriptName,
    sessionId: null,
    status: "stopped",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
