import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { jsTestDeclarations } from "../domain/jsTestDeclarations";
import {
  markJsTestExplorerScopeRunning,
  mergeJsTestExplorerRunResponse,
} from "../domain/jsTestExplorerResults";
import {
  buildJsTestExplorerTree,
  jsTestExplorerTestId,
  type JsTestExplorerTestDiscovery,
  type JsTestExplorerWorkspaceNode,
} from "../domain/jsTestExplorerTree";
import {
  mergeJsTestProblemsSnapshot,
  type JsTestProblemsOwner,
  type JsTestProblemsSnapshot,
} from "../domain/jsTestProblems";
import {
  validatedJsTestRunScope,
  type JsTestGateway,
  type JsTestRunScope,
} from "../domain/jsTestRunScope";
import type { JsTestRunnableScope } from "../domain/jsTestRunSelection";
import type {
  JsTestWatchCommand,
  JsTestWatchGateway,
  JsTestWatchOutputEvent,
  JsTestWatchOwner,
  JsTestWatchStatusEvent,
} from "../domain/jsTestCommand";
import type { WorkspaceTestDiscoveryGateway } from "../domain/jsTestDiscovery";
import type { JsTestExecutionRootResolver } from "./jsTestExecutionRootResolver";
import type { TestRunOk, TestRunResponse } from "../domain/testResults";
import { jsTestFailedRunScopes, type JsTestFailedRunPlan } from "../domain/jsTestFailedRunScopes";
import type { JsTestTaskGateway } from "../domain/jsTestTask";
import type { JsTestBatchGateway, JsTestBatchPackageResult } from "../domain/jsTestBatch";
import {
  aggregateJsTestTaskOutputs,
  jsTestOutputSnapshot,
  type JsTestOutputSnapshot,
} from "../domain/jsTestOutput";
import { createJsTestFailedRunCoordinator } from "./jsTestFailedRunCoordinator";
import { createJsTestSingleRunCoordinator } from "./jsTestSingleRunCoordinator";
import { secureJsTestTaskRunId } from "./jsTestTaskRunId";
import {
  aggregateJsTestRunResults,
  jsTestFailedRunPlanForBatch,
  planJsTestExplorerBatch,
  runJsTestExplorerBatch,
  type JsTestExplorerBatchCoordinator,
} from "./jsTestExplorerBatchRun";
import {
  createNativeJsTestWatchOutputBuffer,
  type NativeJsTestWatchOutputBuffer,
} from "./nativeJsTestWatchOutputBuffer";
import {
  createJsTestContinuousRunCoordinator,
  type JsTestContinuousRunLease,
  type JsTestContinuousRunOwner,
  type JsTestContinuousRunSnapshot,
  type JsTestContinuousRunStrategy,
} from "./jsTestContinuousRunCoordinator";

const DISCOVERY_LIMITS = { maxFiles: 500, maxVisited: 50_000 } as const;
const MAX_TEST_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_DECLARATIONS = 20_000;
const READ_CONCURRENCY = 8;
const INVALIDATION_DEBOUNCE_MS = 75;
let activeFailedRunLease: object | null = null;

interface WorkspaceExplorerState {
  readonly discoveries: readonly JsTestExplorerTestDiscovery[];
  readonly error: string | null;
  readonly loading: boolean;
  readonly loaded: boolean;
  readonly outputSnapshot: JsTestOutputSnapshot | null;
  readonly problemSnapshot: JsTestProblemsSnapshot | null;
  readonly result: TestRunOk | null;
  readonly running: boolean;
  readonly truncated: boolean;
  readonly unavailable: string | null;
}

interface JsTestDiscoveryExecutionSnapshot {
  readonly filePaths: readonly string[];
  readonly truncated: boolean;
}

export interface UseJsTestExplorerOptions {
  readonly batchGateway?: JsTestBatchGateway | null;
  readonly continuousRunBlocked?: boolean;
  readonly continuousRunVersion?: number;
  readonly continuousRunWatchCommand?: JsTestWatchCommand | null;
  readonly discoveryVersion: number;
  readonly discoveryGateway: WorkspaceTestDiscoveryGateway;
  readonly isOpen: boolean;
  readonly rootPath: string | null;
  readonly resultInvalidationVersion: number;
  readonly runGateway: JsTestGateway;
  readonly resolveExecutionRoot?: JsTestExecutionRootResolver;
  readonly runRequestVersion: number;
  readonly taskGateway?: JsTestTaskGateway | null;
  readonly watchGateway?: JsTestWatchGateway | null;
  readonly createTaskRunId?: (() => string) | null;
  readonly workspaceId: string | null;
  readonly workspaceTrusted: boolean;
}

export interface JsTestExplorerState {
  readonly continuousRunEnabled: boolean;
  readonly continuousRunPending: boolean;
  readonly continuousRunRunning: boolean;
  readonly continuousRunStopping: boolean;
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly isRunning: boolean;
  readonly problemSnapshot: JsTestProblemsSnapshot | null;
  readonly outputSnapshot: JsTestOutputSnapshot | null;
  readonly result: TestRunOk | null;
  readonly tree: JsTestExplorerWorkspaceNode | null;
  readonly truncated: boolean;
  readonly unavailable: string | null;
  readonly failedRunCompleted: number;
  readonly failedRunPhase: "idle" | "running" | "cancelling" | "invalidating";
  readonly failedRunTotal: number;
  refresh(): Promise<void>;
  canCancelTestRun(): boolean;
  canStartContinuousRun(): boolean;
  canRerunFailedTests(): boolean;
  canRerunLastRun(): boolean;
  canRunScope(scope: JsTestRunnableScope): boolean;
  rerunLastRun(): Promise<boolean>;
  rerunFailedTests(): Promise<boolean>;
  cancelTestRun(): Promise<boolean>;
  startContinuousRun(): boolean;
  stopContinuousRun(): Promise<boolean>;
  run(scope: JsTestRunScope): Promise<void>;
  runScope(scope: JsTestRunnableScope): Promise<boolean>;
}

interface JsTestExplorerActivation {
  readonly batchGateway: JsTestBatchGateway | null;
  readonly discoveryGateway: WorkspaceTestDiscoveryGateway;
  readonly discoveryVersion: number;
  readonly resultInvalidationVersion: number;
  readonly runGateway: JsTestGateway;
  readonly resolveExecutionRoot: JsTestExecutionRootResolver;
  readonly taskGateway: JsTestTaskGateway | null;
  readonly workspaceKey: string | null;
  readonly workspaceTrusted: boolean;
}

interface JsTestExplorerLastRun {
  readonly activation: number;
  readonly scope: JsTestRunScope;
}

interface JsTestExplorerFailedPlan {
  readonly activation: number;
  readonly plan: Extract<JsTestFailedRunPlan, { readonly status: "available" }>;
}

interface ActiveExplorerRun {
  batchCoordinator: JsTestExplorerBatchCoordinator | null;
  cancelRequested: boolean;
  readonly continuousLease: JsTestContinuousRunLease | null;
  singleCoordinator: ReturnType<typeof createJsTestSingleRunCoordinator> | null;
}

interface ActiveContinuousWatch {
  cancelRequested: boolean;
  cleanupRequired: boolean;
  readonly gateway: JsTestWatchGateway;
  lastOutputSequence: number;
  readonly lease: JsTestContinuousRunLease;
  readonly owner: JsTestWatchOwner;
  readonly outputBuffer: NativeJsTestWatchOutputBuffer;
  settlement: Promise<boolean> | null;
  startDispatched: boolean;
  started: boolean;
  stopFlight: Promise<boolean> | null;
  terminal: boolean;
  unsubscribeOutput: (() => void) | null;
  unsubscribeStatus: (() => void) | null;
  readonly workspaceKey: string;
}

interface JsTestContinuousWatchCapability {
  readonly command: JsTestWatchCommand | null;
  readonly gateway: JsTestWatchGateway | null;
}

