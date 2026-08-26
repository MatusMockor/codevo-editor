// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DebugLaunchTarget } from "../domain/debug";
import {
  startWorkbenchDocumentDebug,
  useWorkbenchDebugOrchestration,
} from "./useWorkbenchDebugOrchestration";

const hookMocks = vi.hoisted(() => ({
  useDebugConsole: vi.fn(),
  useWorkbenchDebugSession: vi.fn(),
}));

vi.mock("./useDebugConsole", () => ({ useDebugConsole: hookMocks.useDebugConsole }));
vi.mock("./useDebugSession", () => ({
  useWorkbenchDebugSession: hookMocks.useWorkbenchDebugSession,
}));
vi.mock("./useDebugCopyStackTrace", () => ({ useDebugCopyStackTrace: vi.fn(() => null) }));
vi.mock("./useDebugRunToCursor", () => ({ useDebugRunToCursor: vi.fn(() => ({})) }));
vi.mock("./useDebugHoverEvaluation", () => ({ useDebugHoverEvaluation: vi.fn(() => null) }));
vi.mock("./useDebugInlineVariableLoading", () => ({
  useDebugInlineVariableLoading: vi.fn(),
}));
vi.mock("./useDebugWatchExpressions", () => ({
  useDebugWatchExpressions: vi.fn(() => ({ definitions: [], evaluations: [] })),
}));
vi.mock("./useDebugWatchExpressionMutations", () => ({
  useDebugWatchExpressionMutations: vi.fn(() => null),
}));
vi.mock("./useDebugConsoleCompletions", () => ({
  useDebugConsoleCompletions: vi.fn(() => null),
}));
vi.mock("./debugInlineValueContext", () => ({
  createDebugInlineValueContext: vi.fn(() => null),
}));
vi.mock("./useDebugLocationOpener", () => ({
  useDebugLocationOpener: vi.fn(() => vi.fn()),
  useOpenDebugPanel: vi.fn(() => vi.fn()),
}));
vi.mock("./useDebugConsoleSurfaceCommands", () => ({
  useDebugConsoleSurfaceCommands: vi.fn(() => null),
}));
vi.mock("./useNodeDebugPreLaunchComposition", () => ({
  useNodeDebugPreLaunchComposition: vi.fn(() => ({
    cancelServerReadyAction: vi.fn(),
    cancelServerReadyActionForSession: vi.fn(),
    canRestartPostTask: vi.fn(() => false),
    hasPostTaskRestart: vi.fn(() => false),
    isPostTaskActive: vi.fn(() => false),
    postRestartPending: false,
    restartPostTask: vi.fn(),
    start: vi.fn(),
  })),
}));
vi.mock("./useNodeDebugCompoundComposition", () => ({
  useNodeDebugCompoundComposition: vi.fn(() => ({
    isBusy: vi.fn(() => false),
    start: vi.fn(),
  })),
}));
vi.mock("./useNodeDebugConfigurationLauncher", () => ({
  useNodeDebugConfigurationLauncher: vi.fn(() => null),
}));
vi.mock("./useNodeDebugAttach", () => ({ useNodeDebugAttach: vi.fn(() => vi.fn()) }));
vi.mock("./useNodeDebugAttachProcessPicker", () => ({
  useNodeDebugAttachProcessPicker: vi.fn(() => ({ open: vi.fn() })),
}));
vi.mock("./useDebugBreakpointAtCursor", () => ({
  useDebugBreakpointAtCursor: vi.fn(() => vi.fn()),
}));
vi.mock("./useConfiguredNodeLaunchStarter", () => ({
  useConfiguredNodeLaunchStarter: vi.fn(() => vi.fn(async () => false)),
}));

const ROOT = "/workspace";

