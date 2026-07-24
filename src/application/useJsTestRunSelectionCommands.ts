import { useCallback, useEffect, useRef } from "react";
import {
  debugWatchAtCursorCapturesEqual,
  type DebugWatchAtCursorCapture,
  type DebugWatchAtCursorCaptureReader,
} from "../domain/debugWatchAtCursorCapture";
import {
  jsTestRunScopeAtCursor,
  jsTestRunScopeForFile,
  type JsTestRunnableScope,
} from "../domain/jsTestRunSelection";
import { isJsTestRelativePath } from "../domain/jsTestFilePatterns";
import { isDirty, type EditorDocument } from "../domain/workspace";
import {
  createConservativeWorkspaceRootFromPath,
  parseWorkspacePath,
  type WorkspacePath,
} from "../domain/workspacePath";

export const MAX_JS_TEST_RUN_SELECTION_SOURCE_BYTES = 2 * 1024 * 1024;

export type JsTestRunSelectionBoundedRead =
  | { readonly status: "ok"; readonly content: string }
  | { readonly status: "missing" }
  | { readonly status: "tooLarge" };

/** Narrow owner-bound adapter over the Test Explorer run lifecycle. */
export interface JsTestExplorerScopeRunnerPort {
  canCancelTestRun(): boolean;
  canRerunFailedTests(): boolean;
  canRerunLastRun(): boolean;
  canRunScope(scope: JsTestRunnableScope): boolean;
  cancelTestRun(): Promise<boolean>;
  rerunFailedTests(): Promise<boolean>;
  rerunLastRun(): Promise<boolean>;
  runScope(scope: JsTestRunnableScope): Promise<boolean>;
}

/** Public command surface. Editor source, captures, and scopes remain private. */
export interface JsTestRunSelectionCommands {
  canRunAtCursor(): boolean;
  runAtCursor(): Promise<boolean>;
  canRunCurrentFile(): boolean;
  runCurrentFile(): Promise<boolean>;
}

export interface UseJsTestRunSelectionCommandsOptions {
  readonly activationEpoch: () => number;
  readonly activeDocument: () => EditorDocument | null;
  readonly captureReader?: DebugWatchAtCursorCaptureReader | null;
  readonly isWorkspaceCurrent: (workspaceRoot: string, workspaceOwnerKey: string) => boolean;
  readonly isWorkspaceTrusted: () => boolean;
  readonly readTextFileBounded: (
    path: string,
    maxBytes: number,
  ) => Promise<JsTestRunSelectionBoundedRead>;
  readonly runner: JsTestExplorerScopeRunnerPort;
  readonly workspaceId: string | null;
  readonly workspaceOwnerKey: string | null;
  readonly workspaceRoot: string | null;
}

type RunKind = "cursor" | "file";

interface RunCandidate {
  readonly capture: DebugWatchAtCursorCapture;
  readonly scope: JsTestRunnableScope;
}

interface RuntimeBoundary {
  readonly activationEpoch: number;
  readonly workspaceId: string;
  readonly workspaceOwnerKey: string;
  readonly workspaceRoot: string;
}

interface ActiveRun {
  readonly boundary: RuntimeBoundary;
  readonly candidate: RunCandidate;
  readonly kind: RunKind;
  readonly runner: JsTestExplorerScopeRunnerPort;
}

/**
 * Owner-safe bridge from the active editor to the typed Test Explorer runner.
 * It never starts a terminal command and never publishes editor text or a fabricated explorer node.
 */