interface JsTestContinuousOwnerBoundary {
  readonly blocked: boolean;
  readonly command: JsTestWatchCommand | null;
  readonly taskGateway: JsTestTaskGateway | null;
  readonly watchGateway: JsTestWatchGateway | null;
  readonly workspaceKey: string | null;
  readonly workspaceTrusted: boolean;
}

const EMPTY_CONTINUOUS_RUN_SNAPSHOT: JsTestContinuousRunSnapshot = Object.freeze({
  changeVersion: null,
  enabled: false,
  owner: null,
  pending: false,
  running: false,
  stopping: false,
});

const EMPTY_STATE: WorkspaceExplorerState = {
  discoveries: [],
  error: null,
  loading: false,
  loaded: false,
  problemSnapshot: null,
  outputSnapshot: null,
  result: null,
  running: false,
  truncated: false,
  unavailable: null,
};

export function useJsTestExplorer({
  batchGateway = null,
  continuousRunBlocked = false,
  continuousRunVersion = 0,
  continuousRunWatchCommand = null,
  discoveryVersion,
  discoveryGateway,
  isOpen,
  rootPath,
  resultInvalidationVersion,
  runGateway,
  resolveExecutionRoot = workspaceExecutionRoot,
  runRequestVersion,
  taskGateway = null,
  watchGateway = null,
  createTaskRunId = null,
  workspaceId,
  workspaceTrusted,
}: UseJsTestExplorerOptions): JsTestExplorerState {
  const [states, setStates] = useState<Record<string, WorkspaceExplorerState>>({});
  const [failedProgress, setFailedProgress] = useState({
    completed: 0,
    phase: "idle" as JsTestExplorerState["failedRunPhase"],
    total: 0,
  });
  const mountedRef = useRef(true);
  const continuousOwnerEpochRef = useRef(0);
  const continuousOwnerRefreshPendingRef = useRef(false);
  const [continuousRunSnapshot, setContinuousRunSnapshot] = useState<JsTestContinuousRunSnapshot>(
    EMPTY_CONTINUOUS_RUN_SNAPSHOT,
  );
  const executeContinuousRunRef = useRef<(lease: JsTestContinuousRunLease) => Promise<boolean>>(
    async () => false,
  );
  const cancelContinuousRunRef = useRef<(lease: JsTestContinuousRunLease) => Promise<boolean>>(
    async () => false,
  );
  const continuousWatchCapabilityRef = useRef<JsTestContinuousWatchCapability>({
    command: continuousRunWatchCommand,
    gateway: watchGateway,
  });
  continuousWatchCapabilityRef.current = {
    command: continuousRunWatchCommand,
    gateway: watchGateway,
  };
  const activeContinuousWatchRef = useRef<ActiveContinuousWatch | null>(null);
  const [continuousRunCoordinator] = useState(() =>
    createJsTestContinuousRunCoordinator({
      cancel: (lease) => cancelContinuousRunRef.current(lease),
      onSnapshot: (snapshot) => {
        if (continuousOwnerRefreshPendingRef.current && !snapshot.enabled && !snapshot.stopping) {
          continuousOwnerRefreshPendingRef.current = false;
          continuousOwnerEpochRef.current += 1;
        }
        if (mountedRef.current) setContinuousRunSnapshot(snapshot);
      },
      run: (lease) => executeContinuousRunRef.current(lease),
      strategy: (): JsTestContinuousRunStrategy =>
        continuousWatchCapabilityRef.current.command && continuousWatchCapabilityRef.current.gateway
          ? "native-watch"
          : "debounced-rescope",
    }),
  );
  const discoveryInvalidationTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pendingDiscoveryInvalidations = useRef(new Set<string>());
  const discoverySequences = useRef(new Map<string, number>());
  const discoveryExecutionSnapshots = useRef(new Map<string, JsTestDiscoveryExecutionSnapshot>());
  const discoveryVersionRef = useRef(discoveryVersion);
  const inFlightRuns = useRef(new Set<string>());
  const problemGenerations = useRef(new Map<string, number>());
  const resultInvalidationVersions = useRef(new Map<string, number>());
  const runSequences = useRef(new Map<string, number>());
  const requestVersionRef = useRef(runRequestVersion);
  const workspaceKey = workspaceId && rootPath ? `${workspaceId}\u0000${rootPath}` : null;
  const activationRef = useRef(0);
  const activationBoundaryRef = useRef<JsTestExplorerActivation | null>(null);
  const lastRunRef = useRef<JsTestExplorerLastRun | null>(null);
  const failedPlanRef = useRef<JsTestExplorerFailedPlan | null>(null);
  const failedCoordinatorRef = useRef<ReturnType<typeof createJsTestFailedRunCoordinator> | null>(
    null,
  );
  const singleCoordinatorRef = useRef<ReturnType<typeof createJsTestSingleRunCoordinator> | null>(
    null,
  );
  const batchCoordinatorRef = useRef<JsTestExplorerBatchCoordinator | null>(null);
  const activeExplorerRunRef = useRef<ActiveExplorerRun | null>(null);
  const failedBatchIdentityRef = useRef<object | null>(null);
  const activationBoundary: JsTestExplorerActivation = {
    batchGateway,
    discoveryGateway,
    discoveryVersion,
    resultInvalidationVersion,
    runGateway,
    resolveExecutionRoot,
    taskGateway,
    workspaceKey,
    workspaceTrusted,
  };
  if (!sameActivation(activationBoundaryRef.current, activationBoundary)) {
    activationBoundaryRef.current = activationBoundary;
    activationRef.current += 1;
    lastRunRef.current = null;
    failedPlanRef.current = null;
    if (workspaceKey) discoveryExecutionSnapshots.current.delete(workspaceKey);
  }
  const activation = activationRef.current;
  const continuousOwnerBoundaryRef = useRef<JsTestContinuousOwnerBoundary | null>(null);
  const continuousOwnerBoundary = {
    blocked: continuousRunBlocked,
    command: continuousRunWatchCommand,
    taskGateway,
    watchGateway,
    workspaceKey,
    workspaceTrusted,
  };
  if (!sameContinuousOwnerBoundary(continuousOwnerBoundaryRef.current, continuousOwnerBoundary)) {
    continuousOwnerBoundaryRef.current = continuousOwnerBoundary;
    continuousOwnerEpochRef.current += 1;
  }
  const continuousOwner: JsTestContinuousRunOwner | null =
    !continuousRunBlocked &&
    (taskGateway || (watchGateway && continuousRunWatchCommand)) &&
    workspaceKey &&
    workspaceId &&
    rootPath &&
    workspaceTrusted
      ? Object.freeze({
          epoch: continuousOwnerEpochRef.current,
          rootKey: rootPath,
          workspaceId,
        })
      : null;
  const continuousOwnerRef = useRef(continuousOwner);
  continuousOwnerRef.current = continuousOwner;
  const currentContinuousRunSnapshot =
    continuousOwner &&
    continuousRunSnapshot.owner &&
    continuousOwnersEqual(continuousOwner, continuousRunSnapshot.owner)
      ? continuousRunSnapshot
      : EMPTY_CONTINUOUS_RUN_SNAPSHOT;
  const currentKeyRef = useRef(workspaceKey);
  currentKeyRef.current = workspaceKey;
  const state = workspaceKey ? (states[workspaceKey] ?? EMPTY_STATE) : EMPTY_STATE;
  const currentOutputSnapshot =
    state.outputSnapshot?.generation === activation ? state.outputSnapshot : null;

  const discover = useCallback(async (): Promise<readonly JsTestExplorerTestDiscovery[]> => {
    if (!workspaceKey || !rootPath) return [];
    const sequence = (discoverySequences.current.get(workspaceKey) ?? 0) + 1;
    discoverySequences.current.set(workspaceKey, sequence);
    setStates((current) => ({
      ...current,
      [workspaceKey]: { ...(current[workspaceKey] ?? EMPTY_STATE), error: null, loading: true },
    }));

    try {
      const enumeration = await discoveryGateway.enumerateJsTestFiles(rootPath, DISCOVERY_LIMITS);
      let omittedLargeFile = false;
      let stoppedByBudget = false;
      let totalSourceBytes = 0;
      let totalDeclarations = 0;
      const batches = await mapConcurrent(enumeration.files, READ_CONCURRENCY, async (filePath) => {
        if (
          currentKeyRef.current !== workspaceKey ||
          discoverySequences.current.get(workspaceKey) !== sequence ||
          stoppedByBudget
        ) {
          return [];
        }
        const read = await discoveryGateway.readTextFileBounded(
          rootPath,
          filePath,
          MAX_TEST_FILE_BYTES,
        );
        if (read.status === "tooLarge") {
          omittedLargeFile = true;
          return [];
        }
        if (
          currentKeyRef.current !== workspaceKey ||
          discoverySequences.current.get(workspaceKey) !== sequence
        ) {
          return [];
        }
        const sourceBytes = new TextEncoder().encode(read.content).byteLength;
        if (totalSourceBytes + sourceBytes > MAX_TOTAL_SOURCE_BYTES) {
          stoppedByBudget = true;
          return [];
        }
        totalSourceBytes += sourceBytes;
        const remainingDeclarations = MAX_DECLARATIONS - totalDeclarations;
        if (remainingDeclarations <= 0) {
          stoppedByBudget = true;
          return [];
        }
        const declarations = jsTestDeclarations(read.content)
          .filter((declaration) => declaration.kind === "test")
          .slice(0, remainingDeclarations);
        totalDeclarations += declarations.length;
        if (totalDeclarations >= MAX_DECLARATIONS) stoppedByBudget = true;
        return declarations.map<JsTestExplorerTestDiscovery>((declaration) => ({
          filePath,
          parameterized: declaration.parameterized,
          suitePath: declaration.suitePath,
          target: declaration.target,
        }));
      });
      const discovered = batches.flat();

      if (
        currentKeyRef.current !== workspaceKey ||
        discoverySequences.current.get(workspaceKey) !== sequence
      ) {
        if (discoverySequences.current.get(workspaceKey) === sequence) {
          setStates((current) => ({
            ...current,
            [workspaceKey]: {
              ...(current[workspaceKey] ?? EMPTY_STATE),
              loading: false,
              loaded: false,
            },
          }));
        }
        return discovered;
      }
      const truncated = enumeration.truncated || omittedLargeFile || stoppedByBudget;
      discoveryExecutionSnapshots.current.set(
        workspaceKey,
        Object.freeze({
          filePaths: Object.freeze([...enumeration.files]),
          truncated,
        }),
      );
      setStates((current) => {
        const previous = current[workspaceKey] ?? EMPTY_STATE;
        const statuses = new Map(
          previous.discoveries.map((item) => [jsTestExplorerTestId(item), item.status] as const),
        );
        return {
          ...current,
          [workspaceKey]: {
            ...previous,
            discoveries: discovered.map((item) => ({
              ...item,
              status: statuses.get(jsTestExplorerTestId(item)) ?? "idle",
            })),
            loading: false,
            loaded: true,
            truncated,
          },
        };
      });
      return discovered;
    } catch (error) {
      if (discoverySequences.current.get(workspaceKey) === sequence) {
        discoveryExecutionSnapshots.current.delete(workspaceKey);
        setStates((current) => ({
          ...current,
          [workspaceKey]: {
            ...(current[workspaceKey] ?? EMPTY_STATE),
            error: errorMessage(error),
            loading: false,
            loaded: true,
          },
        }));
      }
      return [];
    }
  }, [discoveryGateway, rootPath, workspaceKey]);

  const refresh = useCallback(async () => {
    if (workspaceKey && inFlightRuns.current.has(workspaceKey)) return;
    await discover();
  }, [discover, workspaceKey]);

  const settleStaleRun = useCallback(
    (
      capturedWorkspaceKey: string,
      sequence: number,
      scope: JsTestRunScope,
      capturedRootPath: string,
    ): void => {
      if (runSequences.current.get(capturedWorkspaceKey) !== sequence) return;
      setStates((current) => {
        if (runSequences.current.get(capturedWorkspaceKey) !== sequence) return current;
        const previous = current[capturedWorkspaceKey] ?? EMPTY_STATE;
        return {
          ...current,
          [capturedWorkspaceKey]: {
            ...previous,
            discoveries: mergeJsTestExplorerRunResponse(
              previous.discoveries,
              scope,
              { message: "Stale JavaScript test run.", status: "error" },
              capturedRootPath,
            ),
            running: false,
          },
        };
      });
    },
    [],
  );

  const executeRun = useCallback(
    async (
      scope: JsTestRunScope,
      continuousLease: JsTestContinuousRunLease | null = null,
    ): Promise<boolean> => {
      if (!workspaceKey || !rootPath) return false;
      if (
        continuousLease === null &&
        (continuousRunCoordinator.snapshot().enabled ||
          continuousRunCoordinator.snapshot().stopping)
      ) {
        return false;
      }
      if (!workspaceTrusted) {
        setStates((current) => ({
          ...current,
          [workspaceKey]: {
            ...(current[workspaceKey] ?? EMPTY_STATE),
            unavailable: "Trust this workspace to run JavaScript tests.",
          },
        }));
        return false;
      }
      if (activeExplorerRunRef.current !== null || inFlightRuns.current.has(workspaceKey)) {
        return false;
      }
      if (continuousLease !== null && activeFailedRunLease !== null) return false;
      if (continuousLease !== null && continuousRunBlocked) return false;
      const validatedScope = immutableValidatedRunScope(scope);
      if (!validatedScope) return false;
      const capturedActivation = activationRef.current;
      const runOwnership: ActiveExplorerRun = {
        batchCoordinator: null,
        cancelRequested: false,
        continuousLease,
        singleCoordinator: null,
      };
      activeExplorerRunRef.current = runOwnership;
      inFlightRuns.current.add(workspaceKey);

      try {
        const sequence = (runSequences.current.get(workspaceKey) ?? 0) + 1;
        runSequences.current.set(workspaceKey, sequence);
        const problemGeneration = nextProblemGeneration(problemGenerations.current, workspaceKey);
        const capturedProblemOwner = problemOwner(workspaceId, rootPath);
        const taskBatchGateway =
          continuousLease === null && validatedScope.kind === "all" ? batchGateway : null;
        let available = states[workspaceKey]?.discoveries ?? [];
        let executionSnapshot = discoveryExecutionSnapshots.current.get(workspaceKey);
        if (available.length === 0 || (taskBatchGateway && !executionSnapshot)) {
          available = await discover();
          executionSnapshot = discoveryExecutionSnapshots.current.get(workspaceKey);
        }
        const batchPlan = taskBatchGateway
          ? executionSnapshot
            ? await planJsTestExplorerBatch({
                discoveries: available,
                discoveryTruncated: executionSnapshot.truncated,
                filePaths: executionSnapshot.filePaths,
                isCurrent: () =>
                  !runOwnership.cancelRequested &&
                  mountedRef.current &&
                  activationRef.current === capturedActivation &&
                  currentKeyRef.current === workspaceKey,
                resolveExecutionRoot,
              })
            : {
                message: "JavaScript test Run All requires complete, stable package discovery.",
                status: "error" as const,
              }
          : null;
        if (batchPlan?.status === "stale") {
          settleStaleRun(workspaceKey, sequence, validatedScope, rootPath);
          return false;
        }
        if (batchPlan?.status === "error") {
          throw new Error(batchPlan.message);
        }
        const executionAuthority =
          taskBatchGateway && batchPlan?.status === "available"
            ? null
            : await resolveExecutionRoot(validatedScope);
        if (
          runOwnership.cancelRequested ||
          currentKeyRef.current !== workspaceKey ||
          runSequences.current.get(workspaceKey) !== sequence ||
          activationRef.current !== capturedActivation
        ) {
          settleStaleRun(workspaceKey, sequence, validatedScope, rootPath);
          return false;
        }
        setStates((current) => ({
          ...current,
          [workspaceKey]: {
            ...(current[workspaceKey] ?? EMPTY_STATE),
            discoveries: markJsTestExplorerScopeRunning(
              current[workspaceKey]?.discoveries.length
                ? current[workspaceKey]!.discoveries
                : available,
              validatedScope,
            ),
            error: null,
            running: true,
            unavailable: null,
          },
        }));

        try {
          if (runOwnership.cancelRequested) return false;
          let response: TestRunResponse;
          let outputSnapshot: JsTestOutputSnapshot | null = null;
          let batchPackageResults: readonly JsTestBatchPackageResult[] | null = null;
          if (taskBatchGateway && batchPlan?.status === "available" && workspaceId) {
            const outcome = await runJsTestExplorerBatch({
              activation: capturedActivation,
              createRunId: createTaskRunId ?? secureJsTestTaskRunId,
              gateway: taskBatchGateway,
              isCurrent: (ownerActivation, ownerWorkspaceId) =>
                mountedRef.current &&
                activationRef.current === ownerActivation &&
                currentKeyRef.current === workspaceKey &&
                ownerWorkspaceId === workspaceId,
              onCoordinator: (coordinator) => {
                runOwnership.batchCoordinator = coordinator;
                batchCoordinatorRef.current = coordinator;
              },
              packages: batchPlan.packages,
              workspaceId,
            });
            if (runOwnership.cancelRequested) {
              settleStaleRun(workspaceKey, sequence, validatedScope, rootPath);
              return false;
            }
            if (outcome.status === "stale") {
              settleStaleRun(workspaceKey, sequence, validatedScope, rootPath);
              return false;
            }
            if (outcome.status === "error") {
              response = { message: outcome.message, status: "error" };
            } else {
              response = outcome.response;
              batchPackageResults = outcome.packages;
              outputSnapshot = outcome.output
                ? jsTestOutputSnapshot(
                    { rootPath, workspaceId },
                    capturedActivation,
                    outcome.output,
                  )
                : null;
            }
          } else if (taskGateway && workspaceId && executionAuthority) {
            if (runOwnership.cancelRequested) return false;
            const coordinator = createJsTestSingleRunCoordinator({
              createRunId: createTaskRunId ?? secureJsTestTaskRunId,
              gateway: taskGateway,
              isCurrent: (ownerActivation, ownerWorkspaceId) =>
                mountedRef.current &&
                activationRef.current === ownerActivation &&
                currentKeyRef.current === workspaceKey &&
                ownerWorkspaceId === workspaceId,
            });
            runOwnership.singleCoordinator = coordinator;
            singleCoordinatorRef.current = coordinator;
            const outcome = await coordinator.start({
              activation: capturedActivation,
              authority: executionAuthority,
              scope: validatedScope,
              workspaceId,
            });
            if (singleCoordinatorRef.current === coordinator) {
              singleCoordinatorRef.current = null;
            }
            if (runOwnership.cancelRequested) {
              settleStaleRun(workspaceKey, sequence, validatedScope, rootPath);
              return false;
            }
            if (outcome.status === "stale" || outcome.status === "rejected") {
              settleStaleRun(workspaceKey, sequence, validatedScope, rootPath);
              return false;
            }
            if (outcome.status === "error") {
              response = { message: outcome.message, status: "error" };
            } else {
              outputSnapshot = jsTestOutputSnapshot(
                { rootPath, workspaceId },
                capturedActivation,
                outcome.envelope.output,
              );
              response =
                outcome.envelope.response.status === "cancelled"
                  ? { message: "JavaScript test run was cancelled.", status: "error" }
                  : outcome.envelope.response;
            }
          } else if (executionAuthority) {
            response = await runGateway.run(rootPath, validatedScope, executionAuthority);
          } else {
            response = {
              message: "JavaScript test execution authority is unavailable.",
              status: "error",
            };
          }
          if (runSequences.current.get(workspaceKey) !== sequence) {
            return false;
          }
          if (
            currentKeyRef.current !== workspaceKey ||
            activationRef.current !== capturedActivation
          ) {
            settleStaleRun(workspaceKey, sequence, validatedScope, rootPath);
            return false;
          }
          setStates((current) => {
            const previous = current[workspaceKey] ?? EMPTY_STATE;
            const problemSnapshot =
              response.status === "ok"
                ? mergeJsTestProblemsSnapshot(previous.problemSnapshot, {
                    generation: problemGeneration,
                    owner: capturedProblemOwner,
                    response,
                    scope: validatedScope,
                  })
                : previous.problemSnapshot;
            const discoveries = mergeJsTestExplorerRunResponse(
              previous.discoveries,
              validatedScope,
              response,
              rootPath,
            );
            if (response.status === "ok") {
              const plan = batchPackageResults
                ? jsTestFailedRunPlanForBatch({
                    discoveries,
                    discoveryTruncated: previous.truncated,
                    packages: batchPackageResults,
                    rootPath,
                  })
                : jsTestFailedRunScopes({
                    discoveries,
                    discoveryTruncated: previous.truncated,
                    response,
                    rootPath,
                  });
              failedPlanRef.current =
                plan.status === "available" && plan.scopes.length > 0
                  ? Object.freeze({ activation: capturedActivation, plan })
                  : null;
            }
            return {
              ...current,
              [workspaceKey]: {
                ...previous,
                discoveries,
                error: response.status === "error" ? response.message : null,
                outputSnapshot: outputSnapshot ?? previous.outputSnapshot,
                problemSnapshot,
                result: response.status === "ok" ? response : previous.result,
                running: false,
                unavailable: response.status === "unavailable" ? response.message : null,
              },
            };
          });
          if (
            response.status === "ok" &&
            currentKeyRef.current === workspaceKey &&
            runSequences.current.get(workspaceKey) === sequence &&
            activationRef.current === capturedActivation
          ) {
            lastRunRef.current = Object.freeze({
              activation: capturedActivation,
              scope: validatedScope,
            });
          }
        } catch (error) {
          if (
            runSequences.current.get(workspaceKey) === sequence &&
            currentKeyRef.current === workspaceKey &&
            activationRef.current === capturedActivation
          ) {
            setStates((current) => {
              const previous = current[workspaceKey] ?? EMPTY_STATE;
              return {
                ...current,
                [workspaceKey]: {
                  ...previous,
                  discoveries: mergeJsTestExplorerRunResponse(
                    previous.discoveries,
                    validatedScope,
                    {
                      message: errorMessage(error),
                      status: "error",
                    },
                    rootPath,
                  ),
                  error: errorMessage(error),
                  running: false,
                },
              };
            });
          } else {
            settleStaleRun(workspaceKey, sequence, validatedScope, rootPath);
          }
          return false;
        }
      } finally {
        if (activeExplorerRunRef.current === runOwnership) {
          activeExplorerRunRef.current = null;
        }
        inFlightRuns.current.delete(workspaceKey);
        setStates((current) =>
          current[workspaceKey]?.loaded === false ? { ...current } : current,
        );
      }
      return true;
    },
    [
      discover,
      batchGateway,
      rootPath,
      runGateway,
      createTaskRunId,
      continuousRunCoordinator,
      continuousRunBlocked,
      settleStaleRun,
      states,
      taskGateway,
      resolveExecutionRoot,
      workspaceId,
      workspaceKey,
      workspaceTrusted,
    ],
  );
  const run = useCallback(
    async (scope: JsTestRunScope): Promise<void> => {
      await executeRun(scope);
    },
    [executeRun],
  );
  const canRerunLastRun = useCallback((): boolean => {
    const lastRun = lastRunRef.current;
    return (
      lastRun !== null &&
      lastRun.activation === activationRef.current &&
      workspaceKey !== null &&
      rootPath !== null &&
      workspaceTrusted &&
      !inFlightRuns.current.has(workspaceKey) &&
      activeExplorerRunRef.current === null &&
      activeFailedRunLease === null &&
      !currentContinuousRunSnapshot.enabled &&
      !currentContinuousRunSnapshot.stopping
    );
  }, [
    currentContinuousRunSnapshot.enabled,
    currentContinuousRunSnapshot.stopping,
    rootPath,
    workspaceKey,
    workspaceTrusted,
  ]);
  const rerunLastRun = useCallback(async (): Promise<boolean> => {
    const lastRun = lastRunRef.current;
    if (!lastRun || lastRun.activation !== activationRef.current || !canRerunLastRun()) {
      return false;
    }
    const accepted = await executeRun(lastRun.scope);
    return (
      accepted === true &&
      activationRef.current === lastRun.activation &&
      lastRunRef.current?.activation === lastRun.activation
    );
  }, [canRerunLastRun, executeRun]);

  const canRerunFailedTests = useCallback((): boolean => {
    const failedPlan = failedPlanRef.current;
    return (
      failedPlan !== null &&
      failedPlan.activation === activationRef.current &&
      failedPlan.plan.scopes.length > 0 &&
      taskGateway !== null &&
      workspaceKey !== null &&
      workspaceId !== null &&
      rootPath !== null &&
      workspaceTrusted &&
      !inFlightRuns.current.has(workspaceKey) &&
      activeExplorerRunRef.current === null &&
      activeFailedRunLease === null &&
      !currentContinuousRunSnapshot.enabled &&
      !currentContinuousRunSnapshot.stopping
    );
  }, [
    currentContinuousRunSnapshot.enabled,
    currentContinuousRunSnapshot.stopping,
    rootPath,
    taskGateway,
    workspaceId,
    workspaceKey,
    workspaceTrusted,
  ]);

  const rerunFailedTests = useCallback(async (): Promise<boolean> => {
    const failedPlan = failedPlanRef.current;
    if (
      !failedPlan ||
      !canRerunFailedTests() ||
      !taskGateway ||
      !workspaceKey ||
      !workspaceId ||
      !rootPath
    ) {
      return false;
    }
    const capturedActivation = failedPlan.activation;
    const capturedState = states[workspaceKey] ?? EMPTY_STATE;
    const batchIdentity = Object.freeze({});
    if (activeFailedRunLease !== null) return false;
    if (activeExplorerRunRef.current !== null) return false;
    activeFailedRunLease = batchIdentity;
    const coordinator = createJsTestFailedRunCoordinator({
      createRunId: createTaskRunId ?? secureJsTestTaskRunId,
      gateway: {
        runTask: async (request) => {
          const response = await taskGateway.runTask(request);
          const progress = coordinator.snapshot();
          if (
            mountedRef.current &&
            failedBatchIdentityRef.current === batchIdentity &&
            progress.phase === "running" &&
            response.response.status === "ok"
          ) {
            setFailedProgress({
              completed: Math.min(progress.completed + 1, progress.total),
              phase: "running",
              total: progress.total,
            });
          }
          return response;
        },
        stopTask: (request) => taskGateway.stopTask(request),
      },
      isCurrent: (activation, owner) =>
        mountedRef.current &&
        activationRef.current === activation &&
        currentKeyRef.current === workspaceKey &&
        workspaceId === owner,
    });
    failedCoordinatorRef.current = coordinator;
    failedBatchIdentityRef.current = batchIdentity;
    inFlightRuns.current.add(workspaceKey);
    setStates((current) => {
      const previous = current[workspaceKey] ?? EMPTY_STATE;
      return {
        ...current,
        [workspaceKey]: {
          ...previous,
          discoveries: failedPlan.plan.scopes.reduce(
            markJsTestExplorerScopeRunning,
            previous.discoveries,
          ),
          error: null,
          running: true,
          unavailable: null,
        },
      };
    });
    setFailedProgress({
      completed: 0,
      phase: "running",
      total: failedPlan.plan.scopes.length,
    });

    try {
      const outcome = await coordinator.start({
        activation: capturedActivation,
        plan: failedPlan.plan,
        workspaceId,
      });
      if (
        !mountedRef.current ||
        failedBatchIdentityRef.current !== batchIdentity ||
        outcome.status !== "success" ||
        activationRef.current !== capturedActivation ||
        currentKeyRef.current !== workspaceKey
      ) {
        if (mountedRef.current) {
          const exactCurrent =
            failedBatchIdentityRef.current === batchIdentity &&
            activationRef.current === capturedActivation &&
            currentKeyRef.current === workspaceKey;
          setStates((current) => {
            const restored = restoreFailedBatchState(
              current,
              workspaceKey,
              capturedState,
              failedPlan.plan.scopes,
              exactCurrent,
              outcome,
            );
            if (!exactCurrent || !("outputs" in outcome) || outcome.outputs.length === 0) {
              return restored;
            }
            const previous = restored[workspaceKey] ?? EMPTY_STATE;
            return {
              ...restored,
              [workspaceKey]: {
                ...previous,
                outputSnapshot: jsTestOutputSnapshot(
                  { rootPath, workspaceId },
                  capturedActivation,
                  aggregateJsTestTaskOutputs(outcome.outputs),
                ),
              },
            };
          });
        }
        return false;
      }
      const aggregate = aggregateJsTestRunResults(outcome.results.map(({ response }) => response));
      if (!aggregate) {
        if (mountedRef.current) {
          setStates((current) =>
            restoreFailedBatchState(
              current,
              workspaceKey,
              capturedState,
              failedPlan.plan.scopes,
              true,
              {
                message: "JavaScript failed-test results exceeded the safety limit.",
                status: "error",
              },
            ),
          );
        }
        return false;
      }
      setStates((current) => {
        let discoveries = capturedState.discoveries;
        let problemSnapshot = capturedState.problemSnapshot;
        for (const child of outcome.results) {
          discoveries = mergeJsTestExplorerRunResponse(
            discoveries,
            child.scope,
            child.response,
            rootPath,
          );
          problemSnapshot = mergeJsTestProblemsSnapshot(problemSnapshot, {
            generation: nextProblemGeneration(problemGenerations.current, workspaceKey),
            owner: problemOwner(workspaceId, rootPath),
            response: child.response,
            scope: child.scope,
          });
        }
        const plan = jsTestFailedRunScopes({
          discoveries,
          discoveryTruncated: capturedState.truncated,
          response: aggregate,
          rootPath,
        });
        failedPlanRef.current =
          plan.status === "available" && plan.scopes.length > 0
            ? Object.freeze({ activation: capturedActivation, plan })
            : null;
        return {
          ...current,
          [workspaceKey]: {
            ...capturedState,
            discoveries,
            error: null,
            outputSnapshot: jsTestOutputSnapshot(
              { rootPath, workspaceId },
              capturedActivation,
              aggregateJsTestTaskOutputs(outcome.results.map(({ output }) => output)),
            ),
            problemSnapshot,
            result: aggregate,
            running: false,
            unavailable: null,
          },
        };
      });
      return true;
    } finally {
      if (failedBatchIdentityRef.current === batchIdentity) {
        failedBatchIdentityRef.current = null;
        failedCoordinatorRef.current = null;
        inFlightRuns.current.delete(workspaceKey);
        if (activeFailedRunLease === batchIdentity) activeFailedRunLease = null;
        if (mountedRef.current) {
          setFailedProgress({ completed: 0, phase: "idle", total: 0 });
        }
      }
    }
  }, [
    canRerunFailedTests,
    createTaskRunId,
    rootPath,
    states,
    taskGateway,
    workspaceId,
    workspaceKey,
  ]);

  const canCancelTestRun = useCallback(
    (): boolean =>
      failedCoordinatorRef.current?.canCancel() === true ||
      singleCoordinatorRef.current?.canCancel() === true ||
      batchCoordinatorRef.current?.canCancel() === true,
    [],
  );
  const cancelTestRun = useCallback(async (): Promise<boolean> => {
    const coordinator = failedCoordinatorRef.current;
    if (coordinator?.canCancel()) {
      const snapshot = coordinator.snapshot();
      setFailedProgress({
        completed: snapshot.completed,
        phase: "cancelling",
        total: snapshot.total,
      });
      return coordinator.cancel();
    }
    const singleCoordinator = singleCoordinatorRef.current;
    if (singleCoordinator?.canCancel() === true) return singleCoordinator.cancel();
    const batchCoordinator = batchCoordinatorRef.current;
    return batchCoordinator?.canCancel() === true ? batchCoordinator.cancel() : false;
  }, []);

  executeContinuousRunRef.current = async (lease): Promise<boolean> => {
    const owner = continuousOwnerRef.current;
    const coordinatorSnapshot = continuousRunCoordinator.snapshot();
    if (
      !owner ||
      !continuousOwnersEqual(owner, lease.owner) ||
      !coordinatorSnapshot.enabled ||
      !coordinatorSnapshot.running ||
      !continuousOwnersEqual(coordinatorSnapshot.owner, lease.owner) ||
      currentKeyRef.current === null ||
      inFlightRuns.current.has(currentKeyRef.current) ||
      activeFailedRunLease !== null
    ) {
      return false;
    }
    const watchCapability = continuousWatchCapabilityRef.current;
    const watchCommand = watchCapability.command;
    const watchGateway = watchCapability.gateway;
    if (watchCommand && watchGateway) {
      const capturedWorkspaceKey = currentKeyRef.current;
      if (!capturedWorkspaceKey) return false;
      const watchOwner = Object.freeze({
        epoch: lease.owner.epoch,
        watchId: `watch-${lease.owner.epoch}-${lease.sequence}`,
        workspaceId: lease.owner.workspaceId,
      });
      const ownership: ActiveContinuousWatch = {
        cancelRequested: false,
        cleanupRequired: false,
        gateway: watchGateway,
        lastOutputSequence: -1,
        lease,
        owner: watchOwner,
        outputBuffer: createNativeJsTestWatchOutputBuffer({
          onPublish: (output) => {
            if (!isCurrentBoundary()) return;
            setStates((current) => {
              if (!isCurrentBoundary()) return current;
              const previous = current[ownership.workspaceKey] ?? EMPTY_STATE;
              return {
                ...current,
                [ownership.workspaceKey]: {
                  ...previous,
                  outputSnapshot: jsTestOutputSnapshot(
                    {
                      rootPath: ownership.lease.owner.rootKey,
                      workspaceId: ownership.lease.owner.workspaceId,
                    },
                    activationRef.current,
                    output,
                  ),
                },
              };
            });
          },
        }),
        settlement: null,
        startDispatched: false,
        started: false,
        stopFlight: null,
        terminal: false,
        unsubscribeOutput: null,
        unsubscribeStatus: null,
        workspaceKey: capturedWorkspaceKey,
      };
      activeContinuousWatchRef.current = ownership;
      const isCurrentBoundary = (): boolean =>
        mountedRef.current &&
        currentKeyRef.current === ownership.workspaceKey &&
        continuousOwnersEqual(continuousOwnerRef.current, ownership.lease.owner);
      const isCurrentWatch = (): boolean =>
        activeContinuousWatchRef.current === ownership && isCurrentBoundary();
      const canContinueStart = (): boolean => {
        const currentCapability = continuousWatchCapabilityRef.current;
        return (
          isCurrentWatch() &&
          !ownership.cancelRequested &&
          !ownership.terminal &&
          currentCapability.gateway === ownership.gateway &&
          currentCapability.command === watchCommand
        );
      };
      const releaseOwnership = (): void => {
        disposeActiveContinuousWatchListeners(ownership);
        if (activeContinuousWatchRef.current === ownership) {
          activeContinuousWatchRef.current = null;
        }
      };
      const compensateDispatchedStart = async (): Promise<boolean> => {
        ownership.started = true;
        const stopped = await stopActiveContinuousWatch(ownership);
        if (stopped) {
          releaseOwnership();
          return false;
        }
        ownership.cleanupRequired = true;
        return true;
      };
      const publishOutput = (event: JsTestWatchOutputEvent): void => {
        if (
          !isCurrentWatch() ||
          ownership.terminal ||
          !watchOwnersEqual(event.owner, ownership.owner) ||
          event.sequence <= ownership.lastOutputSequence
        ) {
          return;
        }
        const sequenceGap = event.sequence !== ownership.lastOutputSequence + 1;
        ownership.lastOutputSequence = event.sequence;
        ownership.outputBuffer.append(event.stream, event.data, event.truncated || sequenceGap);
      };
      const settleFromStatus = (event: JsTestWatchStatusEvent): void => {
        if (
          !isCurrentWatch() ||
          !watchOwnersEqual(event.owner, ownership.owner) ||
          ownership.terminal
        ) {
          return;
        }
        if (event.status === "running") {
          setStates((current) => {
            if (!isCurrentBoundary()) return current;
            const previous = current[ownership.workspaceKey] ?? EMPTY_STATE;
            return previous.error === null
              ? current
              : {
                  ...current,
                  [ownership.workspaceKey]: { ...previous, error: null },
                };
          });
          return;
        }
        ownership.outputBuffer.flush();
        ownership.terminal = true;
        disposeActiveContinuousWatchListeners(ownership);
        if (event.status === "failed" || (event.status === "exited" && event.exitCode !== 0)) {
          const message =
            event.status === "failed"
              ? event.message
              : event.exitCode === null
                ? "JavaScript test watch exited unexpectedly."
                : `JavaScript test watch exited with code ${event.exitCode}.`;
          setStates((current) => {
            if (!isCurrentBoundary()) return current;
            const previous = current[ownership.workspaceKey] ?? EMPTY_STATE;
            return {
              ...current,
              [ownership.workspaceKey]: { ...previous, error: message },
            };
          });
        }
        continuousOwnerRefreshPendingRef.current = true;
        void continuousRunCoordinator.disable(ownership.lease.owner);
      };
      const settlement = (async (): Promise<boolean> => {
        try {
          ownership.unsubscribeStatus =
            await ownership.gateway.subscribeWatchStatus(settleFromStatus);
          if (!canContinueStart()) {
            releaseOwnership();
            return false;
          }
          ownership.unsubscribeOutput = await ownership.gateway.subscribeWatchOutput(publishOutput);
          if (!canContinueStart()) {
            releaseOwnership();
            return false;
          }
          ownership.startDispatched = true;
          const result = await ownership.gateway.startWatch({
            ...watchOwner,
            command: watchCommand,
          });
          ownership.started = true;
          if (!watchOwnersEqual(result.owner, watchOwner) || !canContinueStart()) {
            return compensateDispatchedStart();
          }
          await ownership.gateway.acknowledgeWatchStart(watchOwner);
          if (!canContinueStart()) {
            return compensateDispatchedStart();
          }
          setStates((current) => {
            if (!isCurrentBoundary()) return current;
            const previous = current[ownership.workspaceKey] ?? EMPTY_STATE;
            return previous.error === null
              ? current
              : {
                  ...current,
                  [ownership.workspaceKey]: { ...previous, error: null },
                };
          });
          return true;
        } catch {
          if (ownership.startDispatched) {
            return compensateDispatchedStart();
          }
          releaseOwnership();
          return false;
        }
      })();
      ownership.settlement = settlement;
      void settlement.then((retainedForCleanup) => {
        if (
          !retainedForCleanup ||
          !ownership.cleanupRequired ||
          activeContinuousWatchRef.current !== ownership
        ) {
          return;
        }
        setTimeout(() => {
          if (!ownership.cleanupRequired || activeContinuousWatchRef.current !== ownership) {
            return;
          }
          continuousOwnerRefreshPendingRef.current = true;
          void continuousRunCoordinator.disable(ownership.lease.owner);
        }, 0);
      });
      return settlement;
    }
    const flight = executeRun({ kind: "all" }, lease);
    const admitted = activeExplorerRunRef.current?.continuousLease === lease;
    await flight;
    return admitted;
  };
  cancelContinuousRunRef.current = async (lease): Promise<boolean> => {
    const watchOwnership = activeContinuousWatchRef.current;
    if (watchOwnership?.lease === lease) {
      watchOwnership.cancelRequested = true;
      watchOwnership.outputBuffer.flush();
      if (watchOwnership.terminal) {
        disposeActiveContinuousWatchListeners(watchOwnership);
        if (activeContinuousWatchRef.current === watchOwnership) {
          activeContinuousWatchRef.current = null;
        }
        return true;
      }
      if (!watchOwnership.started) {
        const admitted = (await watchOwnership.settlement) === true;
        if (!admitted) return true;
      }
      try {
        const stopped = await stopActiveContinuousWatch(watchOwnership);
        if (!stopped) return false;
        disposeActiveContinuousWatchListeners(watchOwnership);
        if (activeContinuousWatchRef.current === watchOwnership) {
          activeContinuousWatchRef.current = null;
        }
        return true;
      } catch {
        return false;
      }
    }
    const ownership = activeExplorerRunRef.current;
    if (!ownership || ownership.continuousLease !== lease) return false;
    ownership.cancelRequested = true;
    const coordinator = ownership.singleCoordinator;
    if (coordinator?.canCancel() === true) return coordinator.cancel();
    const batchCoordinator = ownership.batchCoordinator;
    return batchCoordinator?.canCancel() === true ? batchCoordinator.cancel() : true;
  };

  const canStartContinuousRun = useCallback(
    (): boolean =>
      continuousOwner !== null &&
      !continuousRunBlocked &&
      !currentContinuousRunSnapshot.enabled &&
      !currentContinuousRunSnapshot.stopping &&
      !inFlightRuns.current.has(workspaceKey ?? "") &&
      activeExplorerRunRef.current === null &&
      activeFailedRunLease === null,
    [
      continuousOwner,
      continuousRunBlocked,
      currentContinuousRunSnapshot.enabled,
      currentContinuousRunSnapshot.stopping,
      workspaceKey,
    ],
  );
  const startContinuousRun = useCallback(
    (): boolean =>
      continuousOwner !== null &&
      canStartContinuousRun() &&
      continuousRunCoordinator.enable(continuousOwner, continuousRunVersion),
    [canStartContinuousRun, continuousOwner, continuousRunCoordinator, continuousRunVersion],
  );
  const stopContinuousRun = useCallback(async (): Promise<boolean> => {
    if (continuousOwner === null) return continuousRunCoordinator.invalidate();
    const current = continuousRunCoordinator.snapshot();
    if (!continuousOwnersEqual(current.owner, continuousOwner)) return false;
    continuousOwnerRefreshPendingRef.current = true;
    const stopping = continuousRunCoordinator.disable(continuousOwner);
    return stopping;
  }, [continuousOwner, continuousRunCoordinator]);

  useEffect(() => {
    const coordinator = failedCoordinatorRef.current;
    if (coordinator) {
      setFailedProgress((current) => ({ ...current, phase: "invalidating" }));
      void coordinator.invalidate();
    }
    void singleCoordinatorRef.current?.invalidate();
    void batchCoordinatorRef.current?.invalidate();
    if (workspaceKey) {
      setStates((current) => {
        const previous = current[workspaceKey];
        if (!previous?.outputSnapshot) return current;
        return {
          ...current,
          [workspaceKey]: { ...previous, outputSnapshot: null },
        };
      });
    }
  }, [activation, workspaceKey]);

  useEffect(() => {
    void continuousRunCoordinator.invalidate();
  }, [continuousOwner?.epoch, continuousRunCoordinator]);

  useEffect(() => {
    const owner = continuousOwnerRef.current;
    if (!owner) return;
    continuousRunCoordinator.observeChange(owner, continuousRunVersion);
  }, [continuousOwner?.epoch, continuousRunCoordinator, continuousRunVersion]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void continuousRunCoordinator.invalidate();
      void failedCoordinatorRef.current?.invalidate();
      void singleCoordinatorRef.current?.invalidate();
      void batchCoordinatorRef.current?.invalidate();
    };
  }, [continuousRunCoordinator]);

  useEffect(() => {
    const workspaceState = workspaceKey ? states[workspaceKey] : null;
    if (
      isOpen &&
      workspaceKey &&
      !inFlightRuns.current.has(workspaceKey) &&
      !pendingDiscoveryInvalidations.current.has(workspaceKey) &&
      !workspaceState?.loading &&
      !workspaceState?.loaded
    ) {
      void discover();
    }
  }, [discover, isOpen, states, workspaceKey]);

  useEffect(() => {
    if (discoveryVersionRef.current === discoveryVersion) return;
    discoveryVersionRef.current = discoveryVersion;
    if (!workspaceKey) return;

    discoverySequences.current.set(
      workspaceKey,
      (discoverySequences.current.get(workspaceKey) ?? 0) + 1,
    );
    discoveryExecutionSnapshots.current.delete(workspaceKey);
    pendingDiscoveryInvalidations.current.add(workspaceKey);
    setStates((current) => ({
      ...current,
      [workspaceKey]: {
        ...(current[workspaceKey] ?? EMPTY_STATE),
        loaded: false,
        loading: false,
      },
    }));

    const previousTimer = discoveryInvalidationTimers.current.get(workspaceKey);
    if (previousTimer) clearTimeout(previousTimer);
    discoveryInvalidationTimers.current.set(
      workspaceKey,
      setTimeout(() => {
        discoveryInvalidationTimers.current.delete(workspaceKey);
        pendingDiscoveryInvalidations.current.delete(workspaceKey);
        setStates((current) => ({ ...current }));
      }, INVALIDATION_DEBOUNCE_MS),
    );
  }, [discoveryVersion, workspaceKey]);

  useEffect(
    () => () => {
      discoveryInvalidationTimers.current.forEach(clearTimeout);
      discoveryInvalidationTimers.current.clear();
      pendingDiscoveryInvalidations.current.clear();
    },
    [],
  );

  useEffect(() => {
    if (!workspaceKey || !workspaceTrusted) return;
    setStates((current) => {
      const previous = current[workspaceKey];
      if (!previous?.unavailable) return current;
      return {
        ...current,
        [workspaceKey]: { ...previous, unavailable: null },
      };
    });
  }, [workspaceKey, workspaceTrusted]);

  useEffect(() => {
    if (!workspaceKey || !workspaceId || !rootPath) return;
    const previousVersion = resultInvalidationVersions.current.get(workspaceKey);
    resultInvalidationVersions.current.set(workspaceKey, resultInvalidationVersion);
    if (previousVersion === undefined || previousVersion === resultInvalidationVersion) return;
    const generation = nextProblemGeneration(problemGenerations.current, workspaceKey);
    const owner = problemOwner(workspaceId, rootPath);
    setStates((current) => {
      const previous = current[workspaceKey] ?? EMPTY_STATE;
      return {
        ...current,
        [workspaceKey]: {
          ...previous,
          outputSnapshot: null,
          problemSnapshot: mergeJsTestProblemsSnapshot(previous.problemSnapshot, {
            generation,
            owner,
            response: EMPTY_TEST_RUN,
            scope: { kind: "all" },
          }),
        },
      };
    });
  }, [resultInvalidationVersion, rootPath, workspaceId, workspaceKey]);

  useEffect(() => {
    if (requestVersionRef.current === runRequestVersion) return;
    requestVersionRef.current = runRequestVersion;
    void run({ kind: "all" });
  }, [run, runRequestVersion]);

  const tree = useMemo(
    () => (rootPath ? buildJsTestExplorerTree(rootPath, state.discoveries, workspaceId) : null),
    [rootPath, state.discoveries, workspaceId],
  );

  return {
    canCancelTestRun,
    canStartContinuousRun,
    canRerunFailedTests,
    canRerunLastRun,
    canRunScope: (scope) =>
      workspaceKey !== null &&
      rootPath !== null &&
      workspaceTrusted &&
      !currentContinuousRunSnapshot.enabled &&
      !currentContinuousRunSnapshot.stopping &&
      activeExplorerRunRef.current === null &&
      !inFlightRuns.current.has(workspaceKey) &&
      safeValidatedRunnableScope(scope) !== null,
    continuousRunEnabled: currentContinuousRunSnapshot.enabled,
    continuousRunPending: currentContinuousRunSnapshot.pending,
    continuousRunRunning: currentContinuousRunSnapshot.running,
    continuousRunStopping: currentContinuousRunSnapshot.stopping,
    error: state.error,
    failedRunCompleted: failedProgress.completed,
    failedRunPhase: failedProgress.phase,
    failedRunTotal: failedProgress.total,
    isLoading: state.loading,
    isRunning: state.running || state.discoveries.some(({ status }) => status === "running"),
    problemSnapshot: state.problemSnapshot,
    outputSnapshot: currentOutputSnapshot,
    refresh,
    rerunFailedTests,
    rerunLastRun,
    result: state.result,
    run,
    runScope: executeRun,
    startContinuousRun,
    stopContinuousRun,
    tree,
    truncated: state.truncated,
    unavailable: state.unavailable,
    cancelTestRun,
  };
}

