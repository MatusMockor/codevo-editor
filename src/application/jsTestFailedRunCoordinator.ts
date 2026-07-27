import {
  MAX_JS_TEST_FAILED_RUN_SCOPES,
  type JsTestFailedRunPlan,
  type JsTestFailedRunScope,
} from "../domain/jsTestFailedRunScopes";
import {
  validatedJsTestTaskRunId,
  validatedJsTestTaskWorkspaceId,
  type JsTestTaskGateway,
  type JsTestTaskOutput,
  type JsTestTaskOwner,
} from "../domain/jsTestTask";
import { validatedJsTestRunScope } from "../domain/jsTestRunScope";
import { validatedJsTestExecutionAuthority } from "../domain/jsTestExecutionAuthority";
import type { TestRunOk } from "../domain/testResults";

export interface JsTestFailedRunRequest {
  readonly activation: number;
  readonly plan: Extract<JsTestFailedRunPlan, { readonly status: "available" }>;
  readonly workspaceId: string;
}

export interface JsTestFailedRunChildResult {
  readonly output: JsTestTaskOutput;
  readonly owner: JsTestTaskOwner;
  readonly response: TestRunOk;
  readonly scope: JsTestFailedRunScope;
}

export type JsTestFailedRunOutcome =
  | {
      readonly results: readonly JsTestFailedRunChildResult[];
      readonly status: "success";
    }
  | { readonly outputs: readonly JsTestTaskOutput[]; readonly status: "cancelled" }
  | {
      readonly message: string;
      readonly outputs: readonly JsTestTaskOutput[];
      readonly status: "error";
    }
  | { readonly status: "rejected" }
  | { readonly status: "stale" }
  | {
      readonly message: string;
      readonly outputs: readonly JsTestTaskOutput[];
      readonly status: "unavailable";
    };

export interface JsTestFailedRunCoordinatorSnapshot {
  readonly completed: number;
  readonly phase: "idle" | "running" | "cancelling" | "invalidating";
  readonly total: number;
}

export interface JsTestFailedRunCoordinator {
  canCancel(): boolean;
  canStart(request: JsTestFailedRunRequest): boolean;
  cancel(): Promise<boolean>;
  invalidate(): Promise<boolean>;
  snapshot(): JsTestFailedRunCoordinatorSnapshot;
  start(request: JsTestFailedRunRequest): Promise<JsTestFailedRunOutcome>;
}

export interface JsTestFailedRunCoordinatorOptions {
  readonly createRunId: () => string;
  readonly gateway: JsTestTaskGateway;
  readonly isCurrent: (activation: number, workspaceId: string) => boolean;
}

interface ActiveBatch {
  readonly activation: number;
  cancelRequested: boolean;
  completed: number;
  currentOwner: JsTestTaskOwner | null;
  invalidated: boolean;
  readonly plan: readonly JsTestFailedRunScope[];
  readonly runIds: Set<string>;
  stopFlight: Promise<boolean> | null;
  readonly workspaceId: string;
}

const IDLE_SNAPSHOT: JsTestFailedRunCoordinatorSnapshot = Object.freeze({
  completed: 0,
  phase: "idle",
  total: 0,
});