export function useJsTestRunSelectionCommands(
  options: UseJsTestRunSelectionCommandsOptions,
): JsTestRunSelectionCommands {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const mountedRef = useRef(true);
  const activeRunRef = useRef<ActiveRun | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const canRun = useCallback((kind: RunKind): boolean => {
    if (activeRunRef.current) return false;
    const current = optionsRef.current;
    const boundary = exactRuntimeBoundary(current);
    const candidate = boundary ? exactCandidate(current, boundary, kind) : null;
    return candidate !== null && safeCanRun(current.runner, candidate.scope);
  }, []);

  const run = useCallback(async (kind: RunKind): Promise<boolean> => {
    if (activeRunRef.current) return false;
    const current = optionsRef.current;
    const boundary = exactRuntimeBoundary(current);
    const candidate = boundary ? exactCandidate(current, boundary, kind) : null;
    if (!boundary || !candidate || !safeCanRun(current.runner, candidate.scope)) return false;

    const request: ActiveRun = { boundary, candidate, kind, runner: current.runner };
    activeRunRef.current = request;
    try {
      if (
        !requestIsCurrent(request, optionsRef.current, activeRunRef.current, mountedRef.current)
      ) {
        return false;
      }
      const disk = await safeBoundedRead(
        current,
        candidate.capture.documentPath,
        MAX_JS_TEST_RUN_SELECTION_SOURCE_BYTES,
      );
      if (
        disk.status !== "ok" ||
        !utf8BytesEqual(disk.content, candidate.capture.content) ||
        !requestIsCurrent(request, optionsRef.current, activeRunRef.current, mountedRef.current)
      ) {
        return false;
      }
      if (
        !safeCanRun(request.runner, candidate.scope) ||
        !requestIsCurrent(request, optionsRef.current, activeRunRef.current, mountedRef.current)
      ) {
        return false;
      }

      const accepted = await request.runner.runScope(candidate.scope);
      return (
        accepted === true &&
        requestIsCurrent(request, optionsRef.current, activeRunRef.current, mountedRef.current)
      );
    } catch {
      return false;
    } finally {
      if (activeRunRef.current === request) activeRunRef.current = null;
    }
  }, []);

  return {
    canRunAtCursor: () => canRun("cursor"),
    runAtCursor: () => run("cursor"),
    canRunCurrentFile: () => canRun("file"),
    runCurrentFile: () => run("file"),
  };
}

function exactCandidate(
  options: UseJsTestRunSelectionCommandsOptions,
  boundary: RuntimeBoundary,
  kind: RunKind,
): RunCandidate | null {
  const first = readCandidate(options, boundary, kind);
  if (!first) return null;
  const second = readCandidate(options, boundary, kind);
  return second && candidatesEqual(first, second) ? first : null;
}

function readCandidate(
  options: UseJsTestRunSelectionCommandsOptions,
  boundary: RuntimeBoundary,
  kind: RunKind,
): RunCandidate | null {
  const capture = safeCapture(options);
  if (!capture || !validCapture(options, boundary, capture)) return null;
  const workspacePath = conservativeWorkspacePath(capture.workspaceRoot, capture.documentPath);
  if (!workspacePath || !isJsTestRelativePath(workspacePath.relativePath)) return null;
  const scope =
    kind === "cursor"
      ? jsTestRunScopeAtCursor(capture.content, capture.position, workspacePath.relativePath)
      : jsTestRunScopeForFile(workspacePath.relativePath);
  return scope ? Object.freeze({ capture, scope }) : null;
}

function validCapture(
  options: UseJsTestRunSelectionCommandsOptions,
  boundary: RuntimeBoundary,
  capture: DebugWatchAtCursorCapture,
): boolean {
  const document = safeActiveDocument(options);
  const capturePath = conservativeWorkspacePath(capture.workspaceRoot, capture.documentPath);
  const documentPath = document
    ? conservativeWorkspacePath(capture.workspaceRoot, document.path)
    : null;
  return (
    capture.workspaceRoot === boundary.workspaceRoot &&
    capture.workspaceOwnerKey === boundary.workspaceOwnerKey &&
    capture.modelIdentity.length > 0 &&
    capture.modelIdentity.length <= 1_024 &&
    Number.isSafeInteger(capture.modelVersion) &&
    capture.modelVersion >= 1 &&
    utf8ByteLength(capture.content) <= MAX_JS_TEST_RUN_SELECTION_SOURCE_BYTES &&
    capturePath !== null &&
    safeWorkspaceCurrent(options, capture.workspaceRoot, capture.workspaceOwnerKey) &&
    document !== null &&
    documentPath?.key === capturePath.key &&
    !isDirty(document) &&
    document.savedContent === capture.content
  );
}

function exactRuntimeBoundary(
  options: UseJsTestRunSelectionCommandsOptions,
): RuntimeBoundary | null {
  const first = readRuntimeBoundary(options);
  const second = readRuntimeBoundary(options);
  return first && second && boundariesEqual(first, second) ? first : null;
}

