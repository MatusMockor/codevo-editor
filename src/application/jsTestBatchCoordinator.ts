import {
  immutableJsTestBatchRequest,
  type JsTestBatchGateway,
  type JsTestBatchPackagePlan,
  type JsTestBatchResponse,
} from "../domain/jsTestBatch";
import {
  validatedJsTestTaskRunId,
  validatedJsTestTaskWorkspaceId,
  type JsTestTaskOwner,
} from "../domain/jsTestTask";

export type JsTestBatchCoordinatorOutcome =
  | { readonly response: JsTestBatchResponse; readonly status: "settled" }
  | { readonly message: string; readonly status: "error" }
  | { readonly status: "rejected" | "stale" };

export interface JsTestBatchCoordinator {
  canCancel(): boolean;
  cancel(): Promise<boolean>;
  invalidate(): Promise<boolean>;
  start(request: {
    readonly activation: number;
    readonly packages: readonly JsTestBatchPackagePlan[];
    readonly workspaceId: string;
  }): Promise<JsTestBatchCoordinatorOutcome>;
}

export function createJsTestBatchCoordinator(options: {
  readonly createRunId: () => string;
  readonly gateway: JsTestBatchGateway;
  readonly isCurrent: (activation: number, workspaceId: string) => boolean;
}): JsTestBatchCoordinator {
  let active: {
    readonly activation: number;
    cancelRequested: boolean;
    invalidated: boolean;
    readonly owner: JsTestTaskOwner;
    stopFlight: Promise<boolean> | null;
  } | null = null;

  const isCurrent = (candidate: NonNullable<typeof active>): boolean => {
    try {
      return (
        active === candidate &&
        options.isCurrent(candidate.activation, candidate.owner.workspaceId) === true
      );
    } catch {
      return false;
    }
  };

  const stop = async (invalidated: boolean): Promise<boolean> => {
    const candidate = active;
    if (!candidate) return false;
    candidate.cancelRequested = true;
    if (invalidated) candidate.invalidated = true;
    candidate.stopFlight ??= safelyStop(options.gateway, candidate.owner);
    const stopped = await candidate.stopFlight;
    if (!stopped && isCurrent(candidate)) candidate.stopFlight = null;
    return stopped && isCurrent(candidate);
  };

  return Object.freeze({
    canCancel: () => active !== null,
    cancel: () => stop(false),
    invalidate: () => stop(true),
    start: async (request: {
      readonly activation: number;
      readonly packages: readonly JsTestBatchPackagePlan[];
      readonly workspaceId: string;
    }): Promise<JsTestBatchCoordinatorOutcome> => {
      if (active || !validRequest(request, options.isCurrent)) return rejected();
      let batchRequest;
      try {
        batchRequest = immutableJsTestBatchRequest({
          packages: request.packages,
          runId: validatedJsTestTaskRunId(options.createRunId()),
          workspaceId: validatedJsTestTaskWorkspaceId(request.workspaceId),
        });
      } catch (cause) {
        return error(errorMessage(cause));
      }
      const candidate = {
        activation: request.activation,
        cancelRequested: false,
        invalidated: false,
        owner: Object.freeze({
          runId: batchRequest.runId,
          workspaceId: batchRequest.workspaceId,
        }),
        stopFlight: null,
      };
      active = candidate;
      try {
        let response: JsTestBatchResponse;
        try {
          response = await options.gateway.runBatch(batchRequest);
        } catch (cause) {
          return isCurrent(candidate) && !candidate.invalidated
            ? error(errorMessage(cause))
            : stale();
        }
        if (!isCurrent(candidate) || candidate.invalidated) return stale();
        if (
          response.owner.runId !== candidate.owner.runId ||
          response.owner.workspaceId !== candidate.owner.workspaceId
        ) {
          return error("JavaScript test batch returned an invalid owner.");
        }
        if (candidate.cancelRequested && response.status === "ok") {
          return error("JavaScript test batch returned success after cancellation.");
        }
        return Object.freeze({ response, status: "settled" as const });
      } finally {
        if (active === candidate) active = null;
      }
    },
  });
}

function validRequest(
  request: {
    readonly activation: number;
    readonly packages: readonly JsTestBatchPackagePlan[];
    readonly workspaceId: string;
  },
  isCurrent: (activation: number, workspaceId: string) => boolean,
): boolean {
  try {
    return (
      Number.isSafeInteger(request.activation) &&
      request.activation >= 0 &&
      isCurrent(request.activation, request.workspaceId) === true
    );
  } catch {
    return false;
  }
}

async function safelyStop(gateway: JsTestBatchGateway, owner: JsTestTaskOwner): Promise<boolean> {
  try {
    return (await gateway.stopBatch(owner)) === true;
  } catch {
    return false;
  }
}

function rejected(): JsTestBatchCoordinatorOutcome {
  return Object.freeze({ status: "rejected" });
}

function stale(): JsTestBatchCoordinatorOutcome {
  return Object.freeze({ status: "stale" });
}

function error(message: string): JsTestBatchCoordinatorOutcome {
  return Object.freeze({ message, status: "error" });
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error && cause.message.trim()
    ? cause.message
    : "JavaScript test batch failed.";
}
