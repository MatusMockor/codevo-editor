import type { DebugGateway } from "../domain/debug";
import type { DebugBreakpointNavigationCaptureReader } from "../domain/debugBreakpointNavigationCapture";
import type { BreakpointStorage } from "../domain/debugBreakpointPersistence";
import type { DebugEvaluateInConsoleCaptureReader } from "../domain/debugEvaluateInConsoleCapture";
import type { DebugInlineBreakpointCaptureReader } from "../domain/debugInlineBreakpointCapture";
import type { DebugWatchAtCursorCaptureReader } from "../domain/debugWatchAtCursorCapture";
import type { TextClipboardGateway } from "../domain/textClipboard";
import type { DebugCopyValueSafeCommands } from "./debugCopyValueCommandBridge";
import type { DebugAddToWatchSafeCommands } from "./debugAddToWatchCommandBridge";
import type { DebugSetVariableSafeCommands } from "./debugSetVariableCommandBridge";
import type { DebugCopyEvaluatePathTarget } from "./useDebugCopyValueComposition";
import type { JsTestExplorerScopeRunnerPort } from "./useJsTestRunSelectionCommands";
import type { DebugServerReadyExternalUrlOpener } from "../domain/debugServerReadyUrl";
import type { NodeDebugAttachCandidateStartPort } from "./debugSessionContracts";
import type { NodeDebugAttachCandidateListGateway } from "./useNodeDebugAttachProcessPicker";

export interface JsTestRerunLastRunCommands {
  canCancelTestRun(): boolean;
  canRerunFailedTests(): boolean;
  canRerunLastRun(): boolean;
  cancelTestRun(): Promise<boolean>;
  rerunFailedTests(): Promise<boolean>;
  rerunLastRun(): Promise<boolean>;
}

type JsTestExplorerCommandRunnerPort = JsTestExplorerScopeRunnerPort & JsTestRerunLastRunCommands;

export interface WorkbenchDebugControllerOptions {
  debugGateway?: DebugGateway;
  serverReadyExternalUrlOpener?: DebugServerReadyExternalUrlOpener;
  debugBreakpointStorage?: BreakpointStorage;
  debugWatchAtCursorCaptureReader?: DebugWatchAtCursorCaptureReader | null;
  debugEvaluateInConsoleCaptureReader?: DebugEvaluateInConsoleCaptureReader | null;
  debugBreakpointNavigationCaptureReader?: DebugBreakpointNavigationCaptureReader | null;
  debugInlineBreakpointCaptureReader?: DebugInlineBreakpointCaptureReader | null;
  debugTextClipboard?: TextClipboardGateway | null;
  debugCopyValueCommands?: DebugCopyValueSafeCommands;
  debugAddToWatchCommands?: DebugAddToWatchSafeCommands;
  debugSetVariableCommands?: DebugSetVariableSafeCommands;
  debugCopyEvaluatePathOnce?: (target: DebugCopyEvaluatePathTarget) => Promise<boolean>;
  jsTestExplorerScopeRunner?: JsTestExplorerCommandRunnerPort;
  nodeDebugAttachCandidateGateway?: NodeDebugAttachCandidateListGateway;
  nodeDebugAttachCandidateStart?: NodeDebugAttachCandidateStartPort;
}

/** Projects only fail-closed rerun verbs from the private Test Explorer bridge. */
export function createJsTestRerunLastRunCommands(
  runner: JsTestExplorerCommandRunnerPort | undefined,
): JsTestRerunLastRunCommands {
  return Object.freeze({
    canCancelTestRun: () => {
      try {
        return runner?.canCancelTestRun() === true;
      } catch {
        return false;
      }
    },
    canRerunFailedTests: () => {
      try {
        return runner?.canRerunFailedTests() === true;
      } catch {
        return false;
      }
    },
    canRerunLastRun: () => {
      try {
        return runner?.canRerunLastRun() === true;
      } catch {
        return false;
      }
    },
    cancelTestRun: async () => {
      try {
        return (await runner?.cancelTestRun()) === true;
      } catch {
        return false;
      }
    },
    rerunFailedTests: async () => {
      try {
        return (await runner?.rerunFailedTests()) === true;
      } catch {
        return false;
      }
    },
    rerunLastRun: async () => {
      try {
        return (await runner?.rerunLastRun()) === true;
      } catch {
        return false;
      }
    },
  });
}
