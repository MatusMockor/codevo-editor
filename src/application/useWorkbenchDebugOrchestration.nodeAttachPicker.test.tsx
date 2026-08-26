// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeDebugAttachCandidateListGateway } from "./useNodeDebugAttachProcessPicker";

const LEASE_ID = "0123456789abcdef0123456789abcdef";

const mocks = vi.hoisted(() => {
  const openDebugPanel = vi.fn();
  const startDebug = vi.fn(async () => undefined);
  const startDebugAccepted = vi.fn(async () => true);
  const startDebugSessionAccepted = vi.fn(async () => 1);
  const startNodeAttachCandidateAccepted = vi.fn(async () => 47 as number | null);
  const isDebugStartBlocked = vi.fn(() => false);
  const compound = {
    busy: false,
    isBusy: vi.fn(() => false),
    start: vi.fn(async () => false),
  };
  const preLaunch = {
    canRestartPostTask: vi.fn(() => false),
    cancelServerReadyAction: vi.fn(),
    cancelServerReadyActionForSession: vi.fn(),
    hasPostTaskRestart: vi.fn(() => false),
    isPostTaskActive: vi.fn(() => false),
    postRestartPending: false,
    start: vi.fn(async () => false),
  };
  const session = {
    breakpoints: [],
    canRestartDebug: vi.fn(() => false),
    completeDebugConsole: vi.fn(),
    debugAdapterKind: "node",
    debugCompoundActive: false,
    debugInspectionRevision: 0,
    debugRestartPending: false,
    disconnectDebug: vi.fn(async () => undefined),
    disconnectExactDebugSession: vi.fn(async () => false),
    evaluate: vi.fn(),
    evaluateWatch: vi.fn(),
    inspectionOwner: null,
    isDebugStartBlocked,
    loadVariablePage: vi.fn(),
    output: [],
    pauseOwner: null,
    restoreBreakpoints: vi.fn(),
    restartDebug: vi.fn(async () => undefined),
    scopes: [],
    selectedFrameId: null,
    selectFrame: vi.fn(),
    snapshot: { lastSeq: 0, state: { kind: "inactive" } },
    startDebug,
    startDebugAccepted,
    startDebugSessionAccepted,
    stepDebug: vi.fn(),
    stopDebug: vi.fn(async () => undefined),
    stopExactDebugSession: vi.fn(async () => false),
    toggleBreakpoint: vi.fn(),
    variablePages: {
      owner: null,
      references: {},
      pendingCount: 0,
      totalBytes: 0,
      totalVariables: 0,
    },
  };
  return {
    compound,
    isDebugStartBlocked,
    openDebugPanel,
    preLaunch,
    session,
    startDebug,
    startDebugAccepted,
    startDebugSessionAccepted,
    startNodeAttachCandidateAccepted,
  };
});

