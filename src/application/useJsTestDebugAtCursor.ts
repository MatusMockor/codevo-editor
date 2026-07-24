import { useCallback, useEffect, useRef } from "react";
import {
  debugWatchAtCursorCapturesEqual,
  type DebugWatchAtCursorCapture,
  type DebugWatchAtCursorCaptureReader,
} from "../domain/debugWatchAtCursorCapture";
import type { DebugLaunchTarget } from "../domain/debug";
import { isJsTestRelativePath } from "../domain/jsTestFilePatterns";
import {
  jsTestDebugSelectionAtCursor,
  MAX_JS_TEST_DEBUG_AT_CURSOR_SOURCE_BYTES,
} from "../domain/jsTestDebugAtCursor";
import {
  createJsTestDebugTarget,
  validatedJsTestDebugScope,
  type JsTestDebugScope,
} from "../domain/jsTestDebugScope";
import { isDirty, type EditorDocument } from "../domain/workspace";
import {
  createConservativeWorkspaceRootFromPath,
  parseWorkspacePath,
  type WorkspacePath,
} from "../domain/workspacePath";
import {
  createWorkspaceRuntimeOwner,
  transferWorkspaceRuntimeOwner,
} from "../domain/workspaceRuntimeOwner";
import {
  detectJsTestRunnerContext,
  type WorkspaceFileReader,
} from "./jsTestRunnerDetection";
import { jsTestDebugLaunch } from "./jsTestDebugLaunch";

export const MAX_JS_TEST_DEBUG_RUNNER_READS = 256;
export const MAX_JS_TEST_DEBUG_RUNNER_FILE_BYTES = 64 * 1024;
export const MAX_JS_TEST_DEBUG_RUNNER_TOTAL_BYTES = 2 * 1024 * 1024;
export const MAX_JS_TEST_DEBUG_DISK_FILE_BYTES = MAX_JS_TEST_DEBUG_AT_CURSOR_SOURCE_BYTES;

export type JsTestDebugBoundedRead =
  | { readonly status: "ok"; readonly content: string }
  | { readonly status: "missing" }
  | { readonly status: "tooLarge" };

export interface JsTestDebugAtCursorCommands {
  canDebugAtCursor(): boolean;
  debugAtCursor(): Promise<boolean>;
}

export interface UseJsTestDebugAtCursorOptions {
  readonly activationEpoch: () => number;
  readonly activeDocument: () => EditorDocument | null;
  readonly captureReader?: DebugWatchAtCursorCaptureReader | null;
  readonly isDebugStartBlocked: () => boolean;
  readonly isWorkspaceCurrent: (workspaceRoot: string, workspaceOwnerKey: string) => boolean;
  readonly isWorkspaceTrusted: () => boolean;
  readonly openDebugPanel: () => void;
  readonly readTextFileBounded: (path: string, maxBytes: number) => Promise<JsTestDebugBoundedRead>;
  readonly reportWarning: (message: string) => void;
  readonly startDebugAccepted: (launch: DebugLaunchTarget) => Promise<boolean>;
  readonly workspaceId: string | null;
}

interface DebugCandidate {
  readonly capture: DebugWatchAtCursorCapture;
  readonly scope: JsTestDebugScope;
}

interface DebugRequest {
  readonly activationEpoch: number;
  readonly candidate: DebugCandidate;
  readonly openDebugPanel: () => void;
  readonly reportWarning: (message: string) => void;
  readonly startDebugAccepted: (launch: DebugLaunchTarget) => Promise<boolean>;
  readonly workspaceId: string;
}

/**
 * Command-boundary coordinator for Jest/Vitest Debug Test at Cursor. It consumes an atomic
 * editor capture directly; Test Explorer nodes are presentation models and are never fabricated.
 */
