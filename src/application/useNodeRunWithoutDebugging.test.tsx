// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  NodeRunTarget,
  NodeRunTaskGateway,
  NodeRunTaskStatusEvent,
  StartNodeRunTaskRequest,
} from "../domain/nodeRunTask";
import type { EditorDocument, FileEntry, WorkspaceFileGateway } from "../domain/workspace";
import {
  useNodeRunWithoutDebugging,
  type UseNodeRunWithoutDebuggingResult,
} from "./useNodeRunWithoutDebugging";
import { resolveNodeRunWithoutDebuggingTarget } from "./nodeRunWithoutDebuggingResolver";

const ROOT = "/workspace";
const WORKSPACE_ID = "workspace-a";
const SCRIPT = documentAt("/workspace/src/main.ts");

describe("resolveNodeRunWithoutDebuggingTarget", () => {
  it("prefers a configured npm target over the plain active script", async () => {
    const result = await resolveNodeRunWithoutDebuggingTarget({
      document: SCRIPT,
      isActiveDocumentJsTest: false,
      isCurrent: () => true,
      readFileIfExists: vi.fn(async () => null),
      workspaceFiles: configuredWorkspace({
        name: "Package",
        default: true,
        target: { kind: "npm", script: "build" },
        args: [],
        env: {},
      }),
      workspaceRoot: ROOT,
    });

    expect(result).toEqual({
      kind: "target",
      target: {
        args: [],
        env: {},
        kind: "node-npm-script",
        packageRootPath: ROOT,
        script: "build",
      },
    });
  });

  it("does not project imported Node-internals filtering into Run Without Debugging", async () => {
    const source = JSON.stringify({
      version: "0.2.0",
      configurations: [
        {
          type: "node",
          request: "launch",
          name: "Package",
          runtimeExecutable: "npm",
          runtimeArgs: ["run", "build"],
          skipFiles: ["<node_internals>/**"],
        },
      ],
    });
    const result = await resolveNodeRunWithoutDebuggingTarget({
      document: SCRIPT,
      isActiveDocumentJsTest: false,
      isCurrent: () => true,
      readFileIfExists: vi.fn(async () => null),
      workspaceFiles: {
        readDirectory: vi.fn(async (path: string) =>
          path === ROOT
            ? [{ kind: "directory" as const, name: ".vscode", path: `${ROOT}/.vscode` }]
            : [
                {
                  kind: "file" as const,
                  name: "launch.json",
                  path: `${ROOT}/.vscode/launch.json`,
                },
              ],
        ),
        readTextFile: vi.fn(async () => source),
        readTextFileBounded: vi.fn(async () => ({ status: "ok" as const, content: source })),
      },
      workspaceRoot: ROOT,
    });

    expect(result).toEqual({
      kind: "target",
      target: {
        args: [],
        env: {},
        kind: "node-npm-script",
        packageRootPath: ROOT,
        script: "build",
      },
    });
    expect(JSON.stringify(result)).not.toContain("nodeInternals");
  });

  it.each([
    {
      configuration: {
        name: "Attach",
        default: true,
        target: { kind: "attach", port: 9229 },
      },
      warning: "cannot run attach",
    },
    {
      configuration: {
        name: "Inspector",
        default: true,
        target: { kind: "script", path: "src/main.ts" },
        args: ["--inspect-brk=0"],
        env: {},
      },
      warning: "does not accept --inspect",
    },
  ])("fails closed for unsupported configured targets", async ({ configuration, warning }) => {
    const result = await resolveNodeRunWithoutDebuggingTarget({
      document: SCRIPT,
      isActiveDocumentJsTest: false,
      isCurrent: () => true,
      readFileIfExists: vi.fn(async () => null),
      workspaceFiles: configuredWorkspace(configuration),
      workspaceRoot: ROOT,
    });

    expect(result).toMatchObject({ kind: "warning", message: expect.stringContaining(warning) });
  });

  it("detects a plain Vitest file without constructing a shell command", async () => {
    const readFileIfExists = vi.fn(async (path: string) =>
      path === "/workspace/vitest.config.ts" ? "export default {}" : null,
    );
    const result = await resolveNodeRunWithoutDebuggingTarget({
      document: documentAt("/workspace/src/main.test.ts"),
      isActiveDocumentJsTest: true,
      isCurrent: () => true,
      readFileIfExists,
      workspaceFiles: emptyWorkspace(),
      workspaceRoot: ROOT,
    });

    expect(result).toEqual({
      kind: "target",
      target: {
        filePath: "/workspace/src/main.test.ts",
        kind: "js-test-file",
        packageRootPath: ROOT,
        runner: "vitest",
      },
    });
    expect(JSON.stringify(result)).not.toContain("&&");
  });
});