vi.mock("./useDebugSession", () => ({
  useWorkbenchDebugSession: () => ({
    session: mocks.session,
    startDebugCompoundAccepted: vi.fn(async () => ({ kind: "rejected" as const })),
    startNodeAttachCandidateAccepted: mocks.startNodeAttachCandidateAccepted,
  }),
}));
vi.mock("./useDebugLocationOpener", () => ({
  useDebugLocationOpener: () => vi.fn(),
  useOpenDebugPanel: () => mocks.openDebugPanel,
}));
vi.mock("./useNodeDebugPreLaunchComposition", () => ({
  useNodeDebugPreLaunchComposition: () => mocks.preLaunch,
}));
vi.mock("./useNodeDebugCompoundComposition", () => ({
  useNodeDebugCompoundComposition: () => mocks.compound,
}));
vi.mock("./useNodeDebugConfigurationLauncher", () => ({
  useNodeDebugConfigurationLauncher: () => ({
    busy: false,
    canOpenPicker: vi.fn(() => false),
    choices: [],
    closePicker: vi.fn(),
    load: vi.fn(),
    openPicker: vi.fn(),
    pickerOpen: false,
    refresh: vi.fn(),
    select: vi.fn(),
    selectedName: null,
    startNamed: vi.fn(),
    startSelected: vi.fn(),
    state: { kind: "idle" },
  }),
}));
vi.mock("./useConfiguredNodeLaunchStarter", () => ({
  useConfiguredNodeLaunchStarter: () => vi.fn(async () => false),
}));
vi.mock("./useDebugBreakpointAtCursor", () => ({ useDebugBreakpointAtCursor: () => vi.fn() }));
vi.mock("./useDebugCopyStackTrace", () => ({ useDebugCopyStackTrace: () => vi.fn() }));
vi.mock("./useDebugHoverEvaluation", () => ({
  useDebugHoverEvaluation: () => ({ evaluate: vi.fn(), getOwner: vi.fn() }),
}));
vi.mock("./useDebugInlineVariableLoading", () => ({ useDebugInlineVariableLoading: vi.fn() }));
vi.mock("./useDebugRunToCursor", () => ({ useDebugRunToCursor: () => ({ runToCursor: vi.fn() }) }));
vi.mock("./useDebugWatchExpressions", () => ({
  useDebugWatchExpressions: () => ({ definitions: [], evaluations: [] }),
}));
vi.mock("./useDebugWatchExpressionMutations", () => ({
  useDebugWatchExpressionMutations: () => ({ forWatch: vi.fn() }),
}));
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
vi.mock("./useDebugConsoleCompletions", () => ({
  useDebugConsoleCompletions: () => ({
    accept: vi.fn(),
    dismiss: vi.fn(),
    inputChanged: vi.fn(),
    model: { incomplete: false, items: [], pending: false, unavailable: null },
    request: vi.fn(),
  }),
}));
vi.mock("./useDebugConsoleSurfaceCommands", () => ({
  useDebugConsoleSurfaceCommands: () => ({ clear: vi.fn(), submit: vi.fn() }),
}));

import { useWorkbenchDebugOrchestration } from "./useWorkbenchDebugOrchestration";

interface HarnessOptions {
  readonly candidateGateway: NodeDebugAttachCandidateListGateway;
  readonly debugGatewayStart: ReturnType<typeof vi.fn>;
  readonly hasJavaScriptTypeScriptWorkspace: () => boolean;
  readonly isWorkspaceTrusted: () => boolean;
  readonly prompt: (message: string, defaultValue?: string) => string | null;
  readonly rootRef: { current: string | null };
  readonly workspaceRoot: string | null;
}

function renderOrchestration(initial: HarnessOptions) {
  const root = createRoot(document.createElement("div"));
  let options = initial;
  let value: ReturnType<typeof useWorkbenchDebugOrchestration> | null = null;

  function Harness() {
    value = useWorkbenchDebugOrchestration({
      activeDocumentRef: { current: null },
      activeEditorPositionRef: { current: null },
      captureDocumentDebugAuthority: () => ({ isCurrent: () => true }),
      currentWorkspaceRootRef: options.rootRef,
      debugGateway: {
        start: options.debugGatewayStart,
        subscribe: vi.fn(() => vi.fn()),
      } as never,
      hasJavaScriptTypeScriptWorkspace: options.hasJavaScriptTypeScriptWorkspace,
      isActiveDocumentJsTest: false,
      isActiveDocumentPhpTest: false,
      isWorkspaceCurrent: (rootPath, workspaceId) =>
        rootPath === options.rootRef.current && workspaceId === "owner-1",
      isWorkspaceTrusted: options.isWorkspaceTrusted,
      nodeDebugAttachCandidateGateway: options.candidateGateway,
      nodeLaunchConfigurationVersion: 0,
      openNavigationTarget: vi.fn() as never,
      prompter: { prompt: options.prompt },
      readTestFileIfExists: vi.fn(async () => null),
      reportWarning: vi.fn(),
      setBottomPanelView: vi.fn(),
      setBottomPanelVisible: vi.fn(),
      workspaceFiles: {
        readDirectory: vi.fn(),
        readTextFile: vi.fn(),
        readTextFileBounded: vi.fn(),
      },
      workspaceId: "owner-1",
      workspaceRoot: options.workspaceRoot,
      vscodeProcessTasks: {} as never,
    });
    return null;
  }

  const render = () => act(() => root.render(<Harness />));
  render();
  return {
    result: () => {
      expect(value).not.toBeNull();
      return value!;
    },
    set(next: Partial<HarnessOptions>) {
      options = { ...options, ...next };
      render();
    },
    unmount: () => act(() => root.unmount()),
  };
}

