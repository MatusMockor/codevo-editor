// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import type {
  NodeDebugConfigurationLauncher,
  PreparedNodeDebugLaunch,
  UseNodeDebugConfigurationLauncherOptions,
} from "./useNodeDebugConfigurationLauncher";

const mocks = vi.hoisted(() => {
  const configurationLauncher: NodeDebugConfigurationLauncher = {
    busy: false,
    canOpenPicker: vi.fn(() => false),
    choices: [],
    closePicker: vi.fn(),
    load: vi.fn(async () => undefined),
    openPicker: vi.fn(),
    pickerOpen: false,
    refresh: vi.fn(async () => undefined),
    select: vi.fn(),
    selectedName: null,
    startNamed: vi.fn(async () => false),
    startSelected: vi.fn(async () => false),
    state: { kind: "idle" },
  };
  const openDebugPanel = vi.fn();
  const startDebug = vi.fn(async () => undefined);
  const startDebugAccepted = vi.fn(async () => true);
  const startDebugSessionAccepted = vi.fn(async () => 1);
  const startDebugCompoundAccepted = vi.fn(async () => true);
  const restartDebug = vi.fn(async () => undefined);
  const canRestartDebug = vi.fn(() => true);
  const restartPostTask = vi.fn(async () => true);
  const attachNodeDebug = vi.fn(async () => undefined);
  const nodeDebugTaskComposition = {
    canRestartPostTask: vi.fn(() => true),
    cancelServerReadyAction: vi.fn(),
    cancelServerReadyActionForSession: vi.fn(),
    hasPostTaskRestart: vi.fn(() => false),
    isPostTaskActive: vi.fn(() => false),
    isPostTaskBusy: vi.fn(() => false),
    postRestartPending: false,
    postTaskActive: false,
    postTaskBusy: false,
    restartPostTask,
    start: vi.fn(),
  };
  return {
    attachNodeDebug,
    canRestartDebug,
    configurationLauncher,
    nodeDebugTaskComposition,
    openDebugPanel,
    restartDebug,
    restartPostTask,
    startDebug,
    startDebugAccepted,
    startDebugSessionAccepted,
    startDebugCompoundAccepted,
    useConfiguredNodeLaunchStarter: vi.fn(() => vi.fn(async () => false)),
    useNodeDebugConfigurationLauncher: vi.fn(
      (_options: UseNodeDebugConfigurationLauncherOptions) => configurationLauncher,
    ),
    useNodeDebugAttach: vi.fn(),
    useNodeDebugPreLaunchComposition: vi.fn(),
  };
});

vi.mock("./useNodeDebugConfigurationLauncher", async (importOriginal) => ({
  ...(await importOriginal()),
  useNodeDebugConfigurationLauncher: mocks.useNodeDebugConfigurationLauncher,
}));
vi.mock("./useDebugSession", () => ({
  useWorkbenchDebugSession: () => ({
    startDebugCompoundAccepted: mocks.startDebugCompoundAccepted,
    session: {
      breakpoints: [],
      debugAdapterKind: "node",
      evaluate: vi.fn(),
      evaluateWatch: vi.fn(),
      inspectionOwner: null,
      canRestartDebug: mocks.canRestartDebug,
      debugRestartPending: false,
      debugCompoundActive: false,
      disconnectDebug: vi.fn(async () => undefined),
      isDebugStartBlocked: vi.fn(() => false),
      loadVariablePage: vi.fn(),
      output: [],
      restoreBreakpoints: vi.fn(),
      restartDebug: mocks.restartDebug,
      scopes: [],
      selectedFrameId: null,
      selectFrame: vi.fn(),
      snapshot: { lastSeq: 0, state: { kind: "inactive" } },
      startDebug: mocks.startDebug,
      startDebugAccepted: mocks.startDebugAccepted,
      startDebugSessionAccepted: mocks.startDebugSessionAccepted,
      stepDebug: vi.fn(),
      stopDebug: vi.fn(async () => undefined),
      toggleBreakpoint: vi.fn(),
      variablePages: {
        owner: null,
        references: {},
        pendingCount: 0,
        totalVariables: 0,
        totalBytes: 0,
      },
    },
  }),
}));
vi.mock("./useNodeDebugPreLaunchComposition", () => ({
  useNodeDebugPreLaunchComposition: mocks.useNodeDebugPreLaunchComposition,
}));
vi.mock("./useDebugInlineVariableLoading", () => ({
  useDebugInlineVariableLoading: vi.fn(),
}));
vi.mock("./useDebugHoverEvaluation", () => ({
  useDebugHoverEvaluation: () => ({ evaluate: vi.fn(), getOwner: vi.fn() }),
}));
vi.mock("./useDebugWatchExpressions", () => ({ useDebugWatchExpressions: () => ({}) }));
vi.mock("./useDebugConsole", () => ({
  useDebugConsole: () => ({
    clear: vi.fn(),
    state: {
      entries: [],
      history: [],
      nextSequence: 1,
      owner: null,
      pendingRequestIds: [],
      totalBytes: 0,
    },
    submit: vi.fn(),
  }),
}));
vi.mock("./useNodeDebugAttach", () => ({
  useNodeDebugAttach: mocks.useNodeDebugAttach,
}));
vi.mock("./useDebugLocationOpener", () => ({
  useDebugLocationOpener: () => vi.fn(),
  useOpenDebugPanel: () => mocks.openDebugPanel,
}));
vi.mock("./useDebugBreakpointAtCursor", () => ({ useDebugBreakpointAtCursor: () => vi.fn() }));
vi.mock("./useConfiguredNodeLaunchStarter", () => ({
  useConfiguredNodeLaunchStarter: mocks.useConfiguredNodeLaunchStarter,
}));

