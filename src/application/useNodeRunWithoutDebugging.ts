import { useCallback, useEffect, useRef, useState } from "react";
import type {
  NodeRunTarget,
  NodeRunTaskGateway,
  NodeRunTaskStatusEvent,
} from "../domain/nodeRunTask";
import { parseNodeRunTarget } from "../domain/nodeRunTask";
import type { EditorDocument, WorkspaceFileGateway } from "../domain/workspace";
import { isSessionPathInWorkspace } from "./documentSessionState";
import { resolveNodeRunWithoutDebuggingTarget } from "./nodeRunWithoutDebuggingResolver";

export type NodeRunWithoutDebuggingState =
  | { readonly kind: "idle" }
  | { readonly kind: "resolving" }
  | { readonly kind: "waiting-for-terminal"; readonly target: NodeRunTarget }
  | {
      readonly kind: "starting" | "running";
      readonly runId: string;
      readonly target: NodeRunTarget;
      readonly terminalSessionId: number;
      readonly workspaceId: string;
    }
  | {
      readonly kind: "stopping";
      readonly retryable: boolean;
      readonly runId: string;
      readonly target: NodeRunTarget;
      readonly terminalSessionId: number;
      readonly workspaceId: string;
    }
  | { readonly kind: "exited"; readonly exitCode: number | null }
  | { readonly kind: "failed"; readonly message: string };

export interface UseNodeRunWithoutDebuggingOptions {
  readonly activeDocument: EditorDocument | null;
  readonly gateway: NodeRunTaskGateway;
  readonly debugRuntimeAvailable: boolean;
  readonly hasJavaScriptTypeScriptWorkspace: boolean;
  readonly isActiveDocumentJsTest: boolean;
  readonly isWorkspaceCurrent: (rootPath: string, workspaceId: string) => boolean;
  readonly isDebugRuntimeAvailable: () => boolean;
  readonly isWorkspaceTrusted: () => boolean;
  readonly readFileIfExists: (path: string) => Promise<string | null>;
  readonly requestTerminalSession: (consumer: (sessionId: number | null) => void) => void;
  readonly workspaceFiles: Pick<
    WorkspaceFileGateway,
    "readDirectory" | "readTextFile" | "readTextFileBounded"
  >;
  readonly workspaceId: string | null;
  readonly workspaceRoot: string | null;
  readonly workspaceTrusted: boolean;
  readonly createRunId?: () => string;
  reportError(error: unknown): void;
  reportWarning(message: string): void;
}

export interface UseNodeRunWithoutDebuggingResult {
  readonly pending: boolean;
  readonly state: NodeRunWithoutDebuggingState;
  run(): void;
  startTarget(target: NodeRunTarget): boolean;
  stop(): void;
}

interface CapturedRunOwner {
  readonly documentPath: string | null;
  readonly generation: number;
  readonly rootPath: string;
  readonly workspaceId: string;
}

interface ActiveRun extends CapturedRunOwner {
  readonly cancelPendingStart: () => void;
  readonly runId: string;
  readonly startCanceled: Promise<void>;
  readonly target: NodeRunTarget;
  readonly terminalSessionId: number;
  startDispatched: boolean;
  stopRequested: boolean;
}

interface CurrentRunContext {
  readonly activeDocument: EditorDocument | null;
  readonly debugRuntimeAvailable: boolean;
  readonly hasJavaScriptTypeScriptWorkspace: boolean;
  readonly isActiveDocumentJsTest: boolean;
  readonly isDebugRuntimeAvailable: () => boolean;
  readonly isWorkspaceCurrent: (rootPath: string, workspaceId: string) => boolean;
  readonly isWorkspaceTrusted: () => boolean;
  readonly workspaceId: string | null;
  readonly workspaceRoot: string | null;
  readonly workspaceTrusted: boolean;
}

let fallbackRunSequence = 0;