function harness(
  path: string,
  overrides: Partial<Parameters<typeof startWorkbenchDocumentDebug>[0]> = {},
) {
  const openDebugPanel = vi.fn();
  const startDebug = vi.fn(async (_launch: DebugLaunchTarget) => 1);
  const stopExactDebugSession = vi.fn(async (_sessionId: number) => true);
  const authority = { isCurrent: () => true };
  return {
    openDebugPanel,
    options: {
      activeDocumentPath: () => path,
      authority,
      document: { path },
      isJsTest: false,
      isPhpTest: false,
      openDebugPanel,
      readTestFileIfExists: async () => null,
      reportWarning: vi.fn(),
      requestedRoot: ROOT,
      startDebugSessionAccepted: startDebug,
      stopExactDebugSession,
      ...overrides,
    },
    startDebug,
    stopExactDebugSession,
  };
}

describe("startWorkbenchDocumentDebug", () => {
  it("routes PHP tests and scripts to their exact launch contracts", async () => {
    const phpTest = harness(`${ROOT}/tests/Feature/UserTest.php`, { isPhpTest: true });
    await startWorkbenchDocumentDebug(phpTest.options);
    expect(phpTest.startDebug).toHaveBeenCalledWith({
      kind: "php-test-file",
      filePath: `${ROOT}/tests/Feature/UserTest.php`,
    });

    const phpScript = harness(`${ROOT}/bin/worker.php`);
    await startWorkbenchDocumentDebug(phpScript.options);
    expect(phpScript.startDebug).toHaveBeenCalledWith({
      kind: "php-script",
      scriptPath: `${ROOT}/bin/worker.php`,
    });
    expect(phpTest.openDebugPanel).toHaveBeenCalledOnce();
    expect(phpScript.openDebugPanel).toHaveBeenCalledOnce();
  });

  it("launches supported Node scripts and ignores unsupported documents", async () => {
    const nodeScript = harness(`${ROOT}/src/server.ts`);
    await startWorkbenchDocumentDebug(nodeScript.options);
    expect(nodeScript.startDebug).toHaveBeenCalledWith({
      kind: "node-script",
      scriptPath: `${ROOT}/src/server.ts`,
    });

    const unsupported = harness(`${ROOT}/README.md`);
    await startWorkbenchDocumentDebug(unsupported.options);
    expect(unsupported.openDebugPanel).not.toHaveBeenCalled();
    expect(unsupported.startDebug).not.toHaveBeenCalled();
  });

  it("drops stale JavaScript test discovery without opening the debug panel", async () => {
    const path = `${ROOT}/src/server.test.ts`;
    const stale = harness(path, {
      activeDocumentPath: () => `${ROOT}/src/other.test.ts`,
      isJsTest: true,
    });
    await startWorkbenchDocumentDebug(stale.options);
    expect(stale.openDebugPanel).not.toHaveBeenCalled();
    expect(stale.startDebug).not.toHaveBeenCalled();
  });

  it("drops JavaScript test discovery after an A to B to A authority replacement", async () => {
    const path = `${ROOT}/src/server.test.ts`;
    let resolveManifest!: (content: string | null) => void;
    const manifest = new Promise<string | null>((resolve) => {
      resolveManifest = resolve;
    });
    const authorityA = { isCurrent: () => activeAuthority === authorityA };
    const authorityB = { isCurrent: () => activeAuthority === authorityB };
    const replacementAuthorityA = { isCurrent: () => activeAuthority === replacementAuthorityA };
    let activeAuthority = authorityA;
    const stale = harness(path, {
      authority: authorityA,
      isJsTest: true,
      readTestFileIfExists: (requestedPath) =>
        requestedPath.endsWith("/package.json") ? manifest : Promise.resolve(null),
    });

    const pending = startWorkbenchDocumentDebug(stale.options);
    activeAuthority = authorityB;
    activeAuthority = replacementAuthorityA;
    resolveManifest('{"devDependencies":{"vitest":"latest"}}');
    await pending;

    expect(stale.openDebugPanel).not.toHaveBeenCalled();
    expect(stale.startDebug).not.toHaveBeenCalled();
    expect(stale.options.reportWarning).not.toHaveBeenCalled();
  });

  it("suppresses a stale JavaScript discovery rejection", async () => {
    const path = `${ROOT}/src/server.test.ts`;
    let rejectManifest!: (error: unknown) => void;
    const manifest = new Promise<string | null>((_resolve, reject) => {
      rejectManifest = reject;
    });
    let current = true;
    const stale = harness(path, {
      authority: { isCurrent: () => current },
      isJsTest: true,
      readTestFileIfExists: (requestedPath) =>
        requestedPath.endsWith("/package.json") ? manifest : Promise.resolve(null),
    });

    const pending = startWorkbenchDocumentDebug(stale.options);
    current = false;
    rejectManifest(new Error("stale discovery"));
    await expect(pending).resolves.toBeUndefined();

    expect(stale.openDebugPanel).not.toHaveBeenCalled();
    expect(stale.startDebug).not.toHaveBeenCalled();
    expect(stale.options.reportWarning).not.toHaveBeenCalled();
  });

  it("stops the exact accepted session when authority expires during start", async () => {
    const path = `${ROOT}/src/server.ts`;
    let resolveStart!: (sessionId: number | null) => void;
    const accepted = new Promise<number | null>((resolve) => {
      resolveStart = resolve;
    });
    let current = true;
    const stale = harness(path, {
      authority: { isCurrent: () => current },
      startDebugSessionAccepted: vi.fn(() => accepted),
    });

    const pending = startWorkbenchDocumentDebug(stale.options);
    current = false;
    resolveStart(73);
    await pending;

    expect(stale.openDebugPanel).toHaveBeenCalledOnce();
    expect(stale.stopExactDebugSession).toHaveBeenCalledWith(73);
  });

  it("suppresses exact-session compensation rejection after authority expires", async () => {
    const path = `${ROOT}/src/server.ts`;
    let resolveStart!: (sessionId: number | null) => void;
    const accepted = new Promise<number | null>((resolve) => {
      resolveStart = resolve;
    });
    let current = true;
    const stale = harness(path, {
      authority: { isCurrent: () => current },
      startDebugSessionAccepted: vi.fn(() => accepted),
      stopExactDebugSession: vi.fn(async () => {
        throw new Error("stale compensation");
      }),
    });

    const pending = startWorkbenchDocumentDebug(stale.options);
    current = false;
    resolveStart(91);

    await expect(pending).resolves.toBeUndefined();
    expect(stale.options.stopExactDebugSession).toHaveBeenCalledWith(91);
  });

  it("does not start when opening the debug panel invalidates authority", async () => {
    const path = `${ROOT}/src/server.ts`;
    let current = true;
    const stale = harness(path, {
      authority: { isCurrent: () => current },
      openDebugPanel: vi.fn(() => {
        current = false;
      }),
    });

    await startWorkbenchDocumentDebug(stale.options);

    expect(stale.options.openDebugPanel).toHaveBeenCalledOnce();
    expect(stale.startDebug).not.toHaveBeenCalled();
    expect(stale.stopExactDebugSession).not.toHaveBeenCalled();
  });
});

