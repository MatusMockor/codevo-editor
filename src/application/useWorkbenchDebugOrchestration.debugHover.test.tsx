// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { DebugHoverEvaluationPort } from "./useDebugHoverEvaluation";

const mocks = vi.hoisted(() => {
  const debugHover: DebugHoverEvaluationPort = {
    copyEvaluatePath: vi.fn(async () => false),
    evaluate: vi.fn(async () => null),
    getOwner: vi.fn(() => null),
    registerCopyEvaluatePath: vi.fn(() => null),
    revokeCopyEvaluatePath: vi.fn(),
  };
  const evaluateWatch = vi.fn(async () => null);
  return {
    debugHover,
    evaluateWatch,
    useDebugHoverEvaluation: vi.fn(() => debugHover),
  };
});

vi.mock("./useDebugSession", () => ({
  useWorkbenchDebugSession: () => ({
    startDebugCompoundAccepted: vi.fn(async () => false),
    session: {
      breakpoints: [],
      debugAdapterKind: "node",
      evaluate: vi.fn(),
      evaluateWatch: mocks.evaluateWatch,
      inspectionOwner: null,
      isDebugStartBlocked: vi.fn(() => false),
      output: [],
      restoreBreakpoints: vi.fn(),
      selectedFrameId: null,
      snapshot: { lastSeq: 0, state: { kind: "inactive" } },
      startDebug: vi.fn(),
      startDebugSessionAccepted: vi.fn(async () => 1),
      stepDebug: vi.fn(),
      toggleBreakpoint: vi.fn(),
      variableMutationRows: Object.freeze({ forRow: vi.fn(() => null) }),
    },
  }),
}));
vi.mock("./useDebugHoverEvaluation", async (importOriginal) => ({
  ...(await importOriginal()),
  useDebugHoverEvaluation: mocks.useDebugHoverEvaluation,
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
vi.mock("./useNodeDebugAttach", () => ({ useNodeDebugAttach: () => vi.fn() }));
vi.mock("./useDebugLocationOpener", () => ({
  useDebugLocationOpener: () => vi.fn(),
  useOpenDebugPanel: () => vi.fn(),
}));
vi.mock("./useDebugBreakpointAtCursor", () => ({
  useDebugBreakpointAtCursor: () => vi.fn(),
}));
vi.mock("./useConfiguredNodeLaunchStarter", () => ({
  useConfiguredNodeLaunchStarter: () => vi.fn(async () => false),
}));

import { useWorkbenchDebugOrchestration } from "./useWorkbenchDebugOrchestration";

describe("workbench debug hover composition", () => {
  it("exposes the hook-owned stable port on the debug session", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const workspaceFiles = {
      readDirectory: vi.fn(),
      readTextFile: vi.fn(),
      readTextFileBounded: vi.fn(),
    };
    let result: ReturnType<typeof useWorkbenchDebugOrchestration> | null = null;
    function Harness() {
      result = useWorkbenchDebugOrchestration({
        activeDocumentRef: { current: null },
        activeEditorPositionRef: { current: null },
        currentWorkspaceRootRef: { current: null },
        debugTextClipboard: null,
        debugGateway: { subscribe: vi.fn(() => vi.fn()) } as never,
        hasJavaScriptTypeScriptWorkspace: () => true,
        isActiveDocumentJsTest: false,
        isActiveDocumentPhpTest: false,
        isWorkspaceTrusted: () => true,
        isWorkspaceCurrent: () => true,
        nodeLaunchConfigurationVersion: 0,
        openNavigationTarget: vi.fn() as never,
        prompter: { prompt: vi.fn() },
        readTestFileIfExists: vi.fn(async () => null),
        reportWarning: vi.fn(),
        setBottomPanelView: vi.fn(),
        setBottomPanelVisible: vi.fn(),
        workspaceFiles,
        workspaceRoot: null,
        workspaceId: null,
        vscodeProcessTasks: {} as never,
      });
      return null;
    }

    act(() => root.render(<Harness />));
    const firstPort = result!.debugSession.debugHover;
    act(() => root.render(<Harness />));

    expect(firstPort).toBe(mocks.debugHover);
    expect(result!.debugSession.debugHover).toBe(firstPort);
    expect(Object.keys(result!.debugSession.copyValue).sort()).toEqual([
      "canCopyEvaluatePath",
      "canCopyValue",
      "copyEvaluatePath",
      "copyValue",
    ]);
    expect(Object.keys(result!.debugSession.setValue).sort()).toEqual([
      "beginEdit",
      "canBeginEdit",
    ]);
    expect("renderDebugPanel" in result!.debugSession).toBe(false);
    expect("copyValuePanelAccess" in result!.debugSession).toBe(false);
    expect("setFocusedCandidate" in result!.debugSession.copyValue).toBe(false);
    expect("copyEvaluatePathOnce" in result!.debugSession.copyValue).toBe(false);
    expect("debugCopyEvaluatePathOnce" in result!.debugSession).toBe(false);
    expect("debugCopyValueCommands" in result!.debugSession).toBe(false);
    expect("setVariable" in result!.debugSession).toBe(false);
    expect("setFocusedCapability" in result!.debugSession.setValue).toBe(false);
    expect("variableMutation" in result!.debugSession).toBe(false);
    expect(Object.keys(result!.debugSession.variableMutationRows)).toEqual(["forRow"]);
    expect(mocks.useDebugHoverEvaluation).toHaveBeenLastCalledWith(
      expect.objectContaining({ evaluateWatch: mocks.evaluateWatch }),
    );
    act(() => root.unmount());
  });
});