export function useNodeRunWithoutDebugging({
  activeDocument,
  createRunId = createNodeRunId,
  debugRuntimeAvailable,
  gateway,
  hasJavaScriptTypeScriptWorkspace,
  isActiveDocumentJsTest,
  isDebugRuntimeAvailable,
  isWorkspaceCurrent,
  isWorkspaceTrusted,
  readFileIfExists,
  reportError,
  reportWarning,
  requestTerminalSession,
  workspaceFiles,
  workspaceId,
  workspaceRoot,
  workspaceTrusted,
}: UseNodeRunWithoutDebuggingOptions): UseNodeRunWithoutDebuggingResult {
  const [state, setState] = useState<NodeRunWithoutDebuggingState>({ kind: "idle" });
  const mountedRef = useRef(false);
  const ownerGenerationRef = useRef(0);
  const operationGenerationRef = useRef<number | null>(null);
  const operationDocumentPathRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const activeRunRef = useRef<ActiveRun | null>(null);
  const stoppedRunsRef = useRef(new Set<string>());
  const subscriptionErrorRef = useRef<unknown>(null);
  const subscriptionReadyRef = useRef<Promise<void>>(Promise.resolve());
  const currentRef = useRef<CurrentRunContext>({
    activeDocument,
    debugRuntimeAvailable,
    hasJavaScriptTypeScriptWorkspace,
    isActiveDocumentJsTest,
    isDebugRuntimeAvailable,
    isWorkspaceCurrent,
    isWorkspaceTrusted,
    workspaceId,
    workspaceRoot,
    workspaceTrusted,
  });
  currentRef.current = {
    activeDocument,
    debugRuntimeAvailable,
    hasJavaScriptTypeScriptWorkspace,
    isActiveDocumentJsTest,
    isDebugRuntimeAvailable,
    isWorkspaceCurrent,
    isWorkspaceTrusted,
    workspaceId,
    workspaceRoot,
    workspaceTrusted,
  };

  const publish = useCallback((next: NodeRunWithoutDebuggingState) => {
    if (mountedRef.current) setState(next);
  }, []);

  const stopActiveRun = useCallback(
    (run: ActiveRun, reportFailure = false) => {
      const operationKey = `${run.workspaceId}\0${run.runId}`;
      run.stopRequested = true;
      if (!run.startDispatched) {
        run.cancelPendingStart();
        return;
      }
      if (stoppedRunsRef.current.has(operationKey)) return;
      stoppedRunsRef.current.add(operationKey);
      publish({
        kind: "stopping",
        retryable: false,
        runId: run.runId,
        target: run.target,
        terminalSessionId: run.terminalSessionId,
        workspaceId: run.workspaceId,
      });
      void gateway
        .stopNodeRunTask({ runId: run.runId, workspaceId: run.workspaceId })
        .catch((error: unknown) => {
          // A failed stop was not consumed: allow an explicit retry while the
          // exact workspace owner is still current. Generation cannot be used
          // here because `stop()` intentionally invalidates it before dispatch.
          stoppedRunsRef.current.delete(operationKey);
          if (
            reportFailure &&
            mountedRef.current &&
            activeRunRef.current === run &&
            sameWorkspaceOwner(run, currentRef.current)
          ) {
            publish({
              kind: "stopping",
              retryable: true,
              runId: run.runId,
              target: run.target,
              terminalSessionId: run.terminalSessionId,
              workspaceId: run.workspaceId,
            });
            reportError(error);
          }
        });
    },
    [gateway, publish, reportError],
  );

  const eventHandlerRef = useRef<(event: NodeRunTaskStatusEvent) => void>(() => undefined);
  eventHandlerRef.current = (event) => {
    const active = activeRunRef.current;
    if (
      !mountedRef.current ||
      !active ||
      event.runId !== active.runId ||
      event.workspaceId !== active.workspaceId ||
      event.terminalSessionId !== active.terminalSessionId
    )
      return;
    if (event.status === "running") {
      if (active.stopRequested) return;
      publish({
        kind: "running",
        runId: active.runId,
        target: active.target,
        terminalSessionId: active.terminalSessionId,
        workspaceId: active.workspaceId,
      });
      return;
    }
    stoppedRunsRef.current.delete(`${active.workspaceId}\0${active.runId}`);
    inFlightRef.current = false;
    operationGenerationRef.current = null;
    activeRunRef.current = null;
    if (event.status === "failed") {
      publish({ kind: "failed", message: event.message });
      reportError(new Error(event.message));
    } else if (event.status === "exited") {
      publish({ kind: "exited", exitCode: event.exitCode });
    } else {
      publish({ kind: "idle" });
    }
  };

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    subscriptionErrorRef.current = null;
    subscriptionReadyRef.current = gateway
      .subscribeNodeRunTaskStatus((event) => eventHandlerRef.current(event))
      .then((listener) => {
        if (disposed) listener();
        else unsubscribe = listener;
      })
      .catch((error: unknown) => {
        subscriptionErrorRef.current = error;
      });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [gateway]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      ownerGenerationRef.current += 1;
      const active = activeRunRef.current;
      if (active) stopActiveRun(active);
      activeRunRef.current = null;
      inFlightRef.current = false;
      operationGenerationRef.current = null;
    };
  }, [stopActiveRun]);

  useEffect(() => {
    if (!inFlightRef.current || operationDocumentPathRef.current === null) return;
    ownerGenerationRef.current += 1;
    const active = activeRunRef.current;
    if (active) stopActiveRun(active);
    activeRunRef.current = null;
    inFlightRef.current = false;
    operationGenerationRef.current = null;
    publish({ kind: "idle" });
  }, [
    activeDocument?.path,
    activeDocument?.content,
    activeDocument?.savedContent,
    publish,
    stopActiveRun,
  ]);

  useEffect(() => {
    ownerGenerationRef.current += 1;
    const active = activeRunRef.current;
    if (active) stopActiveRun(active);
    activeRunRef.current = null;
    inFlightRef.current = false;
    operationGenerationRef.current = null;
    publish({ kind: "idle" });
  }, [
    debugRuntimeAvailable,
    hasJavaScriptTypeScriptWorkspace,
    publish,
    stopActiveRun,
    workspaceId,
    workspaceRoot,
    workspaceTrusted,
  ]);

  const startCapturedTarget = useCallback(
    (captured: CapturedRunOwner, target: NodeRunTarget): boolean => {
      if (!remainsCurrent(captured, currentRef.current, ownerGenerationRef.current)) {
        finishPrestart(captured, activeRunRef, inFlightRef, operationGenerationRef, publish);
        return false;
      }
      publish({ kind: "waiting-for-terminal", target });
      let terminalRequestSettled = false;
      try {
        requestTerminalSession((terminalSessionId) => {
          if (terminalRequestSettled) return;
          terminalRequestSettled = true;
          if (
            terminalSessionId === null ||
            !Number.isSafeInteger(terminalSessionId) ||
            terminalSessionId < 0 ||
            !remainsCurrent(captured, currentRef.current, ownerGenerationRef.current)
          ) {
            finishPrestart(captured, activeRunRef, inFlightRef, operationGenerationRef, publish);
            return;
          }
          let cancelPendingStart: () => void = () => undefined;
          const startCanceled = new Promise<void>((resolve) => {
            cancelPendingStart = resolve;
          });
          const active: ActiveRun = {
            ...captured,
            cancelPendingStart,
            runId: createRunId(),
            startCanceled,
            startDispatched: false,
            stopRequested: false,
            target,
            terminalSessionId,
          };
          activeRunRef.current = active;
          void startResolvedRun({
            active,
            activeRunRef,
            currentRef,
            gateway,
            inFlightRef,
            ownerGenerationRef,
            operationGenerationRef,
            publish,
            reportError,
            stopActiveRun,
            subscriptionErrorRef,
            subscriptionReadyRef,
          });
        });
        return true;
      } catch (error) {
        if (remainsCurrent(captured, currentRef.current, ownerGenerationRef.current)) {
          reportError(error);
        }
        finishPrestart(captured, activeRunRef, inFlightRef, operationGenerationRef, publish);
        return false;
      }
    },
    [createRunId, gateway, publish, reportError, requestTerminalSession, stopActiveRun],
  );

  const run = useCallback(() => {
    const current = currentRef.current;
    const document = current.activeDocument;
    if (
      !mountedRef.current ||
      inFlightRef.current ||
      !document ||
      !current.debugRuntimeAvailable ||
      !safelyAvailable(current.isDebugRuntimeAvailable) ||
      !current.workspaceRoot ||
      !current.workspaceId ||
      !current.workspaceTrusted ||
      !safelyTrusted(current.isWorkspaceTrusted) ||
      !safelyCurrent(current.isWorkspaceCurrent, current.workspaceRoot, current.workspaceId)
    )
      return;
    if (document.language === "php" || /\.php$/i.test(document.path)) {
      reportWarning("Run Without Debugging does not run PHP targets in the Node runtime.");
      return;
    }
    if (!current.hasJavaScriptTypeScriptWorkspace) return;
    if (document.content !== document.savedContent) {
      reportWarning("Run Without Debugging requires the active file to be saved first.");
      return;
    }
    const captured: CapturedRunOwner = {
      documentPath: document.path,
      generation: ownerGenerationRef.current,
      rootPath: current.workspaceRoot,
      workspaceId: current.workspaceId,
    };
    inFlightRef.current = true;
    operationGenerationRef.current = captured.generation;
    operationDocumentPathRef.current = captured.documentPath;
    publish({ kind: "resolving" });
    void (async () => {
      const resolution = await resolveNodeRunWithoutDebuggingTarget({
        document,
        isActiveDocumentJsTest: current.isActiveDocumentJsTest,
        isCurrent: () => remainsCurrent(captured, currentRef.current, ownerGenerationRef.current),
        readFileIfExists,
        workspaceFiles,
        workspaceRoot: captured.rootPath,
      });
      if (resolution.kind !== "target") {
        if (
          resolution.kind === "warning" &&
          remainsCurrent(captured, currentRef.current, ownerGenerationRef.current)
        )
          reportWarning(resolution.message);
        finishPrestart(captured, activeRunRef, inFlightRef, operationGenerationRef, publish);
        return;
      }
      startCapturedTarget(captured, resolution.target);
    })().catch((error: unknown) => {
      if (remainsCurrent(captured, currentRef.current, ownerGenerationRef.current)) {
        reportError(error);
        publish({ kind: "failed", message: errorMessage(error) });
      }
      finishPrestart(captured, activeRunRef, inFlightRef, operationGenerationRef, publish);
    });
  }, [publish, readFileIfExists, reportError, reportWarning, startCapturedTarget, workspaceFiles]);

  const startTarget = useCallback(
    (target: NodeRunTarget): boolean => {
      const current = currentRef.current;
      const rootPath = current.workspaceRoot;
      const currentWorkspaceId = current.workspaceId;
      if (
        !mountedRef.current ||
        inFlightRef.current ||
        !current.debugRuntimeAvailable ||
        !safelyAvailable(current.isDebugRuntimeAvailable) ||
        !rootPath ||
        !currentWorkspaceId ||
        !current.workspaceTrusted ||
        !safelyTrusted(current.isWorkspaceTrusted) ||
        !safelyCurrent(current.isWorkspaceCurrent, rootPath, currentWorkspaceId)
      ) {
        return false;
      }
      let validated: NodeRunTarget;
      try {
        validated = parseNodeRunTarget(target);
      } catch {
        return false;
      }
      if (!nodeRunTargetWithinWorkspace(validated, rootPath)) return false;
      const captured: CapturedRunOwner = {
        documentPath: null,
        generation: ownerGenerationRef.current,
        rootPath,
        workspaceId: currentWorkspaceId,
      };
      inFlightRef.current = true;
      operationGenerationRef.current = captured.generation;
      operationDocumentPathRef.current = null;
      return startCapturedTarget(captured, validated);
    },
    [startCapturedTarget],
  );

  const stop = useCallback(() => {
    ownerGenerationRef.current += 1;
    const active = activeRunRef.current;
    if (active?.startDispatched) stopActiveRun(active, true);
    else {
      active?.cancelPendingStart();
      activeRunRef.current = null;
      inFlightRef.current = false;
      operationGenerationRef.current = null;
      publish({ kind: "idle" });
    }
  }, [publish, stopActiveRun]);

  return { pending: inFlightRef.current, run, startTarget, state, stop };
}