/** Serial, owner-exact executor for one immutable Rerun Failed plan. */
export function createJsTestFailedRunCoordinator({
  createRunId,
  gateway,
  isCurrent,
}: JsTestFailedRunCoordinatorOptions): JsTestFailedRunCoordinator {
  let active: ActiveBatch | null = null;

  const boundaryCurrent = (batch: ActiveBatch): boolean => {
    try {
      return isCurrent(batch.activation, batch.workspaceId) === true;
    } catch {
      return false;
    }
  };

  const canStart = (request: JsTestFailedRunRequest): boolean =>
    active === null && validRequest(request) && safeIsCurrent(isCurrent, request);

  const stopCurrent = async (batch: ActiveBatch): Promise<boolean> => {
    const owner = batch.currentOwner;
    if (!owner || active !== batch) return false;
    if (!batch.stopFlight) {
      const stopFlight = safelyStop(gateway, owner);
      batch.stopFlight = stopFlight;
      void stopFlight.finally(() => {
        if (batch.stopFlight === stopFlight) batch.stopFlight = null;
      });
    }
    const capturedFlight = batch.stopFlight;
    const stopped = await capturedFlight;
    return (
      stopped === true && active === batch && batch.currentOwner === owner && boundaryCurrent(batch)
    );
  };

  const cancelBatch = async (invalidated: boolean): Promise<boolean> => {
    const batch = active;
    if (!batch) return false;
    batch.cancelRequested = true;
    if (invalidated) batch.invalidated = true;
    return stopCurrent(batch);
  };

  return Object.freeze({
    canCancel: () => active !== null && active.currentOwner !== null,
    canStart,
    cancel: () => cancelBatch(false),
    invalidate: () => cancelBatch(true),
    snapshot: () => {
      const batch = active;
      if (!batch) return IDLE_SNAPSHOT;
      return Object.freeze({
        completed: Math.min(batch.completed, batch.plan.length),
        phase: batch.invalidated
          ? "invalidating"
          : batch.cancelRequested
            ? "cancelling"
            : "running",
        total: batch.plan.length,
      });
    },
    start: async (request: JsTestFailedRunRequest): Promise<JsTestFailedRunOutcome> => {
      if (!canStart(request)) return rejected();
      const plan = Object.freeze(request.plan.scopes.map(cloneFrozenScope));
      const batch: ActiveBatch = {
        activation: request.activation,
        cancelRequested: false,
        completed: 0,
        currentOwner: null,
        invalidated: false,
        plan,
        runIds: new Set(),
        stopFlight: null,
        workspaceId: request.workspaceId,
      };
      active = batch;
      const results: JsTestFailedRunChildResult[] = [];

      try {
        for (const scope of plan) {
          const boundary = batchBoundaryOutcome(
            active,
            batch,
            boundaryCurrent,
            results.map(({ output }) => output),
          );
          if (boundary) return boundary;

          const runId = safeRunId(createRunId);
          if (!runId || batch.runIds.has(runId)) return error();
          batch.runIds.add(runId);
          const owner = Object.freeze({ runId, workspaceId: batch.workspaceId });
          batch.currentOwner = owner;

          let envelope: Awaited<ReturnType<JsTestTaskGateway["runTask"]>>;
          try {
            envelope = await gateway.runTask(
              Object.freeze({
                ...owner,
                packageRootRelativePath: validatedJsTestExecutionAuthority({
                  packageRootRelativePath: scope.packageRootRelativePath ?? "",
                }).packageRootRelativePath,
                scope: cloneFrozenRunScope(scope),
              }),
            );
          } catch (cause) {
            const outputs = results.map(({ output }) => output);
            const afterThrow = batchBoundaryOutcome(active, batch, boundaryCurrent, outputs);
            return (
              afterThrow ??
              error(safeOutcomeMessage(cause, "JavaScript test task failed."), outputs)
            );
          }

          const previousOutputs = results.map(({ output }) => output);
          if (active !== batch || batch.invalidated || !boundaryCurrent(batch)) return stale();
          if (
            batch.currentOwner !== owner ||
            envelope.owner.runId !== owner.runId ||
            envelope.owner.workspaceId !== owner.workspaceId
          ) {
            return error("JavaScript test task returned an invalid response.", previousOutputs);
          }
          batch.currentOwner = null;
          batch.stopFlight = null;

          const terminalOutputs = [...previousOutputs, envelope.output];
          if (batch.cancelRequested) return cancelled(terminalOutputs);
          if (envelope.response.status === "cancelled") return cancelled(terminalOutputs);
          if (envelope.response.status === "error") {
            return error(envelope.response.message, terminalOutputs);
          }
          if (envelope.response.status === "unavailable") {
            return unavailable(envelope.response.message, terminalOutputs);
          }

          results.push(
            Object.freeze({
              output: envelope.output,
              owner: envelope.owner,
              response: cloneFrozenResponse(envelope.response),
              scope: cloneFrozenScope(scope),
            }),
          );
          batch.completed += 1;
        }

        const completedBoundary = batchBoundaryOutcome(
          active,
          batch,
          boundaryCurrent,
          results.map(({ output }) => output),
        );
        if (completedBoundary) return completedBoundary;
        return Object.freeze({
          results: Object.freeze([...results]),
          status: "success",
        });
      } finally {
        if (active === batch) active = null;
      }
    },
  });
}

function validRequest(request: JsTestFailedRunRequest): boolean {
  if (
    !Number.isSafeInteger(request.activation) ||
    request.activation < 0 ||
    request.plan.status !== "available" ||
    request.plan.unresolved !== 0 ||
    request.plan.scopes.length === 0 ||
    request.plan.scopes.length > MAX_JS_TEST_FAILED_RUN_SCOPES ||
    !Object.isFrozen(request.plan) ||
    !Object.isFrozen(request.plan.scopes)
  ) {
    return false;
  }
  try {
    validatedJsTestTaskWorkspaceId(request.workspaceId);
    return request.plan.scopes.every(
      (scope) =>
        Object.isFrozen(scope) &&
        scope.kind === "test" &&
        exactScope(validatedJsTestRunScope(scope), scope) &&
        validatedJsTestExecutionAuthority({
          packageRootRelativePath: scope.packageRootRelativePath ?? "",
        }).packageRootRelativePath === (scope.packageRootRelativePath ?? ""),
    );
  } catch {
    return false;
  }
}