function candidateGateway() {
  return {
    list: vi.fn<NodeDebugAttachCandidateListGateway["list"]>().mockResolvedValue({
      status: "ok",
      candidates: [
        {
          candidateLeaseId: LEASE_ID,
          label: "node api.js",
          detail: "api.js --inspect",
          port: 9229,
        },
      ],
      truncated: false,
    }),
  };
}

async function openAndList(ui: ReturnType<typeof renderOrchestration>) {
  act(() => ui.result().attachNodeDebug());
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("workbench Node attach process picker integration", () => {
  beforeEach(() => {
    mocks.isDebugStartBlocked.mockReset().mockReturnValue(false);
    mocks.openDebugPanel.mockClear();
    mocks.startDebug.mockReset().mockResolvedValue(undefined);
    mocks.startDebugAccepted.mockReset().mockResolvedValue(true);
    mocks.startDebugSessionAccepted.mockReset().mockResolvedValue(1);
    mocks.startNodeAttachCandidateAccepted.mockReset().mockResolvedValue(47);
    mocks.compound.isBusy.mockReset().mockReturnValue(false);
    mocks.preLaunch.isPostTaskActive.mockReset().mockReturnValue(false);
  });

  it("lists only an eligible workspace and projects no lease capability", async () => {
    const gateway = candidateGateway();
    const rootRef = { current: "/workspace" as string | null };
    const ui = renderOrchestration({
      candidateGateway: gateway,
      debugGatewayStart: vi.fn(),
      hasJavaScriptTypeScriptWorkspace: () => true,
      isWorkspaceTrusted: () => true,
      prompt: vi.fn(),
      rootRef,
      workspaceRoot: "/workspace",
    });

    await openAndList(ui);

    expect(gateway.list).toHaveBeenCalledExactlyOnceWith("/workspace");
    expect(ui.result().nodeDebugAttachProcessPicker.isOpen).toBe(true);
    expect(ui.result().nodeDebugAttachProcessPicker.result?.status).toBe("ok");
    expect(JSON.stringify(ui.result().nodeDebugAttachProcessPicker.result)).not.toContain(LEASE_ID);
    ui.unmount();
  });

  it.each([
    ["untrusted", () => false, () => true, "/workspace"],
    ["non-JS", () => true, () => false, "/workspace"],
    ["missing root", () => true, () => true, null],
  ])("does not list an %s workspace", async (_name, trusted, hasJs, workspaceRoot) => {
    const gateway = candidateGateway();
    const ui = renderOrchestration({
      candidateGateway: gateway,
      debugGatewayStart: vi.fn(),
      hasJavaScriptTypeScriptWorkspace: hasJs,
      isWorkspaceTrusted: trusted,
      prompt: vi.fn(),
      rootRef: { current: workspaceRoot },
      workspaceRoot,
    });

    await openAndList(ui);

    expect(gateway.list).not.toHaveBeenCalled();
    expect(ui.result().nodeDebugAttachProcessPicker.isOpen).toBe(false);
    ui.unmount();
  });

  it("selects the exact hidden lease through the global gate without legacy attach", async () => {
    const gateway = candidateGateway();
    const debugGatewayStart = vi.fn();
    const prompt = vi.fn();
    const ui = renderOrchestration({
      candidateGateway: gateway,
      debugGatewayStart,
      hasJavaScriptTypeScriptWorkspace: () => true,
      isWorkspaceTrusted: () => true,
      prompt,
      rootRef: { current: "/workspace" },
      workspaceRoot: "/workspace",
    });
    await openAndList(ui);
    const result = ui.result().nodeDebugAttachProcessPicker.result;
    expect(result?.status).toBe("ok");
    const presentationId = result?.status === "ok" ? result.candidates[0]!.presentationId : "";

    await act(async () => {
      await ui.result().nodeDebugAttachProcessPicker.selectCandidate(presentationId);
    });

    expect(mocks.startNodeAttachCandidateAccepted).toHaveBeenCalledExactlyOnceWith(LEASE_ID);
    expect(mocks.openDebugPanel).toHaveBeenCalledTimes(1);
    expect(debugGatewayStart).not.toHaveBeenCalled();
    expect(mocks.startDebug).not.toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
    expect(ui.result().nodeDebugAttachProcessPicker.isOpen).toBe(false);
    ui.unmount();
  });

  it("closes the picker and delegates Attach by port to the legacy manual flow", async () => {
    const gateway = candidateGateway();
    const prompt = vi.fn(() => "9230");
    const ui = renderOrchestration({
      candidateGateway: gateway,
      debugGatewayStart: vi.fn(),
      hasJavaScriptTypeScriptWorkspace: () => true,
      isWorkspaceTrusted: () => true,
      prompt,
      rootRef: { current: "/workspace" },
      workspaceRoot: "/workspace",
    });
    await openAndList(ui);

    act(() => ui.result().nodeDebugAttachProcessPicker.attachByPort());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ui.result().nodeDebugAttachProcessPicker.isOpen).toBe(false);
    expect(prompt).toHaveBeenCalledExactlyOnceWith("Node inspector port", "9229");
    expect(mocks.startDebug).toHaveBeenCalledExactlyOnceWith({ kind: "node-attach", port: 9230 });
    expect(mocks.startNodeAttachCandidateAccepted).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("fails closed when busy, trust, or root ownership drifts", async () => {
    const gateway = candidateGateway();
    let trusted = true;
    const rootRef = { current: "/workspace" as string | null };
    const ui = renderOrchestration({
      candidateGateway: gateway,
      debugGatewayStart: vi.fn(),
      hasJavaScriptTypeScriptWorkspace: () => true,
      isWorkspaceTrusted: () => trusted,
      prompt: vi.fn(),
      rootRef,
      workspaceRoot: "/workspace",
    });

    mocks.isDebugStartBlocked.mockReturnValue(true);
    await openAndList(ui);
    expect(gateway.list).not.toHaveBeenCalled();

    mocks.isDebugStartBlocked.mockReturnValue(false);
    await openAndList(ui);
    const first = ui.result().nodeDebugAttachProcessPicker.result;
    const firstId = first?.status === "ok" ? first.candidates[0]!.presentationId : "";
    rootRef.current = "/other";
    await act(async () => {
      await ui.result().nodeDebugAttachProcessPicker.selectCandidate(firstId);
    });
    expect(mocks.startNodeAttachCandidateAccepted).not.toHaveBeenCalled();
    expect(mocks.openDebugPanel).not.toHaveBeenCalled();

    rootRef.current = "/workspace";
    await openAndList(ui);
    const second = ui.result().nodeDebugAttachProcessPicker.result;
    const secondId = second?.status === "ok" ? second.candidates[0]!.presentationId : "";
    trusted = false;
    ui.set({ isWorkspaceTrusted: () => trusted });
    expect(ui.result().nodeDebugAttachProcessPicker.isOpen).toBe(false);
    const callsBefore = mocks.startNodeAttachCandidateAccepted.mock.calls.length;
    await act(async () => {
      await ui.result().nodeDebugAttachProcessPicker.selectCandidate(secondId);
    });
    expect(mocks.startNodeAttachCandidateAccepted).toHaveBeenCalledTimes(callsBefore);
    ui.unmount();
  });

  it("invalidates settled and pending picker capabilities when debug becomes busy", async () => {
    const lateList = deferred<Awaited<ReturnType<NodeDebugAttachCandidateListGateway["list"]>>>();
    const gateway = candidateGateway();
    gateway.list
      .mockResolvedValueOnce({
        status: "ok",
        candidates: [
          {
            candidateLeaseId: LEASE_ID,
            label: "node api.js",
            detail: "api.js --inspect",
            port: 9229,
          },
        ],
        truncated: false,
      })
      .mockReturnValueOnce(lateList.promise);
    const ui = renderOrchestration({
      candidateGateway: gateway,
      debugGatewayStart: vi.fn(),
      hasJavaScriptTypeScriptWorkspace: () => true,
      isWorkspaceTrusted: () => true,
      prompt: vi.fn(),
      rootRef: { current: "/workspace" },
      workspaceRoot: "/workspace",
    });

    await openAndList(ui);
    const settled = ui.result().nodeDebugAttachProcessPicker.result;
    const stalePresentationId =
      settled?.status === "ok" ? settled.candidates[0]!.presentationId : "";

    mocks.isDebugStartBlocked.mockReturnValue(true);
    ui.set({ workspaceRoot: "/workspace" });
    expect(ui.result().nodeDebugAttachProcessPicker.isOpen).toBe(false);
    expect(ui.result().nodeDebugAttachProcessPicker.result).toBeNull();
    await act(async () => {
      await ui.result().nodeDebugAttachProcessPicker.selectCandidate(stalePresentationId);
    });
    expect(mocks.startNodeAttachCandidateAccepted).not.toHaveBeenCalled();

    mocks.isDebugStartBlocked.mockReturnValue(false);
    ui.set({ workspaceRoot: "/workspace" });
    act(() => ui.result().attachNodeDebug());
    await act(async () => {
      await Promise.resolve();
    });
    expect(gateway.list).toHaveBeenCalledTimes(2);
    expect(ui.result().nodeDebugAttachProcessPicker.isOpen).toBe(true);

    mocks.isDebugStartBlocked.mockReturnValue(true);
    ui.set({ workspaceRoot: "/workspace" });
    expect(ui.result().nodeDebugAttachProcessPicker.isOpen).toBe(false);
    expect(ui.result().nodeDebugAttachProcessPicker.result).toBeNull();

    await act(async () => {
      lateList.resolve({
        status: "ok",
        candidates: [
          {
            candidateLeaseId: "fedcba9876543210fedcba9876543210",
            label: "node worker.js",
            detail: "worker.js --inspect",
            port: 9230,
          },
        ],
        truncated: false,
      });
      await lateList.promise;
      await Promise.resolve();
    });
    expect(ui.result().nodeDebugAttachProcessPicker.result).toBeNull();

    await act(async () => {
      await ui.result().nodeDebugAttachProcessPicker.selectCandidate(stalePresentationId);
    });
    expect(mocks.startNodeAttachCandidateAccepted).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("holds the global start gate while exact candidate adoption is pending", async () => {
    const gateway = candidateGateway();
    let resolveCandidate!: (value: number | null) => void;
    mocks.startNodeAttachCandidateAccepted.mockImplementationOnce(
      () =>
        new Promise<number | null>((resolve) => {
          resolveCandidate = resolve;
        }),
    );
    const ui = renderOrchestration({
      candidateGateway: gateway,
      debugGatewayStart: vi.fn(),
      hasJavaScriptTypeScriptWorkspace: () => true,
      isWorkspaceTrusted: () => true,
      prompt: vi.fn(),
      rootRef: { current: "/workspace" },
      workspaceRoot: "/workspace",
    });
    await openAndList(ui);
    const result = ui.result().nodeDebugAttachProcessPicker.result;
    const presentationId = result?.status === "ok" ? result.candidates[0]!.presentationId : "";
    let selecting!: Promise<void>;
    act(() => {
      selecting = ui.result().nodeDebugAttachProcessPicker.selectCandidate(presentationId);
    });

    await act(async () => {
      expect(
        await ui.result().debugSession.startDebugAccepted({ kind: "node-attach", port: 9230 }),
      ).toBe(false);
    });
    expect(mocks.startDebugAccepted).not.toHaveBeenCalled();

    await act(async () => {
      resolveCandidate(47);
      await selecting;
    });
    expect(mocks.openDebugPanel).toHaveBeenCalledTimes(1);
    ui.unmount();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