function readRuntimeBoundary(
  options: UseJsTestRunSelectionCommandsOptions,
): RuntimeBoundary | null {
  const { workspaceId, workspaceOwnerKey, workspaceRoot } = options;
  if (!workspaceId?.trim() || !workspaceOwnerKey?.trim() || !workspaceRoot?.trim()) return null;
  if (!safeTrusted(options)) return null;
  const activationEpoch = safeActivationEpoch(options);
  if (activationEpoch < 0 || !safeWorkspaceCurrent(options, workspaceRoot, workspaceOwnerKey)) {
    return null;
  }
  return Object.freeze({ activationEpoch, workspaceId, workspaceOwnerKey, workspaceRoot });
}

function requestIsCurrent(
  request: ActiveRun,
  options: UseJsTestRunSelectionCommandsOptions,
  active: ActiveRun | null,
  mounted: boolean,
): boolean {
  if (!mounted || active !== request || options.runner !== request.runner) return false;
  const boundary = exactRuntimeBoundary(options);
  if (!boundary || !boundariesEqual(request.boundary, boundary)) return false;
  const candidate = exactCandidate(options, boundary, request.kind);
  return candidate !== null && candidatesEqual(request.candidate, candidate);
}

function safeCapture(
  options: UseJsTestRunSelectionCommandsOptions,
): DebugWatchAtCursorCapture | null {
  try {
    return options.captureReader?.readDebugWatchAtCursorCapture() ?? null;
  } catch {
    return null;
  }
}

function safeActiveDocument(options: UseJsTestRunSelectionCommandsOptions): EditorDocument | null {
  try {
    return options.activeDocument();
  } catch {
    return null;
  }
}

function safeActivationEpoch(options: UseJsTestRunSelectionCommandsOptions): number {
  try {
    const epoch = options.activationEpoch();
    return Number.isSafeInteger(epoch) && epoch >= 0 ? epoch : -1;
  } catch {
    return -1;
  }
}

function safeTrusted(options: UseJsTestRunSelectionCommandsOptions): boolean {
  try {
    return options.isWorkspaceTrusted() === true;
  } catch {
    return false;
  }
}

function safeWorkspaceCurrent(
  options: UseJsTestRunSelectionCommandsOptions,
  workspaceRoot: string,
  workspaceOwnerKey: string,
): boolean {
  try {
    return options.isWorkspaceCurrent(workspaceRoot, workspaceOwnerKey) === true;
  } catch {
    return false;
  }
}

function safeCanRun(runner: JsTestExplorerScopeRunnerPort, scope: JsTestRunnableScope): boolean {
  try {
    return runner.canRunScope(scope) === true;
  } catch {
    return false;
  }
}

async function safeBoundedRead(
  options: UseJsTestRunSelectionCommandsOptions,
  path: string,
  maxBytes: number,
): Promise<JsTestRunSelectionBoundedRead> {
  try {
    const result = await options.readTextFileBounded(path, maxBytes);
    if (result?.status === "tooLarge") return result;
    if (result?.status !== "ok") return { status: "missing" };
    return utf8ByteLength(result.content) <= maxBytes ? result : { status: "tooLarge" };
  } catch {
    return { status: "missing" };
  }
}

function conservativeWorkspacePath(workspaceRoot: string, path: string): WorkspacePath | null {
  const root = createConservativeWorkspaceRootFromPath(workspaceRoot);
  if (!root.ok) return null;
  const parsed = parseWorkspacePath(root.value, path);
  return parsed.ok ? parsed.value : null;
}

function candidatesEqual(left: RunCandidate, right: RunCandidate): boolean {
  return (
    debugWatchAtCursorCapturesEqual(left.capture, right.capture) &&
    scopesEqual(left.scope, right.scope)
  );
}

function scopesEqual(left: JsTestRunnableScope, right: JsTestRunnableScope): boolean {
  return (
    left.kind === right.kind &&
    left.relativeFilePath === right.relativeFilePath &&
    (left.kind === "file" ||
      right.kind === "file" ||
      (left.fullName === right.fullName &&
        (left.kind !== "test" || right.kind !== "test" || left.nameMatch === right.nameMatch)))
  );
}

function boundariesEqual(left: RuntimeBoundary, right: RuntimeBoundary): boolean {
  return (
    left.activationEpoch === right.activationEpoch &&
    left.workspaceId === right.workspaceId &&
    left.workspaceOwnerKey === right.workspaceOwnerKey &&
    left.workspaceRoot === right.workspaceRoot
  );
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function utf8BytesEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.byteLength !== rightBytes.byteLength) return false;
  return leftBytes.every((byte, index) => byte === rightBytes[index]);
}