function exactScope(
  validated: ReturnType<typeof validatedJsTestRunScope>,
  scope: JsTestFailedRunScope,
): boolean {
  return (
    validated.kind === "test" &&
    validated.relativeFilePath === scope.relativeFilePath &&
    validated.fullName === scope.fullName &&
    validated.nameMatch === scope.nameMatch
  );
}

function safeIsCurrent(
  isCurrent: JsTestFailedRunCoordinatorOptions["isCurrent"],
  request: JsTestFailedRunRequest,
): boolean {
  try {
    return isCurrent(request.activation, request.workspaceId) === true;
  } catch {
    return false;
  }
}

function safeRunId(createRunId: () => string): string | null {
  try {
    return validatedJsTestTaskRunId(createRunId());
  } catch {
    return null;
  }
}

async function safelyStop(gateway: JsTestTaskGateway, owner: JsTestTaskOwner): Promise<boolean> {
  try {
    return (await gateway.stopTask(owner)) === true;
  } catch {
    return false;
  }
}

function batchBoundaryOutcome(
  active: ActiveBatch | null,
  batch: ActiveBatch,
  boundaryCurrent: (batch: ActiveBatch) => boolean,
  outputs: readonly JsTestTaskOutput[],
): Extract<JsTestFailedRunOutcome, { readonly status: "cancelled" | "stale" }> | null {
  if (active !== batch || batch.invalidated || !boundaryCurrent(batch)) return stale();
  if (batch.cancelRequested) return cancelled(outputs);
  return null;
}

function cloneFrozenScope(scope: JsTestFailedRunScope): JsTestFailedRunScope {
  return Object.freeze({
    fullName: scope.fullName,
    kind: "test",
    ...(scope.nameMatch === "prefix" ? { nameMatch: "prefix" as const } : {}),
    ...(scope.packageRootRelativePath === undefined
      ? {}
      : { packageRootRelativePath: scope.packageRootRelativePath }),
    relativeFilePath: scope.relativeFilePath,
  });
}

function cloneFrozenRunScope(scope: JsTestFailedRunScope): JsTestFailedRunScope {
  return Object.freeze({
    fullName: scope.fullName,
    kind: "test",
    ...(scope.nameMatch === "prefix" ? { nameMatch: "prefix" as const } : {}),
    relativeFilePath: scope.relativeFilePath,
  });
}

function cloneFrozenResponse(response: TestRunOk): TestRunOk {
  const suites = response.suites.map((suite) => {
    const cases = suite.cases.map((testCase) => Object.freeze({ ...testCase }));
    Object.freeze(cases);
    return Object.freeze({ ...suite, cases });
  });
  Object.freeze(suites);
  const clone: TestRunOk = {
    status: "ok",
    suites,
    totals: Object.freeze({ ...response.totals }),
  };
  return Object.freeze(clone);
}

function rejected(): JsTestFailedRunOutcome {
  return Object.freeze({ status: "rejected" });
}

function cancelled(
  outputs: readonly JsTestTaskOutput[] = [],
): Extract<JsTestFailedRunOutcome, { readonly status: "cancelled" }> {
  return Object.freeze({ outputs: frozenOutputs(outputs), status: "cancelled" });
}

function stale(): Extract<JsTestFailedRunOutcome, { readonly status: "stale" }> {
  return Object.freeze({ status: "stale" });
}

function error(
  message = "JavaScript test task could not be started.",
  outputs: readonly JsTestTaskOutput[] = [],
): Extract<JsTestFailedRunOutcome, { readonly status: "error" }> {
  return Object.freeze({
    message: safeOutcomeMessage(message, "JavaScript test task failed."),
    outputs: frozenOutputs(outputs),
    status: "error",
  });
}

function unavailable(
  message: string,
  outputs: readonly JsTestTaskOutput[] = [],
): Extract<JsTestFailedRunOutcome, { readonly status: "unavailable" }> {
  return Object.freeze({
    message: safeOutcomeMessage(message, "JavaScript test runner is unavailable."),
    outputs: frozenOutputs(outputs),
    status: "unavailable",
  });
}

function frozenOutputs(outputs: readonly JsTestTaskOutput[]): readonly JsTestTaskOutput[] {
  return Object.freeze(
    outputs.map((output) =>
      Object.freeze({
        stderr: Object.freeze({ ...output.stderr }),
        stdout: Object.freeze({ ...output.stdout }),
      }),
    ),
  );
}

function safeOutcomeMessage(value: unknown, fallback: string): string {
  const raw = value instanceof Error ? value.message : typeof value === "string" ? value : fallback;
  const sanitized = raw.replace(/[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu, "�").trim();
  const source = sanitized || fallback;
  const bytes = new TextEncoder().encode(source);
  if (bytes.byteLength <= 4_096) return source;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let end = 4_093; end > 0; end -= 1) {
    try {
      return `${decoder.decode(bytes.slice(0, end))}…`;
    } catch {
      // Continue to the previous UTF-8 boundary.
    }
  }
  return fallback;
}