export function useJsTestDebugAtCursor(
  options: UseJsTestDebugAtCursorOptions,
): JsTestDebugAtCursorCommands {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const mountedRef = useRef(true);
  const activeRequestRef = useRef<DebugRequest | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeRequestRef.current = null;
    };
  }, []);

  const canDebugAtCursor = useCallback((): boolean => {
    const current = optionsRef.current;
    retireStaleRequest(activeRequestRef, current, mountedRef.current);
    if (activeRequestRef.current || debugStartBlocked(current)) return false;
    return currentCandidate(current) !== null;
  }, []);

  const debugAtCursor = useCallback(async (): Promise<boolean> => {
    const current = optionsRef.current;
    retireStaleRequest(activeRequestRef, current, mountedRef.current);
    if (activeRequestRef.current || debugStartBlocked(current)) return false;
    const candidate = readCandidate(current);
    const workspaceId = current.workspaceId;
    if (!candidate || !workspaceId) return false;

    const request: DebugRequest = {
      activationEpoch: safeActivationEpoch(current),
      candidate,
      openDebugPanel: current.openDebugPanel,
      reportWarning: current.reportWarning,
      startDebugAccepted: current.startDebugAccepted,
      workspaceId,
    };
    activeRequestRef.current = request;

    try {
      let runnerReads = 0;
      let runnerBytesRemaining = MAX_JS_TEST_DEBUG_RUNNER_TOTAL_BYTES;
      const runnerReader: WorkspaceFileReader = async (path) => {
        runnerReads += 1;
        if (runnerReads > MAX_JS_TEST_DEBUG_RUNNER_READS || runnerBytesRemaining <= 0) return null;
        const allowance = Math.min(MAX_JS_TEST_DEBUG_RUNNER_FILE_BYTES, runnerBytesRemaining);
        // Reserve before awaiting so parallel config probes cannot overbook the aggregate budget.
        runnerBytesRemaining -= allowance;
        const result = await safeBoundedRead(
          current,
          path,
          allowance,
        );
        if (result.status === "missing") {
          runnerBytesRemaining += allowance;
          return null;
        }
        if (result.status === "tooLarge") return "";
        const actualBytes = new TextEncoder().encode(result.content).byteLength;
        runnerBytesRemaining += allowance - actualBytes;
        return result.content;
      };
      const runnerContext = await detectJsTestRunnerContext(
        candidate.capture.workspaceRoot,
        runnerReader,
        candidate.capture.documentPath,
      );
      if (!isCurrentRequest(request, optionsRef.current, activeRequestRef.current, mountedRef.current)) {
        return false;
      }
      if (!runnerContext) {
        safeReport(
          request,
          "Debug Test at Cursor: no Jest or Vitest runner was detected.",
        );
        return false;
      }
      if (debugStartBlocked(optionsRef.current)) return false;

      const diskFile = await safeBoundedRead(
        current,
        candidate.capture.documentPath,
        MAX_JS_TEST_DEBUG_DISK_FILE_BYTES,
      );
      if (
        diskFile.status !== "ok" ||
        diskFile.content !== candidate.capture.content ||
        !isCurrentRequest(request, optionsRef.current, activeRequestRef.current, mountedRef.current)
      ) {
        return false;
      }
      if (debugStartBlocked(optionsRef.current)) return false;

      const owner = transferWorkspaceRuntimeOwner(
        createWorkspaceRuntimeOwner(request.workspaceId, candidate.capture.workspaceRoot),
        runnerContext.rootPath,
      );
      const target = createJsTestDebugTarget(owner, runnerContext.runner, candidate.scope);
      const launch = jsTestDebugLaunch(target, candidate.capture.workspaceRoot);

      if (!isCurrentRequest(request, optionsRef.current, activeRequestRef.current, mountedRef.current)) {
        return false;
      }
      const accepted = await request.startDebugAccepted(launch);
      if (
        !accepted ||
        !isRequestActivationCurrent(
          request,
          optionsRef.current,
          activeRequestRef.current,
          mountedRef.current,
        )
      ) {
        return false;
      }
      request.openDebugPanel();
      return true;
    } catch {
      if (
        isCurrentRequest(request, optionsRef.current, activeRequestRef.current, mountedRef.current)
      ) {
        safeReport(request, "Debug Test at Cursor failed.");
      }
      return false;
    } finally {
      if (activeRequestRef.current === request) activeRequestRef.current = null;
    }
  }, []);

  return { canDebugAtCursor, debugAtCursor };
}

function currentCandidate(options: UseJsTestDebugAtCursorOptions): DebugCandidate | null {
  const first = readCandidate(options);
  if (!first) return null;
  const second = readCandidate(options);
  return second && debugWatchAtCursorCapturesEqual(first.capture, second.capture) ? first : null;
}

function readCandidate(options: UseJsTestDebugAtCursorOptions): DebugCandidate | null {
  if (!trusted(options) || !options.workspaceId || safeActivationEpoch(options) < 0) return null;
  const capture = safeCapture(options);
  if (!capture || !validCapture(capture, options)) return null;
  const capturePath = conservativeWorkspacePath(capture.workspaceRoot, capture.documentPath);
  const relativeFilePath = capturePath?.relativePath ?? null;
  if (!relativeFilePath || !isJsTestRelativePath(relativeFilePath)) return null;
  const selection = jsTestDebugSelectionAtCursor(capture.content, capture.position);
  if (!selection) return null;

  try {
    const scope = validatedJsTestDebugScope(
      selection.kind === "suite"
        ? { kind: "suite", relativeFilePath, fullName: selection.fullName }
        : {
            kind: "test",
            relativeFilePath,
            fullName: selection.fullName,
            ...(selection.nameMatch === "prefix" ? { nameMatch: "prefix" as const } : {}),
          },
    );
    return Object.freeze({ capture, scope });
  } catch {
    return null;
  }
}