function safeValidatedRunScope(scope: JsTestRunScope): JsTestRunScope | null {
  try {
    return validatedJsTestRunScope(scope);
  } catch {
    return null;
  }
}

function immutableValidatedRunScope(scope: JsTestRunScope): JsTestRunScope | null {
  const validated = safeValidatedRunScope(scope);
  if (!validated) return null;
  switch (validated.kind) {
    case "all":
      return Object.freeze({ kind: "all" });
    case "file":
      return Object.freeze({
        kind: "file",
        relativeFilePath: validated.relativeFilePath,
      });
    case "suite":
      return Object.freeze({
        fullName: validated.fullName,
        kind: "suite",
        relativeFilePath: validated.relativeFilePath,
      });
    case "test":
      return Object.freeze({
        fullName: validated.fullName,
        kind: "test",
        ...(validated.nameMatch === "prefix" ? { nameMatch: "prefix" as const } : {}),
        relativeFilePath: validated.relativeFilePath,
      });
  }
}

function sameActivation(
  previous: JsTestExplorerActivation | null,
  next: JsTestExplorerActivation,
): boolean {
  return (
    previous !== null &&
    previous.batchGateway === next.batchGateway &&
    previous.discoveryGateway === next.discoveryGateway &&
    previous.discoveryVersion === next.discoveryVersion &&
    previous.resultInvalidationVersion === next.resultInvalidationVersion &&
    previous.runGateway === next.runGateway &&
    previous.resolveExecutionRoot === next.resolveExecutionRoot &&
    previous.taskGateway === next.taskGateway &&
    previous.workspaceKey === next.workspaceKey &&
    previous.workspaceTrusted === next.workspaceTrusted
  );
}