async function startResolvedRun(options: {
  readonly active: ActiveRun;
  readonly activeRunRef: { current: ActiveRun | null };
  readonly currentRef: { current: CurrentRunContext };
  readonly gateway: NodeRunTaskGateway;
  readonly inFlightRef: { current: boolean };
  readonly ownerGenerationRef: { current: number };
  readonly operationGenerationRef: { current: number | null };
  readonly publish: (state: NodeRunWithoutDebuggingState) => void;
  readonly reportError: (error: unknown) => void;
  readonly stopActiveRun: (run: ActiveRun, reportFailure?: boolean) => void;
  readonly subscriptionErrorRef: { current: unknown };
  readonly subscriptionReadyRef: { current: Promise<void> };
}) {
  const {
    active,
    activeRunRef,
    currentRef,
    gateway,
    inFlightRef,
    ownerGenerationRef,
    operationGenerationRef,
    publish,
    reportError,
    stopActiveRun,
    subscriptionErrorRef,
    subscriptionReadyRef,
  } = options;
  try {
    const subscriptionOutcome = await Promise.race([
      subscriptionReadyRef.current.then(() => "ready" as const),
      active.startCanceled.then(() => "canceled" as const),
    ]);
    if (subscriptionOutcome === "canceled") {
      finishPrestart(active, activeRunRef, inFlightRef, operationGenerationRef, publish);
      return;
    }
    if (subscriptionErrorRef.current) throw subscriptionErrorRef.current;
    if (
      !activeStillOwned(
        active,
        activeRunRef,
        currentRef.current,
        operationGenerationRef,
        ownerGenerationRef.current,
      )
    ) {
      finishPrestart(active, activeRunRef, inFlightRef, operationGenerationRef, publish);
      return;
    }
    active.startDispatched = true;
    publish({
      kind: "starting",
      runId: active.runId,
      target: active.target,
      terminalSessionId: active.terminalSessionId,
      workspaceId: active.workspaceId,
    });
    const result = await gateway.startNodeRunTask({
      runId: active.runId,
      target: active.target,
      terminalSessionId: active.terminalSessionId,
      workspaceId: active.workspaceId,
    });
    if (result.runId !== active.runId) throw new Error("Node run start response lost ownership.");
    if (
      !activeStillOwned(
        active,
        activeRunRef,
        currentRef.current,
        operationGenerationRef,
        ownerGenerationRef.current,
      )
    ) {
      if (activeRunRef.current === active) stopActiveRun(active);
      return;
    }
    await gateway.acknowledgeNodeRunTaskStart({
      runId: active.runId,
      workspaceId: active.workspaceId,
    });
    if (
      !activeStillOwned(
        active,
        activeRunRef,
        currentRef.current,
        operationGenerationRef,
        ownerGenerationRef.current,
      )
    ) {
      if (activeRunRef.current === active) stopActiveRun(active);
      return;
    }
    publish({
      kind: "running",
      runId: active.runId,
      target: active.target,
      terminalSessionId: active.terminalSessionId,
      workspaceId: active.workspaceId,
    });
  } catch (error) {
    const current = activeStillOwned(
      active,
      activeRunRef,
      currentRef.current,
      operationGenerationRef,
      ownerGenerationRef.current,
    );
    if (active.startDispatched && activeRunRef.current === active) stopActiveRun(active, current);
    else finishPrestart(active, activeRunRef, inFlightRef, operationGenerationRef, publish);
    if (current) {
      reportError(error);
      publish({ kind: "failed", message: errorMessage(error) });
    }
  }
}