function validCapture(
  capture: DebugWatchAtCursorCapture,
  options: UseJsTestDebugAtCursorOptions,
): boolean {
  const document = safeActiveDocument(options);
  const capturePath = conservativeWorkspacePath(capture.workspaceRoot, capture.documentPath);
  const documentPath = document
    ? conservativeWorkspacePath(capture.workspaceRoot, document.path)
    : null;
  return (
    capture.workspaceRoot.length > 0 &&
    capture.workspaceOwnerKey.length > 0 &&
    capture.modelIdentity.length > 0 &&
    capture.modelIdentity.length <= 1_024 &&
    Number.isSafeInteger(capture.modelVersion) &&
    capture.modelVersion >= 1 &&
    capturePath !== null &&
    safeWorkspaceCurrent(options, capture.workspaceRoot, capture.workspaceOwnerKey) &&
    document !== null &&
    documentPath?.key === capturePath.key &&
    !isDirty(document) &&
    capture.content === document.savedContent
  );
}

function conservativeWorkspacePath(
  workspaceRoot: string,
  path: string,
): WorkspacePath | null {
  const root = createConservativeWorkspaceRootFromPath(workspaceRoot);
  if (!root.ok) return null;
  const parsed = parseWorkspacePath(root.value, path);
  return parsed.ok ? parsed.value : null;
}

function safeCapture(options: UseJsTestDebugAtCursorOptions): DebugWatchAtCursorCapture | null {
  try {
    return options.captureReader?.readDebugWatchAtCursorCapture() ?? null;
  } catch {
    return null;
  }
}

function safeActiveDocument(options: UseJsTestDebugAtCursorOptions): EditorDocument | null {
  try {
    return options.activeDocument();
  } catch {
    return null;
  }
}

function isCurrentRequest(
  request: DebugRequest,
  options: UseJsTestDebugAtCursorOptions,
  active: DebugRequest | null,
  mounted: boolean,
): boolean {
  if (!isRequestActivationCurrent(request, options, active, mounted)) {
    return false;
  }
  const current = readCandidate(options);
  return (
    current !== null &&
    debugWatchAtCursorCapturesEqual(request.candidate.capture, current.capture)
  );
}

function isRequestActivationCurrent(
  request: DebugRequest,
  options: UseJsTestDebugAtCursorOptions,
  active: DebugRequest | null,
  mounted: boolean,
): boolean {
  return (
    isRequestOwnerCurrent(request, active, mounted) &&
    options.workspaceId === request.workspaceId &&
    safeActivationEpoch(options) === request.activationEpoch &&
    trusted(options) &&
    safeWorkspaceCurrent(
      options,
      request.candidate.capture.workspaceRoot,
      request.candidate.capture.workspaceOwnerKey,
    )
  );
}

function isRequestOwnerCurrent(
  request: DebugRequest,
  active: DebugRequest | null,
  mounted: boolean,
): boolean {
  return mounted && active === request;
}

function retireStaleRequest(
  activeRequestRef: { current: DebugRequest | null },
  options: UseJsTestDebugAtCursorOptions,
  mounted: boolean,
): void {
  const active = activeRequestRef.current;
  if (active && !isCurrentRequest(active, options, active, mounted)) {
    activeRequestRef.current = null;
  }
}

function debugStartBlocked(options: UseJsTestDebugAtCursorOptions): boolean {
  if (!trusted(options)) return true;
  try {
    return options.isDebugStartBlocked();
  } catch {
    return true;
  }
}

function trusted(options: UseJsTestDebugAtCursorOptions): boolean {
  try {
    return options.isWorkspaceTrusted();
  } catch {
    return false;
  }
}

function safeWorkspaceCurrent(
  options: UseJsTestDebugAtCursorOptions,
  workspaceRoot: string,
  workspaceOwnerKey: string,
): boolean {
  try {
    return options.isWorkspaceCurrent(workspaceRoot, workspaceOwnerKey);
  } catch {
    return false;
  }
}

function safeActivationEpoch(options: UseJsTestDebugAtCursorOptions): number {
  try {
    const epoch = options.activationEpoch();
    return Number.isSafeInteger(epoch) && epoch >= 0 ? epoch : -1;
  } catch {
    return -1;
  }
}

async function safeBoundedRead(
  options: UseJsTestDebugAtCursorOptions,
  path: string,
  maxBytes: number,
): Promise<JsTestDebugBoundedRead> {
  try {
    const result = await options.readTextFileBounded(path, maxBytes);
    if (result?.status === "tooLarge") return result;
    if (result?.status !== "ok") return { status: "missing" };
    return new TextEncoder().encode(result.content).byteLength <= maxBytes
      ? result
      : { status: "tooLarge" };
  } catch {
    return { status: "missing" };
  }
}

function safeReport(request: DebugRequest, message: string): void {
  try {
    request.reportWarning(message);
  } catch {
    // Presentation failures cannot escape the command boundary.
  }
}