async function workspaceExecutionRoot(): Promise<{ readonly packageRootRelativePath: "" }> {
  return Object.freeze({ packageRootRelativePath: "" });
}

function sameContinuousOwnerBoundary(
  previous: JsTestContinuousOwnerBoundary | null,
  next: JsTestContinuousOwnerBoundary,
): boolean {
  return (
    previous !== null &&
    previous.blocked === next.blocked &&
    previous.command === next.command &&
    previous.taskGateway === next.taskGateway &&
    previous.watchGateway === next.watchGateway &&
    previous.workspaceKey === next.workspaceKey &&
    previous.workspaceTrusted === next.workspaceTrusted
  );
}

function continuousOwnersEqual(
  left: JsTestContinuousRunOwner | null,
  right: JsTestContinuousRunOwner | null,
): boolean {
  return (
    left !== null &&
    right !== null &&
    left.epoch === right.epoch &&
    left.rootKey === right.rootKey &&
    left.workspaceId === right.workspaceId
  );
}

function watchOwnersEqual(left: JsTestWatchOwner, right: JsTestWatchOwner): boolean {
  return (
    left.epoch === right.epoch &&
    left.watchId === right.watchId &&
    left.workspaceId === right.workspaceId
  );
}

function disposeActiveContinuousWatchListeners(ownership: ActiveContinuousWatch): void {
  ownership.outputBuffer.dispose();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    for (const key of ["unsubscribeOutput", "unsubscribeStatus"] as const) {
      const unsubscribe = ownership[key];
      if (!unsubscribe) continue;
      try {
        unsubscribe();
        ownership[key] = null;
      } catch {
        // Retain the handle for the bounded retry below.
      }
    }
    if (!ownership.unsubscribeOutput && !ownership.unsubscribeStatus) return;
  }
}