import {
  isNodeDebugConfigurationWorkspaceCurrent,
  useWorkbenchDebugOrchestration,
} from "./useWorkbenchDebugOrchestration";

describe("workbench named Node debug configuration composition", () => {
  beforeEach(() => {
    mocks.startDebug.mockClear();
    mocks.startDebugAccepted.mockReset().mockResolvedValue(true);
    mocks.startDebugSessionAccepted.mockReset().mockResolvedValue(1);
    mocks.startDebugCompoundAccepted.mockReset().mockResolvedValue(true);
    mocks.restartDebug.mockReset().mockResolvedValue(undefined);
    mocks.canRestartDebug.mockReset().mockReturnValue(true);
    mocks.restartPostTask.mockReset().mockResolvedValue(true);
    mocks.attachNodeDebug.mockReset();
    mocks.nodeDebugTaskComposition.canRestartPostTask.mockReset().mockReturnValue(true);
    mocks.nodeDebugTaskComposition.hasPostTaskRestart.mockReset().mockReturnValue(false);
    mocks.nodeDebugTaskComposition.isPostTaskActive.mockReset().mockReturnValue(false);
    mocks.nodeDebugTaskComposition.isPostTaskBusy.mockReset().mockReturnValue(false);
    mocks.nodeDebugTaskComposition.postRestartPending = false;
    mocks.nodeDebugTaskComposition.postTaskActive = false;
    mocks.nodeDebugTaskComposition.postTaskBusy = false;
    mocks.nodeDebugTaskComposition.start.mockReset();
    mocks.useNodeDebugPreLaunchComposition.mockImplementation(
      (options: {
        startDebug: (launch: PreparedNodeDebugLaunch["launch"]) => Promise<number | null>;
      }) => {
        mocks.nodeDebugTaskComposition.start.mockImplementation(
          async (prepared: PreparedNodeDebugLaunch) =>
            Boolean(await options.startDebug(prepared.launch)),
        );
        return mocks.nodeDebugTaskComposition;
      },
    );
    mocks.useNodeDebugAttach.mockImplementation(
      (options: {
        isDebugSessionBusy: () => boolean;
        startDebug: (launch: { kind: "node-attach"; port: number }) => Promise<void>;
      }) => {
        mocks.attachNodeDebug.mockImplementation(async () => {
          if (options.isDebugSessionBusy()) return;
          await options.startDebug({ kind: "node-attach", port: 9229 });
        });
        return mocks.attachNodeDebug;
      },
    );
  });

  it("exposes the application launcher with bound reactive read ports", async () => {
    const root = createRoot(document.createElement("div"));
    const workspaceReads = new ReceiverSensitiveWorkspaceReads();
    const isWorkspaceCurrent = vi.fn(() => true);
    const isWorkspaceTrusted = vi.fn(() => true);
    const serverReadyExternalUrlOpener = { openExternal: vi.fn(async () => undefined) };
    let result: ReturnType<typeof useWorkbenchDebugOrchestration> | null = null;
    function Harness() {
      result = useWorkbenchDebugOrchestration({
        activeDocumentRef: { current: null },
        activeEditorPositionRef: { current: null },
        currentWorkspaceRootRef: { current: "/workspace" },
        debugTextClipboard: null,
        debugGateway: { subscribe: vi.fn(() => vi.fn()) } as never,
        hasJavaScriptTypeScriptWorkspace: () => true,
        isActiveDocumentJsTest: false,
        isActiveDocumentPhpTest: false,
        isWorkspaceCurrent,
        isWorkspaceTrusted,
        nodeLaunchConfigurationVersion: 0,
        openNavigationTarget: vi.fn() as never,
        prompter: { prompt: vi.fn() },
        readTestFileIfExists: vi.fn(async () => null),
        reportWarning: vi.fn(),
        serverReadyExternalUrlOpener,
        setBottomPanelView: vi.fn(),
        setBottomPanelVisible: vi.fn(),
        workspaceFiles: workspaceReads,
        workspaceId: "workspace-id",
        workspaceRoot: "/workspace",
        vscodeProcessTasks: {} as never,
      });
      return null;
    }

    act(() => root.render(<Harness />));

    expect(result!.debugSession.configurationLauncher).toBe(mocks.configurationLauncher);
    expect(mocks.useNodeDebugPreLaunchComposition.mock.lastCall?.[0]).toMatchObject({
      serverReadyExternalUrlOpener,
    });
    expect(mocks.useConfiguredNodeLaunchStarter).toHaveBeenLastCalledWith({
      getActiveDocumentPath: expect.any(Function),
      isDebugStartBlocked: expect.any(Function),
      isWorkspaceCurrent,
      isWorkspaceTrusted: expect.any(Function),
      openDebugPanel: mocks.openDebugPanel,
      reportWarning: expect.any(Function),
      startDebug: expect.any(Function),
      workspaceFiles: workspaceReads,
    });
    expect(mocks.useNodeDebugConfigurationLauncher).toHaveBeenLastCalledWith({
      configurationVersion: 0,
      coordinator: undefined,
      debugStartBlocked: false,
      isDebugStartBlocked: expect.any(Function),
      isDocumentClean: expect.any(Function),
      isWorkspaceCurrent,
      isWorkspaceTrusted: expect.any(Function),
      openDebugPanel: mocks.openDebugPanel,
      rootPath: "/workspace",
      startDebug: expect.any(Function),
      workspaceId: "workspace-id",
      workspaceReads: {
        readDirectory: expect.any(Function),
        readFile: expect.any(Function),
        readFileBounded: expect.any(Function),
      },
      workspaceTrusted: true,
    });
    const firstReads = mocks.useNodeDebugConfigurationLauncher.mock.lastCall![0].workspaceReads;
    await expect(firstReads.readDirectory("/workspace")).resolves.toEqual([]);
    await expect(firstReads.readFile("/workspace/.vscode/launch.json")).resolves.toBe("{}");
    await expect(
      firstReads.readFileBounded?.("/workspace/.vscode/launch.json", 262_144),
    ).resolves.toEqual({ status: "ok", content: "{}" });
    expect(workspaceReads.calls).toEqual([
      ["directory", "/workspace"],
      ["file", "/workspace/.vscode/launch.json"],
      ["bounded", "/workspace/.vscode/launch.json", 262_144],
    ]);
    act(() => root.render(<Harness />));
    expect(mocks.useNodeDebugConfigurationLauncher.mock.lastCall![0].workspaceReads).toBe(
      firstReads,
    );
    act(() => root.unmount());
  });

  it("supplies a fail-closed opener when the host does not inject one", async () => {
    const root = createRoot(document.createElement("div"));
    function Harness() {
      useWorkbenchDebugOrchestration({
        activeDocumentRef: { current: null },
        activeEditorPositionRef: { current: null },
        currentWorkspaceRootRef: { current: "/workspace" },
        debugGateway: { subscribe: vi.fn(() => vi.fn()) } as never,
        hasJavaScriptTypeScriptWorkspace: () => true,
        isActiveDocumentJsTest: false,
        isActiveDocumentPhpTest: false,
        isWorkspaceCurrent: () => true,
        isWorkspaceTrusted: () => true,
        nodeLaunchConfigurationVersion: 0,
        openNavigationTarget: vi.fn() as never,
        prompter: { prompt: vi.fn() },
        readTestFileIfExists: vi.fn(async () => null),
        reportWarning: vi.fn(),
        setBottomPanelView: vi.fn(),
        setBottomPanelVisible: vi.fn(),
        workspaceFiles: {
          readDirectory: vi.fn(),
          readTextFile: vi.fn(),
          readTextFileBounded: vi.fn(),
        },
        workspaceId: "workspace-id",
        workspaceRoot: "/workspace",
        vscodeProcessTasks: {} as never,
      });
      return null;
    }

    act(() => root.render(<Harness />));
    const fallback =
      mocks.useNodeDebugPreLaunchComposition.mock.lastCall?.[0].serverReadyExternalUrlOpener;
    await expect(fallback?.openExternal("http://localhost:3000/" as never)).rejects.toThrow(
      "Server ready URL opener is unavailable.",
    );
    act(() => root.unmount());
  });

  it("matches both current execution root and admitted workspace identity", () => {
    const owner = createWorkspaceRuntimeOwner("workspace-id", "/workspace/project");
    expect(
      isNodeDebugConfigurationWorkspaceCurrent(
        "/workspace/project/",
        owner,
        "/workspace/project",
        "workspace-id",
      ),
    ).toBe(true);
    expect(
      isNodeDebugConfigurationWorkspaceCurrent(
        "/other",
        owner,
        "/workspace/project",
        "workspace-id",
      ),
    ).toBe(false);
    expect(
      isNodeDebugConfigurationWorkspaceCurrent(
        "/workspace/project",
        owner,
        "/workspace/project",
        "replacement-id",
      ),
    ).toBe(false);
    expect(
      isNodeDebugConfigurationWorkspaceCurrent(
        "/workspace/project",
        createWorkspaceRuntimeOwner("workspace-id", "/replacement"),
        "/workspace/project",
        "workspace-id",
      ),
    ).toBe(false);
    expect(
      isNodeDebugConfigurationWorkspaceCurrent(
        "/workspace/project",
        null,
        "/workspace/project",
        "workspace-id",
      ),
    ).toBe(false);
  });

  it("holds one global start admission through configured async start acceptance", async () => {
    mocks.startDebugAccepted.mockClear();
    mocks.startDebugSessionAccepted.mockClear();
    const accepted = deferred<number>();
    mocks.startDebugSessionAccepted.mockReturnValueOnce(accepted.promise);
    const root = createRoot(document.createElement("div"));
    let result: ReturnType<typeof useWorkbenchDebugOrchestration> | null = null;
    function Harness() {
      result = useWorkbenchDebugOrchestration({
        activeDocumentRef: { current: null },
        activeEditorPositionRef: { current: null },
        currentWorkspaceRootRef: { current: "/workspace" },
        debugTextClipboard: null,
        debugGateway: { subscribe: vi.fn(() => vi.fn()) } as never,
        hasJavaScriptTypeScriptWorkspace: () => true,
        isActiveDocumentJsTest: false,
        isActiveDocumentPhpTest: false,
        isWorkspaceCurrent: () => true,
        isWorkspaceTrusted: () => true,
        nodeLaunchConfigurationVersion: 0,
        openNavigationTarget: vi.fn() as never,
        prompter: { prompt: vi.fn() },
        readTestFileIfExists: vi.fn(async () => null),
        reportWarning: vi.fn(),
        setBottomPanelView: vi.fn(),
        setBottomPanelVisible: vi.fn(),
        workspaceFiles: {
          readDirectory: vi.fn(),
          readTextFile: vi.fn(),
          readTextFileBounded: vi.fn(),
        },
        workspaceId: "workspace-id",
        workspaceRoot: "/workspace",
        vscodeProcessTasks: {} as never,
      });
      return null;
    }
    act(() => root.render(<Harness />));
    const configuredStart = mocks.useNodeDebugConfigurationLauncher.mock.lastCall![0].startDebug;
    const configured = configuredStart({
      launch: { kind: "node-script", scriptPath: "/workspace/api.js" },
      preLaunchTask: null,
    });
    await act(async () => Promise.resolve());

    await expect(
      result!.debugSession.startDebugAccepted({
        kind: "node-script",
        scriptPath: "/workspace/other.js",
      }),
    ).resolves.toBe(false);
    expect(mocks.startDebugAccepted).not.toHaveBeenCalled();

    accepted.resolve(7);
    await expect(configured).resolves.toBe(true);
    act(() => root.unmount());
  });

  it("holds the same global admission through compound batch acceptance", async () => {
    const accepted = deferred<boolean>();
    mocks.startDebugCompoundAccepted.mockReturnValueOnce(accepted.promise);
    const root = createRoot(document.createElement("div"));
    let result: ReturnType<typeof useWorkbenchDebugOrchestration> | null = null;
    function Harness() {
      result = useWorkbenchDebugOrchestration({
        activeDocumentRef: { current: null },
        activeEditorPositionRef: { current: null },
        currentWorkspaceRootRef: { current: "/workspace" },
        debugTextClipboard: null,
        debugGateway: {
          startCompound: vi.fn(),
          subscribe: vi.fn(() => vi.fn()),
        } as never,
        hasJavaScriptTypeScriptWorkspace: () => true,
        isActiveDocumentJsTest: false,
        isActiveDocumentPhpTest: false,
        isWorkspaceCurrent: () => true,
        isWorkspaceTrusted: () => true,
        nodeLaunchConfigurationVersion: 0,
        openNavigationTarget: vi.fn() as never,
        prompter: { prompt: vi.fn() },
        readTestFileIfExists: vi.fn(async () => null),
        reportWarning: vi.fn(),
        setBottomPanelView: vi.fn(),
        setBottomPanelVisible: vi.fn(),
        workspaceFiles: {
          readDirectory: vi.fn(),
          readTextFile: vi.fn(),
          readTextFileBounded: vi.fn(),
        },
        workspaceId: "workspace-id",
        workspaceRoot: "/workspace",
        vscodeProcessTasks: {} as never,
      });
      return null;
    }
    act(() => root.render(<Harness />));
    const compoundStart =
      mocks.useNodeDebugConfigurationLauncher.mock.lastCall![0].startCompoundDebug!;
    const running = compoundStart({
      kind: "compound",
      members: [
        {
          launch: { kind: "node-script", scriptPath: "/workspace/api.js" },
          preLaunchTask: null,
        },
        {
          launch: { kind: "node-script", scriptPath: "/workspace/worker.js" },
          preLaunchTask: null,
        },
      ],
      name: "API + worker",
      preLaunchTask: null,
    });
    await act(async () => Promise.resolve());

    await expect(
      result!.debugSession.startDebugAccepted({
        kind: "node-script",
        scriptPath: "/workspace/other.js",
      }),
    ).resolves.toBe(false);
    expect(mocks.startDebugAccepted).not.toHaveBeenCalled();
    await act(async () => result!.debugSession.restartDebug());
    expect(mocks.restartDebug).not.toHaveBeenCalled();

    accepted.resolve(true);
    await expect(running).resolves.toBe(true);
    expect(mocks.startDebugCompoundAccepted).toHaveBeenCalledOnce();
    expect(mocks.nodeDebugTaskComposition.start).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("selects the retained post-task restart without falling through to generic restart", async () => {
    mocks.nodeDebugTaskComposition.hasPostTaskRestart.mockReturnValue(true);
    const ui = renderOrchestration();

    await act(async () => ui.result().debugSession.restartDebug());

    expect(mocks.restartPostTask).toHaveBeenCalledOnce();
    expect(mocks.restartDebug).not.toHaveBeenCalled();
    ui.unmount();
  });

  it.each([
    ["the exact post-task owner is stale", true, false, true],
    ["the underlying debug session is ineligible", true, true, false],
    ["the generic debug session is ineligible", false, true, false],
  ])(
    "keeps the restart command inert when %s",
    async (_name, hasPostTask, canRestartPostTask, canRestartSession) => {
      mocks.nodeDebugTaskComposition.hasPostTaskRestart.mockReturnValue(hasPostTask);
      mocks.nodeDebugTaskComposition.canRestartPostTask.mockReturnValue(canRestartPostTask);
      mocks.canRestartDebug.mockReturnValue(canRestartSession);
      const ui = renderOrchestration();

      expect(ui.result().debugSession.canRestartDebug()).toBe(false);
      await act(async () => ui.result().debugSession.restartDebug());

      expect(mocks.restartPostTask).not.toHaveBeenCalled();
      expect(mocks.restartDebug).not.toHaveBeenCalled();
      ui.unmount();
    },
  );

  it("blocks competing starts, attach, test debug, and a second restart while post restart is pending", async () => {
    mocks.nodeDebugTaskComposition.hasPostTaskRestart.mockReturnValue(true);
    const restart = deferred<boolean>();
    mocks.restartPostTask.mockReturnValueOnce(restart.promise);
    const ui = renderOrchestration();

    let firstRestart!: Promise<void>;
    act(() => {
      firstRestart = ui.result().debugSession.restartDebug();
    });
    await act(async () => Promise.resolve());
    expect(mocks.restartPostTask).toHaveBeenCalledOnce();

    mocks.nodeDebugTaskComposition.postRestartPending = true;
    mocks.nodeDebugTaskComposition.isPostTaskActive.mockReturnValue(true);
    ui.rerender();

    await expect(
      ui.result().debugSession.startDebugAccepted({
        kind: "node-script",
        scriptPath: "/workspace/other.js",
      }),
    ).resolves.toBe(false);
    await act(async () => ui.result().attachNodeDebug());
    await act(async () =>
      ui.result().debugSession.startDebug({
        kind: "js-test-file",
        runner: "vitest",
        filePath: "/workspace/api.test.ts",
        packageRootPath: "/workspace",
      }),
    );
    await act(async () => ui.result().debugSession.restartDebug());

    expect(ui.result().debugSession).not.toHaveProperty("startDebugCompoundAccepted");
    expect(mocks.startDebugCompoundAccepted).not.toHaveBeenCalled();
    expect(mocks.startDebugAccepted).not.toHaveBeenCalled();
    expect(mocks.startDebug).not.toHaveBeenCalled();
    expect(mocks.restartPostTask).toHaveBeenCalledOnce();
    expect(mocks.restartDebug).not.toHaveBeenCalled();

    mocks.nodeDebugTaskComposition.postRestartPending = false;
    mocks.nodeDebugTaskComposition.isPostTaskActive.mockReturnValue(false);
    restart.resolve(true);
    await act(async () => firstRestart);
    ui.unmount();
  });
});

function renderOrchestration() {
  const root = createRoot(document.createElement("div"));
  let result: ReturnType<typeof useWorkbenchDebugOrchestration> | null = null;
  function Harness() {
    result = useWorkbenchDebugOrchestration({
      activeDocumentRef: { current: null },
      activeEditorPositionRef: { current: null },
      currentWorkspaceRootRef: { current: "/workspace" },
      debugTextClipboard: null,
      debugGateway: { subscribe: vi.fn(() => vi.fn()) } as never,
      hasJavaScriptTypeScriptWorkspace: () => true,
      isActiveDocumentJsTest: false,
      isActiveDocumentPhpTest: false,
      isWorkspaceCurrent: () => true,
      isWorkspaceTrusted: () => true,
      nodeLaunchConfigurationVersion: 0,
      openNavigationTarget: vi.fn() as never,
      prompter: { prompt: vi.fn() },
      readTestFileIfExists: vi.fn(async () => null),
      reportWarning: vi.fn(),
      setBottomPanelView: vi.fn(),
      setBottomPanelVisible: vi.fn(),
      workspaceFiles: {
        readDirectory: vi.fn(),
        readTextFile: vi.fn(),
        readTextFileBounded: vi.fn(),
      },
      workspaceId: "workspace-id",
      workspaceRoot: "/workspace",
      vscodeProcessTasks: {} as never,
    });
    return null;
  }
  act(() => root.render(<Harness />));
  return {
    result: () => {
      if (!result) throw new Error("orchestration was not rendered");
      return result;
    },
    rerender: () => act(() => root.render(<Harness />)),
    unmount: () => act(() => root.unmount()),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

class ReceiverSensitiveWorkspaceReads {
  readonly calls: unknown[][] = [];
  readonly #receiver = "workspace-reads";

  async readDirectory(path: string) {
    this.assertReceiver();
    this.calls.push(["directory", path]);
    return [];
  }

  async readTextFile(path: string) {
    this.assertReceiver();
    this.calls.push(["file", path]);
    return "{}";
  }

  async readTextFileBounded(path: string, maxBytes: number) {
    this.assertReceiver();
    this.calls.push(["bounded", path, maxBytes]);
    return { status: "ok" as const, content: "{}" };
  }

  private assertReceiver() {
    if (this.#receiver !== "workspace-reads") {
      throw new Error("Workspace read method lost its receiver.");
    }
  }
}
