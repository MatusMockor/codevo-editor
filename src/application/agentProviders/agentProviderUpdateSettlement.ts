import type { AgentProviderUpdateResult } from "../../domain/agentProviderHealth";
import type { AgentCliKind } from "../../domain/agentTask";
import {
  alreadyCurrentUpdateState,
  currentUpdateOutput,
  failedUpdateState,
} from "../agentProviderUpdateRun";
import type { AgentProviderHealthCoordinator } from "./agentProviderHealthCoordinator";
import {
  currentProviderOwner,
  providerOwnerIsCurrent,
  publishProvider,
  type AgentProviderManagementState,
} from "./agentProviderManagementState";
import { stillOffers, updateSettlementDisagreement } from "./agentProviderRuntime";
import type { AgentProviderSettingsSave } from "./agentProviderSettingsSave";

type SettledUpdateResult = Exclude<AgentProviderUpdateResult, { readonly kind: "failed" }>;

interface AgentProviderUpdateSettlementContext {
  readonly state: AgentProviderManagementState;
  readonly health: AgentProviderHealthCoordinator;
  readonly saveWithOutcome: AgentProviderSettingsSave;
}

export function settleAgentProviderUpdate(
  context: AgentProviderUpdateSettlementContext,
  provider: AgentCliKind,
  offeredVersion: string,
  operationId: string,
  result: SettledUpdateResult,
): Promise<null> {
  switch (result.kind) {
    case "alreadyCurrent":
      return settleAlreadyCurrent(context, provider, offeredVersion, operationId, result);
    case "succeeded":
      return settleSucceeded(context, provider, offeredVersion, operationId, result);
    default:
      return unsupportedUpdateResult(result);
  }
}

function releaseOperation(
  state: AgentProviderManagementState,
  provider: AgentCliKind,
  operationId: string,
): null {
  if (state.updateOperations[provider] === operationId) {
    delete state.updateOperations[provider];
  }
  return null;
}

function failSettlement(
  context: AgentProviderUpdateSettlementContext,
  provider: AgentCliKind,
  offeredVersion: string,
  reason: "uncertain" | "versionMismatch",
  streamed: ReturnType<typeof currentUpdateOutput>,
): null {
  delete context.state.updateOperations[provider];
  publishProvider(context.state, provider, (current) => ({
    ...current,
    updateState: failedUpdateState(reason, offeredVersion, streamed),
  }));
  context.health.scheduleHealth(provider);
  context.state.sink.setToast({ kind: "updateFailed", provider });
  return null;
}

async function settleAlreadyCurrent(
  context: AgentProviderUpdateSettlementContext,
  provider: AgentCliKind,
  offeredVersion: string,
  operationId: string,
  result: Extract<SettledUpdateResult, { readonly kind: "alreadyCurrent" }>,
): Promise<null> {
  const { state, health } = context;
  const streamed = currentUpdateOutput(state.runtime[provider].updateState, operationId);
  publishProvider(state, provider, (current) => ({
    ...current,
    configurationRevision: current.configurationRevision + 1,
    healthGeneration: current.healthGeneration + 1,
    updateState: alreadyCurrentUpdateState(result.installedVersion, offeredVersion, streamed),
  }));
  const alreadyCurrentOwner = currentProviderOwner(state, provider);
  if (alreadyCurrentOwner === null) return null;
  const settledHealth = await health.refreshHealth(provider);
  if (!providerOwnerIsCurrent(state, alreadyCurrentOwner)) return null;
  const disagreement = updateSettlementDisagreement(settledHealth, result.installedVersion);
  if (disagreement !== null) {
    return failSettlement(context, provider, offeredVersion, disagreement, streamed);
  }
  health.scheduleHealth(provider);
  const offeredPreference = state.authorities[provider]?.preference;
  if (!stillOffers(settledHealth, offeredVersion) || offeredPreference === undefined) {
    return releaseOperation(state, provider, operationId);
  }
  if (offeredPreference.dismissedUpdateVersion !== offeredVersion) {
    const dismissal = await context.saveWithOutcome(
      {
        provider,
        preference: { ...offeredPreference, dismissedUpdateVersion: offeredVersion },
      },
      operationId,
    );
    if (dismissal.kind !== "persisted") return releaseOperation(state, provider, operationId);
    if (!state.mounted) return null;
    if (state.runtime[provider].updateState.kind !== "alreadyCurrent") return null;
  }
  if (state.updateOperations[provider] !== operationId) return null;
  delete state.updateOperations[provider];
  state.sink.setToast({
    kind: "updateAlreadyCurrent",
    provider,
    version: result.installedVersion,
  });
  return null;
}

async function settleSucceeded(
  context: AgentProviderUpdateSettlementContext,
  provider: AgentCliKind,
  offeredVersion: string,
  operationId: string,
  result: Extract<SettledUpdateResult, { readonly kind: "succeeded" }>,
): Promise<null> {
  const { state, health } = context;
  publishProvider(state, provider, (current) => ({
    ...current,
    configurationRevision: current.configurationRevision + 1,
    healthGeneration: current.healthGeneration + 1,
  }));
  const settledOwner = currentProviderOwner(state, provider);
  if (settledOwner === null) return null;
  const settledHealth = await health.refreshHealth(provider);
  if (!providerOwnerIsCurrent(state, settledOwner)) return null;
  const mismatch = updateSettlementDisagreement(settledHealth, result.installedVersion);
  if (mismatch !== null) {
    const streamed = currentUpdateOutput(state.runtime[provider].updateState, operationId);
    return failSettlement(context, provider, offeredVersion, mismatch, streamed);
  }
  publishProvider(state, provider, (current) => ({ ...current, updateState: result }));
  health.scheduleHealth(provider);
  const preference = state.authorities[provider]?.preference;
  if (preference !== undefined && preference.dismissedUpdateVersion !== null) {
    const dismissalOutcome = await context.saveWithOutcome(
      { provider, preference: { ...preference, dismissedUpdateVersion: null } },
      operationId,
    );
    if (dismissalOutcome.kind !== "persisted") {
      return releaseOperation(state, provider, operationId);
    }
    if (!state.mounted) return null;
    if (state.updateOperations[provider] !== operationId) return null;
    if (state.runtime[provider].updateState.kind !== "succeeded") return null;
  }
  if (state.updateOperations[provider] !== operationId) return null;
  delete state.updateOperations[provider];
  state.sink.setToast({ kind: "updateSucceeded", provider, version: result.installedVersion });
  return null;
}

function unsupportedUpdateResult(result: never): never {
  throw new TypeError(`Unsupported agent provider update result: ${String(result)}.`);
}