function stopActiveContinuousWatch(ownership: ActiveContinuousWatch): Promise<boolean> {
  if (ownership.stopFlight) return ownership.stopFlight;
  const flight = ownership.gateway.stopWatch(ownership.owner).then(
    () => true,
    () => false,
  );
  ownership.stopFlight = flight;
  void flight.then(() => {
    if (ownership.stopFlight === flight) ownership.stopFlight = null;
  });
  return flight;
}

function restoreFailedBatchState(
  states: Record<string, WorkspaceExplorerState>,
  workspaceKey: string,
  captured: WorkspaceExplorerState,
  scopes: readonly JsTestRunScope[],
  exactCurrent: boolean,
  outcome: { readonly status: string; readonly message?: string },
): Record<string, WorkspaceExplorerState> {
  const previous = states[workspaceKey] ?? EMPTY_STATE;
  if (!exactCurrent) {
    return {
      ...states,
      [workspaceKey]: {
        ...previous,
        discoveries: scopes.reduce(
          (discoveries, scope) =>
            mergeJsTestExplorerRunResponse(discoveries, scope, {
              message: "Stale JavaScript failed-test run.",
              status: "error",
            }),
          previous.discoveries,
        ),
        running: false,
      },
    };
  }
  return {
    ...states,
    [workspaceKey]: {
      ...previous,
      discoveries: captured.discoveries,
      error:
        outcome.status === "error"
          ? (outcome.message ?? "JavaScript test task failed.")
          : captured.error,
      problemSnapshot: captured.problemSnapshot,
      result: captured.result,
      running: false,
      unavailable:
        outcome.status === "unavailable"
          ? (outcome.message ?? "JavaScript test runner is unavailable.")
          : captured.unavailable,
    },
  };
}

function safeValidatedRunnableScope(scope: JsTestRunnableScope): JsTestRunnableScope | null {
  const validated = safeValidatedRunScope(scope);
  return validated?.kind === "all" ? null : validated;
}

const EMPTY_TEST_RUN: TestRunOk = {
  status: "ok",
  suites: [],
  totals: { errors: 0, failures: 0, skipped: 0, tests: 0, time: null },
};

function nextProblemGeneration(generations: Map<string, number>, workspaceKey: string): number {
  const generation = (generations.get(workspaceKey) ?? 0) + 1;
  generations.set(workspaceKey, generation);
  return generation;
}

function problemOwner(workspaceId: string | null, rootPath: string): JsTestProblemsOwner {
  if (!workspaceId) throw new TypeError("JavaScript test problem ownership is unavailable.");
  return { rootKey: rootPath, workspaceId };
}

async function mapConcurrent<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  map: (value: Input) => Promise<Output>,
): Promise<Output[]> {
  const results = new Array<Output>(values.length);
  let next = 0;
  const worker = async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await map(values[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