describe("useWorkbenchDebugOrchestration", () => {
  afterEach(() => {
    hookMocks.useDebugConsole.mockReset();
    hookMocks.useWorkbenchDebugSession.mockReset();
  });

  it("threads workspace root changes to the debug console without an active pause", () => {
    const consoleResult = {
      clear: vi.fn(),
      resultOwner: null,
      state: {
        entries: [],
        history: [],
        nextSequence: 1,
        owner: null,
        pendingRequestIds: [],
        totalBytes: 0,
      },
      submit: vi.fn(),
    };
    hookMocks.useDebugConsole.mockReturnValue(consoleResult);
    hookMocks.useWorkbenchDebugSession.mockReturnValue({
      session: createInactiveDebugSession(),
      startDebugCompoundAccepted: vi.fn(),
      startNodeAttachCandidateAccepted: vi.fn(),
    });
    const host = document.createElement("div");
    const reactRoot = createRoot(host);
    const options = createOrchestrationOptions("/workspace-a");

    function Harness({ workspaceRoot }: { workspaceRoot: string | null }) {
      useWorkbenchDebugOrchestration({ ...options, workspaceRoot });
      return null;
    }

    act(() => reactRoot.render(createElement(Harness, { workspaceRoot: "/workspace-a" })));
    expect(hookMocks.useDebugConsole).toHaveBeenLastCalledWith(
      expect.objectContaining({
        owner: null,
        resultOwner: null,
        sessionId: null,
        workspaceRoot: "/workspace-a",
      }),
    );

    act(() => reactRoot.render(createElement(Harness, { workspaceRoot: "/workspace-b" })));
    expect(hookMocks.useDebugConsole).toHaveBeenLastCalledWith(
      expect.objectContaining({
        owner: null,
        resultOwner: null,
        sessionId: null,
        workspaceRoot: "/workspace-b",
      }),
    );
    act(() => reactRoot.unmount());
  });
});