function finishPrestart(
  owner: CapturedRunOwner,
  activeRunRef: { current: ActiveRun | null },
  inFlightRef: { current: boolean },
  operationGenerationRef: { current: number | null },
  publish: (state: NodeRunWithoutDebuggingState) => void,
) {
  if (operationGenerationRef.current !== owner.generation) return;
  if (activeRunRef.current?.generation === owner.generation) activeRunRef.current = null;
  inFlightRef.current = false;
  operationGenerationRef.current = null;
  publish({ kind: "idle" });
}

function remainsCurrent(
  owner: CapturedRunOwner,
  current: {
    readonly activeDocument: EditorDocument | null;
    readonly debugRuntimeAvailable: boolean;
    readonly isDebugRuntimeAvailable: () => boolean;
    readonly isWorkspaceCurrent: (rootPath: string, workspaceId: string) => boolean;
    readonly isWorkspaceTrusted: () => boolean;
    readonly workspaceId: string | null;
    readonly workspaceRoot: string | null;
    readonly workspaceTrusted: boolean;
  },
  generation: number,
): boolean {
  return (
    owner.generation === generation &&
    (owner.documentPath === null ||
      (current.activeDocument?.path === owner.documentPath &&
        current.activeDocument.content === current.activeDocument.savedContent)) &&
    current.debugRuntimeAvailable &&
    safelyAvailable(current.isDebugRuntimeAvailable) &&
    current.workspaceId === owner.workspaceId &&
    current.workspaceRoot === owner.rootPath &&
    current.workspaceTrusted &&
    safelyTrusted(current.isWorkspaceTrusted) &&
    safelyCurrent(current.isWorkspaceCurrent, owner.rootPath, owner.workspaceId)
  );
}

