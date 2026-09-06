import {
  appendAgentProviderUpdateOutputTail,
  MAX_AGENT_PROVIDER_UPDATE_OUTPUT_TAIL_BYTES,
  type AgentProviderUpdateState,
} from "../domain/agentProviderHealth";

export const AGENT_PROVIDER_UPDATE_PROGRESS_SUBSCRIBE_TIMEOUT_MS = 1_000;
export const AGENT_PROVIDER_UPDATE_REGISTRATION_TIMEOUT_MS = 15_000;
export const AGENT_PROVIDER_UPDATE_HEALTH_SETTLE_TIMEOUT_MS = 20_000;

export interface AgentProviderUpdateOutput {
  readonly outputTail: string;
  readonly outputTruncated: boolean;
}

export type AgentProviderUpdateFailedState = Extract<
  AgentProviderUpdateState,
  { readonly kind: "failed" }
>;

export type AgentProviderUpdateAlreadyCurrentState = Extract<
  AgentProviderUpdateState,
  { readonly kind: "alreadyCurrent" }
>;

export type BoundedSettlement<T> =
  { readonly kind: "settled"; readonly value: T } | { readonly kind: "timedOut" };

export function currentUpdateOutput(
  state: AgentProviderUpdateState,
  operationId: string,
): AgentProviderUpdateOutput {
  if (state.kind !== "running" || state.operationId !== operationId) {
    return { outputTail: "", outputTruncated: false };
  }
  return { outputTail: state.outputTail, outputTruncated: state.outputTruncated };
}

export function runningUpdateWith(
  state: AgentProviderUpdateState,
  operationId: string,
  addition: string,
  truncated: boolean,
): Extract<AgentProviderUpdateState, { readonly kind: "running" }> {
  const current = currentUpdateOutput(state, operationId);
  const merged = mergedUpdateOutput(current, addition, truncated);
  return { kind: "running", operationId, ...merged };
}

export function mergedUpdateOutput(
  current: AgentProviderUpdateOutput,
  addition: string,
  truncated: boolean,
): AgentProviderUpdateOutput {
  const exceededTail =
    new TextEncoder().encode(`${current.outputTail}${addition}`).byteLength >
    MAX_AGENT_PROVIDER_UPDATE_OUTPUT_TAIL_BYTES;
  return {
    outputTail: appendAgentProviderUpdateOutputTail(current.outputTail, addition),
    outputTruncated: current.outputTruncated || truncated || exceededTail,
  };
}

export function failedUpdateState(
  reason: AgentProviderUpdateFailedState["reason"],
  attemptedVersion: string,
  output: AgentProviderUpdateOutput,
): AgentProviderUpdateFailedState {
  return {
    kind: "failed",
    reason,
    attemptedVersion,
    outputTail: output.outputTail,
    outputTruncated: output.outputTruncated,
  };
}

export function alreadyCurrentUpdateState(
  installedVersion: string,
  offeredVersion: string,
  output: AgentProviderUpdateOutput,
): AgentProviderUpdateAlreadyCurrentState {
  return {
    kind: "alreadyCurrent",
    installedVersion,
    offeredVersion,
    outputTail: output.outputTail,
    outputTruncated: output.outputTruncated,
  };
}

export function updateStateBeforeRegistration(
  state: AgentProviderUpdateState,
): AgentProviderUpdateState {
  switch (state.kind) {
    case "starting":
    case "running":
      return { kind: "idle" };
    case "idle":
    case "succeeded":
    case "alreadyCurrent":
    case "failed":
      return state;
    default:
      return unsupportedUpdateState(state);
  }
}

export function idempotentUnlisten(unlisten: () => void): () => void {
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    unlisten();
  };
}

export function boundedProgressSubscription(
  subscription: Promise<() => void>,
): Promise<
  { readonly kind: "subscribed"; readonly unlisten: () => void } | { readonly kind: "timedOut" }
> {
  return boundedSettlement(subscription, AGENT_PROVIDER_UPDATE_PROGRESS_SUBSCRIBE_TIMEOUT_MS).then(
    (settlement) =>
      settlement.kind === "timedOut"
        ? ({ kind: "timedOut" } as const)
        : ({ kind: "subscribed", unlisten: settlement.value } as const),
  );
}

export function boundedSettlement<T>(
  work: Promise<T>,
  timeoutMs: number,
): Promise<BoundedSettlement<T>> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ kind: "timedOut" });
    }, timeoutMs);
    work.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ kind: "settled", value });
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function unsupportedUpdateState(state: never): never {
  throw new TypeError(`Unsupported provider update state: ${String(state)}.`);
}