describe("useNodeRunWithoutDebugging", () => {
  let host: HTMLDivElement;
  let root: Root;
  let current: UseNodeRunWithoutDebuggingResult;
  let document: EditorDocument | null;
  let workspaceId: string | null;
  let workspaceRoot: string | null;
  let workspaceTrusted: boolean;
  let debugRuntimeAvailable: boolean;
  let debugRuntimeAvailableNow: boolean;
  let trustedNow: boolean;
  let currentNow: boolean;
  let statusHandler: (event: NodeRunTaskStatusEvent) => void;
  let terminalConsumer: (sessionId: number | null) => void;
  let gateway: NodeRunTaskGateway;
  let startNodeRunTask: ReturnType<
    typeof vi.fn<(request: StartNodeRunTaskRequest) => Promise<{ runId: string }>>
  >;
  let acknowledgeNodeRunTaskStart: ReturnType<
    typeof vi.fn<NodeRunTaskGateway["acknowledgeNodeRunTaskStart"]>
  >;
  let stopNodeRunTask: ReturnType<typeof vi.fn<NodeRunTaskGateway["stopNodeRunTask"]>>;
  let reportError: ReturnType<typeof vi.fn<(error: unknown) => void>>;
  let reportWarning: ReturnType<typeof vi.fn<(message: string) => void>>;
  let requestTerminalSession: ReturnType<
    typeof vi.fn<(consumer: (sessionId: number | null) => void) => void>
  >;
  let workspaceFiles: Pick<
    WorkspaceFileGateway,
    "readDirectory" | "readTextFile" | "readTextFileBounded"
  >;

  function Harness() {
    current = useNodeRunWithoutDebugging({
      activeDocument: document,
      createRunId: () => "run-1",
      debugRuntimeAvailable,
      gateway,
      hasJavaScriptTypeScriptWorkspace: true,
      isActiveDocumentJsTest: false,
      isDebugRuntimeAvailable: () => debugRuntimeAvailableNow,
      isWorkspaceCurrent: () => currentNow,
      isWorkspaceTrusted: () => trustedNow,
      readFileIfExists: vi.fn(async () => null),
      reportError,
      reportWarning,
      requestTerminalSession,
      workspaceFiles,
      workspaceId,
      workspaceRoot,
      workspaceTrusted,
    });
    return null;
  }

  function render() {
    act(() => root.render(<Harness />));
  }

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = documentNode();
    root = createRoot(host);
    document = SCRIPT;
    workspaceId = WORKSPACE_ID;
    workspaceRoot = ROOT;
    workspaceTrusted = true;
    debugRuntimeAvailable = true;
    debugRuntimeAvailableNow = true;
    trustedNow = true;
    currentNow = true;
    statusHandler = () => undefined;
    terminalConsumer = () => undefined;
    const order: string[] = [];
    startNodeRunTask = vi.fn(async (request) => {
      order.push("start");
      return { runId: request.runId };
    });
    acknowledgeNodeRunTaskStart = vi.fn(async () => {
      order.push("ack");
    });
    stopNodeRunTask = vi.fn(async () => undefined);
    gateway = {
      acknowledgeNodeRunTaskStart,
      startNodeRunTask,
      stopNodeRunTask,
      subscribeNodeRunTaskStatus: vi.fn(async (handler) => {
        order.push("subscribe");
        statusHandler = handler;
        return vi.fn();
      }),
    };
    reportError = vi.fn();
    reportWarning = vi.fn();
    requestTerminalSession = vi.fn((consumer) => {
      terminalConsumer = consumer;
      consumer(12);
    });
    workspaceFiles = emptyWorkspace();
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  it("subscribes before an exact structured start and acknowledges the accepted owner", async () => {
    render();
    act(() => current.run());
    await flush();

    expect(gateway.subscribeNodeRunTaskStatus).toHaveBeenCalledOnce();
    expect(startNodeRunTask).toHaveBeenCalledWith({
      runId: "run-1",
      target: { kind: "node-script", scriptPath: SCRIPT.path },
      terminalSessionId: 12,
      workspaceId: WORKSPACE_ID,
    });
    expect(acknowledgeNodeRunTaskStart).toHaveBeenCalledWith({
      runId: "run-1",
      workspaceId: WORKSPACE_ID,
    });
    expect(current.state.kind).toBe("running");
  });

  it("starts a cloned workspace-scoped target without an active document", async () => {
    document = null;
    requestTerminalSession = vi.fn((consumer) => {
      terminalConsumer = consumer;
    });
    const target: NodeRunTarget = {
      args: ["--port", "3000"],
      env: { API_TOKEN: "private" },
      kind: "node-configured-script",
      scriptPath: "/workspace/src/api.ts",
    };
    render();

    let accepted = false;
    act(() => {
      accepted = current.startTarget(target);
    });
    target.args.push("--mutated");
    target.env.API_TOKEN = "mutated";
    act(() => terminalConsumer(12));
    await flush();

    expect(accepted).toBe(true);
    expect(startNodeRunTask).toHaveBeenCalledWith({
      runId: "run-1",
      target: {
        args: ["--port", "3000"],
        env: { API_TOKEN: "private" },
        kind: "node-configured-script",
        scriptPath: "/workspace/src/api.ts",
      },
      terminalSessionId: 12,
      workspaceId: WORKSPACE_ID,
    });
  });

  it("keeps a named workspace run alive across active-document changes", async () => {
    document = null;
    render();
    act(() => {
      expect(current.startTarget({ kind: "node-script", scriptPath: "/workspace/api.ts" })).toBe(
        true,
      );
    });
    await flush();

    document = documentAt("/workspace/other.ts");
    render();
    await flush();

    expect(current.state.kind).toBe("running");
    expect(stopNodeRunTask).not.toHaveBeenCalled();
  });

  it("keeps a named terminal request current across active-document changes", async () => {
    document = null;
    requestTerminalSession = vi.fn((consumer) => {
      terminalConsumer = consumer;
    });
    render();
    act(() => {
      expect(current.startTarget({ kind: "node-script", scriptPath: "/workspace/api.ts" })).toBe(
        true,
      );
    });

    document = documentAt("/workspace/other.ts");
    render();
    act(() => terminalConsumer(12));
    await flush();

    expect(startNodeRunTask).toHaveBeenCalledOnce();
    expect(current.state.kind).toBe("running");
  });

  it("stops a named run when its exact workspace owner changes", async () => {
    document = null;
    render();
    act(() => {
      expect(current.startTarget({ kind: "node-script", scriptPath: "/workspace/api.ts" })).toBe(
        true,
      );
    });
    await flush();

    workspaceId = "workspace-b";
    workspaceRoot = "/replacement";
    currentNow = false;
    render();
    await flush();

    expect(stopNodeRunTask).toHaveBeenCalledWith({ runId: "run-1", workspaceId: WORKSPACE_ID });
    expect(current.state.kind).toBe("idle");
  });

  it("rejects invalid or concurrent named targets before terminal allocation", async () => {
    document = null;
    requestTerminalSession = vi.fn((consumer) => {
      terminalConsumer = consumer;
    });
    render();

    act(() => {
      expect(
        current.startTarget({
          args: [],
          env: { PATH: "secret" },
          kind: "node-configured-script",
          scriptPath: "/workspace/api.ts",
        }),
      ).toBe(false);
      expect(current.startTarget({ kind: "node-script", scriptPath: "/other/secret.ts" })).toBe(
        false,
      );
      expect(
        current.startTarget({
          kind: "node-script",
          scriptPath: "/workspace/src/../../secret.ts",
        }),
      ).toBe(false);
      expect(
        current.startTarget({
          args: [],
          cwd: "/workspace/../other",
          env: {},
          kind: "node-configured-script",
          scriptPath: "/workspace/api.ts",
        }),
      ).toBe(false);
      expect(current.startTarget({ kind: "node-script", scriptPath: "/workspace/api.ts" })).toBe(
        true,
      );
      expect(current.startTarget({ kind: "node-script", scriptPath: "/workspace/other.ts" })).toBe(
        false,
      );
    });

    expect(requestTerminalSession).toHaveBeenCalledOnce();
    expect(startNodeRunTask).not.toHaveBeenCalled();
    act(() => terminalConsumer(null));
    await flush();
    expect(current.pending).toBe(false);
  });

  it("allows only one run while resolution/start is in flight", async () => {
    requestTerminalSession = vi.fn((consumer) => {
      terminalConsumer = consumer;
    });
    render();
    act(() => {
      current.run();
      current.run();
    });
    await flush();
    expect(requestTerminalSession).toHaveBeenCalledOnce();

    act(() => terminalConsumer(12));
    await flush();
    expect(startNodeRunTask).toHaveBeenCalledOnce();
  });

  it("consumes only the first terminal-session callback", async () => {
    requestTerminalSession = vi.fn((consumer) => {
      terminalConsumer = consumer;
    });
    render();
    act(() => current.run());
    await flush();
    act(() => {
      terminalConsumer(12);
      terminalConsumer(13);
    });
    await flush();

    expect(startNodeRunTask).toHaveBeenCalledOnce();
    expect(startNodeRunTask).toHaveBeenCalledWith(
      expect.objectContaining({ terminalSessionId: 12 }),
    );
  });

  it("stops exactly once when a running workspace becomes untrusted", async () => {
    render();
    act(() => current.run());
    await flush();

    workspaceTrusted = false;
    trustedNow = false;
    render();
    render();
    await flush();

    expect(stopNodeRunTask).toHaveBeenCalledOnce();
    expect(stopNodeRunTask).toHaveBeenCalledWith({ runId: "run-1", workspaceId: WORKSPACE_ID });
  });

  it("stops a dispatched start that loses trust before its response settles", async () => {
    const start = deferred<{ runId: string }>();
    startNodeRunTask.mockImplementationOnce(() => start.promise);
    render();
    act(() => current.run());
    await flush();
    expect(startNodeRunTask).toHaveBeenCalledOnce();

    trustedNow = false;
    workspaceTrusted = false;
    render();
    start.resolve({ runId: "run-1" });
    await flush();

    expect(stopNodeRunTask).toHaveBeenCalledOnce();
    expect(acknowledgeNodeRunTaskStart).not.toHaveBeenCalled();
  });

  it("drops resolution when trust is revoked across a configuration read await", async () => {
    const directory = deferred<FileEntry[]>();
    workspaceFiles = {
      ...emptyWorkspace(),
      readDirectory: vi.fn(() => directory.promise),
    };
    render();
    act(() => current.run());
    workspaceTrusted = false;
    trustedNow = false;
    render();
    directory.resolve([]);
    await flush();

    expect(requestTerminalSession).not.toHaveBeenCalled();
    expect(startNodeRunTask).not.toHaveBeenCalled();
    expect(stopNodeRunTask).not.toHaveBeenCalled();
  });

  it("rechecks trust after the subscription becomes ready and before start", async () => {
    const subscribed = deferred<() => void>();
    gateway = {
      ...gateway,
      subscribeNodeRunTaskStatus: vi.fn(() => subscribed.promise),
    };
    render();
    act(() => current.run());
    await flush();
    expect(requestTerminalSession).toHaveBeenCalledOnce();
    expect(startNodeRunTask).not.toHaveBeenCalled();

    workspaceTrusted = false;
    trustedNow = false;
    render();
    subscribed.resolve(vi.fn());
    await flush();

    expect(startNodeRunTask).not.toHaveBeenCalled();
    expect(stopNodeRunTask).not.toHaveBeenCalled();
  });

  it("cancels immediately while an allocated run is waiting for the subscription", async () => {
    const subscribed = deferred<() => void>();
    gateway = {
      ...gateway,
      subscribeNodeRunTaskStatus: vi.fn(() => subscribed.promise),
    };
    render();
    act(() => current.run());
    await flush();
    expect(current.state.kind).toBe("waiting-for-terminal");

    act(() => current.stop());

    expect(current.state.kind).toBe("idle");
    expect(current.pending).toBe(false);
    expect(startNodeRunTask).not.toHaveBeenCalled();
    expect(stopNodeRunTask).not.toHaveBeenCalled();

    // The subscription deliberately never settles: cancellation must release
    // the per-run continuation without waiting for the gateway.
    await flush();
    expect(startNodeRunTask).not.toHaveBeenCalled();
  });

  it("rechecks debugger availability after the subscription becomes ready and before start", async () => {
    const subscribed = deferred<() => void>();
    gateway = {
      ...gateway,
      subscribeNodeRunTaskStatus: vi.fn(() => subscribed.promise),
    };
    render();
    act(() => current.run());
    await flush();
    expect(requestTerminalSession).toHaveBeenCalledOnce();
    expect(startNodeRunTask).not.toHaveBeenCalled();

    debugRuntimeAvailableNow = false;
    subscribed.resolve(vi.fn());
    await flush();

    expect(startNodeRunTask).not.toHaveBeenCalled();
    expect(stopNodeRunTask).not.toHaveBeenCalled();
  });

  it("stops exactly once when the debugger lifecycle becomes unavailable", async () => {
    render();
    act(() => current.run());
    await flush();

    debugRuntimeAvailable = false;
    debugRuntimeAvailableNow = false;
    render();
    render();
    await flush();

    expect(stopNodeRunTask).toHaveBeenCalledOnce();
    expect(stopNodeRunTask).toHaveBeenCalledWith({ runId: "run-1", workspaceId: WORKSPACE_ID });
  });

  it("reports an explicit stop failure and permits an exact-owner retry", async () => {
    stopNodeRunTask.mockRejectedValueOnce(new Error("stop failed"));
    render();
    act(() => current.run());
    await flush();

    act(() => current.stop());
    await flush();
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ message: "stop failed" }));
    expect(stopNodeRunTask).toHaveBeenCalledOnce();
    expect(current.state).toMatchObject({ kind: "stopping", retryable: true });

    act(() => current.stop());
    expect(current.state).toMatchObject({ kind: "stopping", retryable: false });
    await flush();
    expect(stopNodeRunTask).toHaveBeenCalledTimes(2);
  });

  it("does not revive a stopping run from a late running event", async () => {
    const stopped = deferred<void>();
    stopNodeRunTask.mockImplementationOnce(() => stopped.promise);
    render();
    act(() => current.run());
    await flush();

    act(() => current.stop());
    expect(current.state).toMatchObject({ kind: "stopping", retryable: false });

    act(() =>
      statusHandler({
        runId: "run-1",
        status: "running",
        terminalSessionId: 12,
        workspaceId: WORKSPACE_ID,
      }),
    );
    expect(current.state).toMatchObject({ kind: "stopping", retryable: false });

    act(() =>
      statusHandler({
        runId: "run-1",
        status: "stopped",
        terminalSessionId: 12,
        workspaceId: WORKSPACE_ID,
      }),
    );
    expect(current.state.kind).toBe("idle");
    expect(current.pending).toBe(false);
    stopped.resolve(undefined);
    await flush();
  });

  it("does not revive a retryable failed stop from a late running event", async () => {
    stopNodeRunTask.mockRejectedValueOnce(new Error("stop failed"));
    render();
    act(() => current.run());
    await flush();

    act(() => current.stop());
    await flush();
    expect(current.state).toMatchObject({ kind: "stopping", retryable: true });

    act(() =>
      statusHandler({
        runId: "run-1",
        status: "running",
        terminalSessionId: 12,
        workspaceId: WORKSPACE_ID,
      }),
    );
    expect(current.state).toMatchObject({ kind: "stopping", retryable: true });
  });

  it("does not revive or report a stop rejection after the run has terminated", async () => {
    const stopped = deferred<void>();
    stopNodeRunTask.mockImplementationOnce(() => stopped.promise);
    render();
    act(() => current.run());
    await flush();

    act(() => current.stop());
    act(() =>
      statusHandler({
        runId: "run-1",
        status: "stopped",
        terminalSessionId: 12,
        workspaceId: WORKSPACE_ID,
      }),
    );
    stopped.reject(new Error("late stop failure"));
    await flush();

    expect(current.state.kind).toBe("idle");
    expect(current.pending).toBe(false);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("does not report a late explicit-stop failure into a replacement workspace", async () => {
    const stopped = deferred<void>();
    stopNodeRunTask.mockImplementationOnce(() => stopped.promise);
    render();
    act(() => current.run());
    await flush();

    act(() => current.stop());
    workspaceId = "workspace-b";
    workspaceRoot = "/other";
    currentNow = false;
    render();
    stopped.reject(new Error("old workspace stop failed"));
    await flush();

    expect(reportError).not.toHaveBeenCalled();
  });

  it("stops exactly once when trust is revoked while acknowledgement is pending", async () => {
    const acknowledgement = deferred<void>();
    acknowledgeNodeRunTaskStart.mockImplementationOnce(() => acknowledgement.promise);
    render();
    act(() => current.run());
    await flush();
    expect(acknowledgeNodeRunTaskStart).toHaveBeenCalledOnce();

    workspaceTrusted = false;
    trustedNow = false;
    render();
    acknowledgement.resolve(undefined);
    await flush();

    expect(stopNodeRunTask).toHaveBeenCalledOnce();
    expect(current.state.kind).toBe("idle");
  });

  it("rejects a mismatched start response, skips acknowledgement, and cleans up its requested id", async () => {
    startNodeRunTask.mockResolvedValueOnce({ runId: "foreign-run" });
    render();
    act(() => current.run());
    await flush();

    expect(acknowledgeNodeRunTaskStart).not.toHaveBeenCalled();
    expect(stopNodeRunTask).toHaveBeenCalledWith({ runId: "run-1", workspaceId: WORKSPACE_ID });
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Node run start response lost ownership." }),
    );
  });

  it("drops a late terminal session after a workspace switch without starting", async () => {
    requestTerminalSession = vi.fn((consumer) => {
      terminalConsumer = consumer;
    });
    render();
    act(() => current.run());
    await flush();
    workspaceId = "workspace-b";
    workspaceRoot = "/other";
    render();

    act(() => terminalConsumer(12));
    await flush();
    expect(startNodeRunTask).not.toHaveBeenCalled();
    expect(stopNodeRunTask).not.toHaveBeenCalled();
  });

  it("ignores foreign and late status events", async () => {
    render();
    act(() => current.run());
    await flush();
    act(() => {
      statusHandler({
        runId: "foreign",
        status: "failed",
        message: "foreign",
        terminalSessionId: 12,
        workspaceId: WORKSPACE_ID,
      });
      statusHandler({
        runId: "run-1",
        status: "exited",
        exitCode: 0,
        terminalSessionId: 99,
        workspaceId: WORKSPACE_ID,
      });
    });
    expect(current.state.kind).toBe("running");
    expect(reportError).not.toHaveBeenCalled();

    act(() =>
      statusHandler({
        runId: "run-1",
        status: "exited",
        exitCode: 0,
        terminalSessionId: 12,
        workspaceId: WORKSPACE_ID,
      }),
    );
    expect(current.state).toEqual({ kind: "exited", exitCode: 0 });
  });

  it("does not acknowledge or revive a run that exits before start settles", async () => {
    const start = deferred<{ runId: string }>();
    startNodeRunTask.mockImplementationOnce(() => start.promise);
    render();
    act(() => current.run());
    await flush();

    act(() =>
      statusHandler({
        runId: "run-1",
        status: "exited",
        exitCode: 1,
        terminalSessionId: 12,
        workspaceId: WORKSPACE_ID,
      }),
    );
    start.resolve({ runId: "run-1" });
    await flush();

    expect(current.state).toEqual({ kind: "exited", exitCode: 1 });
    expect(acknowledgeNodeRunTaskStart).not.toHaveBeenCalled();
    expect(stopNodeRunTask).not.toHaveBeenCalled();
  });

  it("warns and fails closed for dirty and PHP documents", () => {
    document = { ...SCRIPT, content: "changed" };
    render();
    act(() => current.run());
    expect(reportWarning).toHaveBeenLastCalledWith(expect.stringContaining("saved"));

    document = documentAt("/workspace/index.php", "php");
    render();
    act(() => current.run());
    expect(reportWarning).toHaveBeenLastCalledWith(expect.stringContaining("PHP"));
    expect(requestTerminalSession).not.toHaveBeenCalled();
  });

  it("requests cleanup for a dispatched run during unmount", async () => {
    render();
    act(() => current.run());
    await flush();
    act(() => root.unmount());

    expect(stopNodeRunTask).toHaveBeenCalledOnce();
    root = createRoot(host);
  });
});

function documentAt(path: string, language = "typescript"): EditorDocument {
  const segments = path.split("/");
  return {
    content: "export {};",
    language,
    name: segments[segments.length - 1] ?? path,
    path,
    savedContent: "export {};",
  };
}

function emptyWorkspace() {
  return {
    readDirectory: vi.fn(async () => []),
    readTextFile: vi.fn(async () => ""),
    readTextFileBounded: vi.fn(async () => ({ status: "ok" as const, content: "" })),
  };
}

function configuredWorkspace(configuration: object) {
  return {
    readDirectory: vi.fn(async (path: string) =>
      path === ROOT
        ? [{ kind: "directory" as const, name: ".codevo", path: `${ROOT}/.codevo` }]
        : [{ kind: "file" as const, name: "launch.json", path: `${ROOT}/.codevo/launch.json` }],
    ),
    readTextFile: vi.fn(async () => ""),
    readTextFileBounded: vi.fn(async () => ({
      status: "ok" as const,
      content: JSON.stringify({ version: 1, configurations: [configuration] }),
    })),
  };
}

function documentNode() {
  const host = window.document.createElement("div");
  window.document.body.append(host);
  return host;
}

async function flush() {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, reject, resolve };
}