function activeStillOwned(
  active: ActiveRun,
  activeRunRef: { current: ActiveRun | null },
  current: CurrentRunContext,
  operationGenerationRef: { current: number | null },
  ownerGeneration: number,
): boolean {
  return (
    activeRunRef.current === active &&
    operationGenerationRef.current === active.generation &&
    remainsCurrent(active, current, ownerGeneration)
  );
}

function sameWorkspaceOwner(
  owner: Pick<CapturedRunOwner, "rootPath" | "workspaceId">,
  current: Pick<CurrentRunContext, "isWorkspaceCurrent" | "workspaceId" | "workspaceRoot">,
): boolean {
  return (
    current.workspaceId === owner.workspaceId &&
    current.workspaceRoot === owner.rootPath &&
    safelyCurrent(current.isWorkspaceCurrent, owner.rootPath, owner.workspaceId)
  );
}

function safelyTrusted(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}

function nodeRunTargetWithinWorkspace(target: NodeRunTarget, rootPath: string): boolean {
  const contains = (path: string) => isSessionPathInWorkspace(rootPath, path);
  const cwdIsContained = !("cwd" in target) || target.cwd === undefined || contains(target.cwd);
  if (!cwdIsContained) return false;
  switch (target.kind) {
    case "node-script":
    case "node-configured-script":
      return contains(target.scriptPath);
    case "js-test-file":
    case "js-configured-test":
      return contains(target.filePath) && contains(target.packageRootPath);
    case "node-npm-script":
      return contains(target.packageRootPath);
  }
}

function safelyAvailable(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}

function safelyCurrent(
  check: (rootPath: string, workspaceId: string) => boolean,
  rootPath: string,
  workspaceId: string,
): boolean {
  try {
    return check(rootPath, workspaceId);
  } catch {
    return false;
  }
}

function createNodeRunId(): string {
  fallbackRunSequence = (fallbackRunSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `node-run-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${fallbackRunSequence}`}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Could not run Node target.";
}
