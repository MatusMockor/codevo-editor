import {
  validatedJsTestTaskRunId,
  validatedJsTestTaskWorkspaceId,
  type JsTestTaskGateway,
  type JsTestTaskOwner,
  type JsTestTaskRunResponse,
} from "../domain/jsTestTask";
import { validatedJsTestRunScope, type JsTestRunScope } from "../domain/jsTestRunScope";

export type JsTestSingleRunOutcome =
  | { readonly envelope: JsTestTaskRunResponse; readonly status: "settled" }
  | { readonly status: "rejected" }
  | { readonly status: "stale" }
  | { readonly message: string; readonly status: "error" };

export interface JsTestSingleRunCoordinator {
  canCancel(): boolean;
  cancel(): Promise<boolean>;
  invalidate(): Promise<boolean>;
  start(request: {
    readonly activation: number;
    readonly scope: JsTestRunScope;
    readonly workspaceId: string;
  }): Promise<JsTestSingleRunOutcome>;
}

export function createJsTestSingleRunCoordinator(options: {
  readonly createRunId: () => string;
  readonly gateway: JsTestTaskGateway;
  readonly isCurrent: (activation: number, workspaceId: string) => boolean;
}): JsTestSingleRunCoordinator {
  let active: {
    readonly activation: number;
    cancelRequested: boolean;
    invalidated: boolean;
    readonly owner: JsTestTaskOwner;
    stopFlight: Promise<boolean> | null;
  } | null = null;

  const current = (candidate: NonNullable<typeof active>): boolean => {
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
    if (!candidate.stopFlight) {
      candidate.stopFlight = safelyStop(options.gateway, candidate.owner);
    }
    const stopped = await candidate.stopFlight;
    return stopped === true && current(candidate);
  };

  return Object.freeze({
    canCancel: () => active !== null,
    cancel: () => stop(false),
    invalidate: () => stop(true),
    start: async (request: {
      readonly activation: number;
      readonly scope: JsTestRunScope;
      readonly workspaceId: string;
    }): Promise<JsTestSingleRunOutcome> => {
      if (active !== null || !validRequest(request, options.isCurrent)) return rejected();
      let runId: string;
      try {
        runId = validatedJsTestTaskRunId(options.createRunId());
      } catch {
        return error("JavaScript test task could not create a valid owner.");
      }
      const candidate = {
        activation: request.activation,
        cancelRequested: false,
        invalidated: false,
        owner: Object.freeze({ runId, workspaceId: request.workspaceId }),
        stopFlight: null,
      };
      active = candidate;
      try {
        let envelope: JsTestTaskRunResponse;
        try {
          envelope = await options.gateway.runTask(
            Object.freeze({
              ...candidate.owner,
              scope: immutableScope(request.scope),
            }),
          );
        } catch (cause) {
          if (!current(candidate) || candidate.invalidated) return stale();
          return error(errorMessage(cause));
        }
        if (!current(candidate) || candidate.invalidated) return stale();
        if (
          envelope.owner.runId !== candidate.owner.runId ||
          envelope.owner.workspaceId !== candidate.owner.workspaceId
        ) {
          return error("JavaScript test task returned an invalid owner.");
        }
        return Object.freeze({ envelope, status: "settled" });
      } finally {
        if (active === candidate) active = null;
      }
    },
  });
}

function validRequest(
  request: { activation: number; scope: JsTestRunScope; workspaceId: string },
  isCurrent: (activation: number, workspaceId: string) => boolean,
): boolean {
  try {
    validatedJsTestTaskWorkspaceId(request.workspaceId);
    validatedJsTestRunScope(request.scope);
    return (
      Number.isSafeInteger(request.activation) &&
      request.activation >= 0 &&
      isCurrent(request.activation, request.workspaceId) === true
    );
  } catch {
    return false;
  }
}

function immutableScope(scope: JsTestRunScope): JsTestRunScope {
  return Object.freeze({ ...validatedJsTestRunScope(scope) });
}

async function safelyStop(gateway: JsTestTaskGateway, owner: JsTestTaskOwner): Promise<boolean> {
  try {
    return (await gateway.stopTask(owner)) === true;
  } catch {
    return false;
  }
}

function rejected(): JsTestSingleRunOutcome {
  return Object.freeze({ status: "rejected" });
}

function stale(): JsTestSingleRunOutcome {
  return Object.freeze({ status: "stale" });
}

function error(message: string): JsTestSingleRunOutcome {
  return Object.freeze({ message, status: "error" });
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error && cause.message.trim()
    ? cause.message
    : "JavaScript test task failed.";
}