function createInactiveDebugSession() {
  const unavailable = vi.fn();
  return {
    breakpoints: [],
    canRestartDebug: vi.fn(() => false),
    canRunToLocation: false,
    completeDebugConsole: unavailable,
    debugAdapterKind: null,
    debugCompoundActive: false,
    debugInspectionRevision: 0,
    debugRestartPending: false,
    disconnectDebug: unavailable,
    disconnectExactDebugSession: unavailable,
    evaluate: unavailable,
    evaluateWatch: unavailable,
    inspectionOwner: null,
    isDebugStartBlocked: vi.fn(() => false),
    loadVariablePage: unavailable,
    output: [],
    pauseOwner: null,
    restartDebug: unavailable,
    restoreBreakpoints: unavailable,
    runToLocation: unavailable,
    scopes: [],
    selectedFrameId: null,
    selectFrame: unavailable,
    setWatchExpression: unavailable,
    snapshot: { state: { kind: "inactive" as const } },
    startDebug: unavailable,
    startDebugAccepted: unavailable,
    startDebugDescriptorSessionAccepted: unavailable,
    startDebugSessionAccepted: unavailable,
    stepDebug: unavailable,
    stopDebug: unavailable,
    stopExactDebugSession: unavailable,
    toggleBreakpoint: unavailable,
    variablePages: {},
  };
}

function createOrchestrationOptions(
  workspaceRoot: string,
): Parameters<typeof useWorkbenchDebugOrchestration>[0] {
  const currentWorkspaceRootRef = { current: workspaceRoot };
  return {
    activeDocumentRef: { current: null },
    activeEditorPositionRef: { current: null },
    captureDocumentDebugAuthority: () => ({ isCurrent: () => true }),
    currentWorkspaceRootRef,
    debugGateway: {} as Parameters<typeof useWorkbenchDebugOrchestration>[0]["debugGateway"],
    hasJavaScriptTypeScriptWorkspace: () => false,
    isActiveDocumentJsTest: false,
    isActiveDocumentPhpTest: false,
    isWorkspaceCurrent: () => true,
    isWorkspaceTrusted: () => true,
    nodeLaunchConfigurationVersion: 0,
    openNavigationTarget: vi.fn() as Parameters<
      typeof useWorkbenchDebugOrchestration
    >[0]["openNavigationTarget"],
    prompter: { prompt: vi.fn() },
    readTestFileIfExists: async () => null,
    reportWarning: vi.fn(),
    setBottomPanelView: vi.fn(),
    setBottomPanelVisible: vi.fn(),
    workspaceFiles: {
      readDirectory: vi.fn(async () => []),
      readTextFile: vi.fn(async () => ""),
      readTextFileBounded: vi.fn(async () => ({ status: "ok" as const, content: "" })),
    },
    workspaceId: "workspace-owner",
    workspaceRoot,
    vscodeProcessTasks: {} as Parameters<
      typeof useWorkbenchDebugOrchestration
    >[0]["vscodeProcessTasks"],
  };
}
