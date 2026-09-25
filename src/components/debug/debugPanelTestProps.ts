import { vi } from "vitest";
import type { UseDebugConsoleResult } from "../../application/useDebugConsole";
import type { StackFrame } from "../../domain/debug";
import { createDebugConsoleState, type DebugConsoleState } from "../../domain/debugConsoleState";
import type { DebugPanelProps } from "../DebugPanel";

export const DEBUG_TEST_FRAME: StackFrame = {
  frameId: 1,
  name: "main",
  filePath: "/workspace/src/index.ts",
  lineNumber: 12,
  column: 3,
};

export function debugConsoleTestResult(
  state: DebugConsoleState = createDebugConsoleState({ sessionId: 7, pauseGeneration: 1 }),
  submit = vi.fn().mockResolvedValue(undefined),
): UseDebugConsoleResult {
  return { state, clear: vi.fn(), submit };
}

export function debugPanelTestProps(overrides: Partial<DebugPanelProps> = {}): DebugPanelProps {
  return {
    breakpointBulkMutationPending: false,
    breakpointCounts: { disabled: 0, enabled: 0 },
    breakpoints: [],
    console: debugConsoleTestResult(),
    debugAdapterKind: null,
    exceptionPauseError: null,
    exceptionPauseMode: "none",
    exceptionPausePending: false,
    exceptionTypeFilter: [],
    hasJavaScriptTypeScriptWorkspace: true,
    lastStartError: null,
    onClearConsole: vi.fn(),
    onLoadVariables: vi.fn(),
    onDisableAllBreakpoints: vi.fn(),
    onDisconnect: vi.fn(),
    onEnableAllBreakpoints: vi.fn(),
    onNavigateToBreakpoint: vi.fn(),
    onNavigateToFrame: vi.fn(),
    onPause: vi.fn(),
    onRemoveBreakpoint: vi.fn(),
    onRemoveAllBreakpoints: vi.fn(),
    onAddFunctionBreakpoint: vi.fn(),
    onRemoveFunctionBreakpoint: vi.fn(),
    onSelectFrame: vi.fn(),
    onSetBreakpointCondition: vi.fn(),
    onSetBreakpointHitCondition: vi.fn(),
    onSetBreakpointLogMessage: vi.fn(),
    onSetBreakpointEnabled: vi.fn(),
    onSetFunctionBreakpointEnabled: vi.fn(),
    onSetExceptionPauseMode: vi.fn(),
    onSetExceptionTypeFilter: vi.fn(),
    onStep: vi.fn(),
    onStop: vi.fn(),
    rootPath: "/workspace",
    scopeLoadState: { frameId: DEBUG_TEST_FRAME.frameId, kind: "ready" },
    scopes: [],
    selectedFrameId: null,
    snapshot: { state: { kind: "inactive" }, lastSeq: 0 },
    variablesByReference: {},
    watches: {
      definitions: [],
      evaluations: {},
      pendingIds: [],
      onAdd: vi.fn(),
      onClear: vi.fn(),
      onRemove: vi.fn(),
      onSetEnabled: vi.fn(),
      onUpdate: vi.fn(),
    },
    workspaceTrusted: true,
    ...overrides,
  };
}
