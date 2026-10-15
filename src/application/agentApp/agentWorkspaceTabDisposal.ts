import type {
  ProjectRuntimeStopResult,
  RegisteredWorkspaceRuntimeDisposalResult,
  RegisteredWorkspaceRuntimeDisposalTarget,
} from "../../domain/workspaceRuntimeLifecycle";
import {
  prepareRegisteredWorkspaceClose,
  type RegisteredWorkspaceCloseCoordinator,
  type RegisteredWorkspaceCloseResult,
} from "../registeredWorkspaceCloseCoordinator";
import type {
  AgentWorkspaceProjectCloseResult,
  AgentWorkspaceProjectCloseSettlement,
} from "../useAgentProjects";
import type {
  WorkspaceCloseOwnership,
  WorkspaceTabDisposalResult,
} from "../useWorkbenchWorkspaceTabCloseCoordinator";
import type { BackendClosedWorkspaceIdentitySettlement } from "../workbenchController/useManagedWorkspaceIdentityOwnership";
import type { WorkspaceIdentityDescriptor } from "../workspaceIdentityGatewayPort";

export type WorkspaceIdentityReleaseOutcome = "deferred" | "released" | "retained" | "stale";

export type WorkspaceIdentityReleaseDeferral = "retryLater" | "abandonWhenDeferred";

export interface AgentWorkspaceTabDisposalPorts {
  readonly closeAgents: (
    descriptor: WorkspaceIdentityDescriptor,
    isCurrent: () => boolean,
  ) => Promise<AgentWorkspaceProjectCloseResult>;
  readonly disposeRegisteredWorkspace: (
    target: RegisteredWorkspaceRuntimeDisposalTarget,
  ) => Promise<RegisteredWorkspaceRuntimeDisposalResult>;
  readonly forgetRuntimeOwner: (rootPath: string) => void;
  readonly identities: () => Record<string, WorkspaceIdentityDescriptor>;
  readonly prepareIdentitySettlement: (
    descriptor: WorkspaceIdentityDescriptor,
  ) => BackendClosedWorkspaceIdentitySettlement | null;
  readonly registeredClose: RegisteredWorkspaceCloseCoordinator;
  readonly releaseResourceRoot: (rootPath: string) => void;
  readonly reportError: (source: string, error: unknown) => void;
  readonly stopRuntimes: (
    rootPath: string,
    ownership: WorkspaceCloseOwnership | null,
  ) => Promise<ProjectRuntimeStopResult>;
  readonly unregisterWorkspace: (
    workspaceId: string,
    deferral: WorkspaceIdentityReleaseDeferral,
  ) => Promise<WorkspaceIdentityReleaseOutcome>;
}

export interface AgentWorkspaceTabDisposalRequest {
  readonly closeIsCurrent: () => boolean;
  readonly identity: WorkspaceIdentityDescriptor | null;
  readonly legacyOwnership: boolean;
  readonly ownership: WorkspaceCloseOwnership;
  readonly tabPath: string;
  readonly targetRootPath: string;
}

type RegisteredDisposal =
  | { readonly kind: "settled"; readonly result: WorkspaceTabDisposalResult }
  | {
      readonly kind: "closed";
      readonly agents: AgentWorkspaceProjectCloseSettlement;
      readonly settlement: BackendClosedWorkspaceIdentitySettlement;
    };

export async function disposeAgentWorkspaceTab(
  ports: AgentWorkspaceTabDisposalPorts,
  request: AgentWorkspaceTabDisposalRequest,
): Promise<WorkspaceTabDisposalResult> {
  const { closeIsCurrent, identity, tabPath, targetRootPath } = request;
  if (!closeIsCurrent()) return "stale";

  let agents: AgentWorkspaceProjectCloseSettlement | null = null;
  let settlement: BackendClosedWorkspaceIdentitySettlement | null = null;
  const settleIdentity = () => {
    if (!identity) return;
    const identities = ports.identities();
    for (const [rootPath, descriptor] of Object.entries(identities)) {
      if (descriptor.workspaceId === identity.workspaceId) delete identities[rootPath];
    }
    agents?.finalizeBackendClosed();
  };

  if (identity?.admissionToken !== undefined) {
    const registered = await closeRegisteredWorkspace(ports, identity, closeIsCurrent);
    if (registered.kind === "settled") return registered.result;
    agents = registered.agents;
    settlement = registered.settlement;
    if (!closeIsCurrent()) {
      settlement.settle(settleIdentity);
      return "backend-closed-local-stale";
    }
  }

  if (identity && !settlement) {
    const released = await releaseIdentity(ports, identity, closeIsCurrent);
    if (released !== "released" && released !== "retained") return released;
    if (released === "released") {
      const stopped = await stopOwnedRuntimes(ports, request);
      if (stopped !== null) return stopped;
    }
  }

  if (!identity) {
    const stopped = await stopOwnedRuntimes(ports, request);
    if (stopped !== null) return stopped;
  }

  for (const rootPath of workspaceResourceRoots(tabPath, targetRootPath, identity)) {
    if (!closeIsCurrent()) return "stale";
    ports.releaseResourceRoot(rootPath);
  }
  ports.forgetRuntimeOwner(targetRootPath);

  if (settlement) return settlement.settle(settleIdentity) ? "disposed" : "stale";
  settleIdentity();
  return "disposed";
}

async function closeRegisteredWorkspace(
  ports: AgentWorkspaceTabDisposalPorts,
  identity: WorkspaceIdentityDescriptor,
  closeIsCurrent: () => boolean,
): Promise<RegisteredDisposal> {
  const settled = (result: WorkspaceTabDisposalResult): RegisteredDisposal => ({
    kind: "settled",
    result,
  });
  const settlement = ports.prepareIdentitySettlement(identity);
  if (!settlement) {
    ports.reportError("Workspace", new Error("Registered workspace close authority is stale."));
    return settled("identity-release-failed");
  }
  const exactCloseIsCurrent = () => closeIsCurrent() && settlement.isCurrent();
  const preparation = prepareRegisteredWorkspaceClose(identity, exactCloseIsCurrent);
  switch (preparation.status) {
    case "invalid":
      ports.reportError("Workspace", new Error("Registered workspace close authority is invalid."));
      return settled("identity-release-failed");
    case "legacy":
      return settled("identity-release-failed");
    case "ready":
      break;
    default: {
      const unsupported: never = preparation;
      return unsupported;
    }
  }

  let agentResult: AgentWorkspaceProjectCloseResult;
  try {
    agentResult = await ports.closeAgents(identity, preparation.lease.isCurrent);
  } catch (error) {
    if (!exactCloseIsCurrent()) return settled("stale");
    ports.reportError("Runtime cleanup", error);
    return settled("runtime-stop-incomplete");
  }
  switch (agentResult.status) {
    case "stale":
      return settled("stale");
    case "lease-release-incomplete":
    case "task-stop-incomplete":
      ports.reportError(
        "Runtime cleanup",
        new Error(`Agent workspace cleanup ${agentResult.status}.`),
      );
      return settled("runtime-stop-incomplete");
    case "closed":
      break;
    default: {
      const unsupported: never = agentResult;
      return unsupported;
    }
  }
  const agents = agentResult.settlement;
  const notClosed = async (result: WorkspaceTabDisposalResult): Promise<RegisteredDisposal> => {
    await completeAgentClose(ports, agents, "backend-not-closed");
    return settled(result);
  };
  try {
    await settlement.flushCompensations();
  } catch (error) {
    if (!exactCloseIsCurrent()) return notClosed("stale");
    ports.reportError("Runtime cleanup", error);
    return notClosed("runtime-stop-incomplete");
  }
  if (!exactCloseIsCurrent()) return notClosed("stale");

  let result: RegisteredWorkspaceCloseResult;
  try {
    result = await ports.registeredClose.close({
      closeDocuments: [],
      disposeRegisteredWorkspace: ports.disposeRegisteredWorkspace,
      lease: preparation.lease,
    });
  } catch (error) {
    if (!closeIsCurrent()) return notClosed("stale");
    ports.reportError("Runtime cleanup", uncertainBackendCloseError(error));
    return notClosed("runtime-stop-incomplete");
  }
  switch (result.status) {
    case "stale":
      return notClosed("stale");
    case "incomplete":
      if (!exactCloseIsCurrent()) return notClosed("stale");
      ports.reportError("Runtime cleanup", new Error(result.errors.join("\n")));
      return notClosed("runtime-stop-incomplete");
    case "closed":
    case "retainedByOtherOwners":
      break;
    default: {
      const unsupported: never = result;
      return unsupported;
    }
  }
  await completeAgentClose(ports, agents, "backend-closed");
  if (!settlement.canSettleClosed()) {
    agents.finalizeBackendClosed();
    return settled("stale");
  }
  return { kind: "closed", agents, settlement };
}

async function completeAgentClose(
  ports: AgentWorkspaceTabDisposalPorts,
  agents: AgentWorkspaceProjectCloseSettlement,
  outcome: "backend-closed" | "backend-not-closed",
): Promise<void> {
  try {
    await agents.complete(outcome);
  } catch (error) {
    ports.reportError("Agents", error);
  }
}

export const UNCERTAIN_BACKEND_CLOSE_MESSAGE =
  "The workspace close did not confirm whether the backend closed; the project stays open.";

function uncertainBackendCloseError(cause: unknown): Error {
  const detail = cause instanceof Error && cause.message ? ` ${cause.message}` : "";
  return new Error(`${UNCERTAIN_BACKEND_CLOSE_MESSAGE}${detail}`);
}

async function releaseIdentity(
  ports: AgentWorkspaceTabDisposalPorts,
  identity: WorkspaceIdentityDescriptor,
  closeIsCurrent: () => boolean,
): Promise<"released" | "retained" | WorkspaceTabDisposalResult> {
  let outcome: WorkspaceIdentityReleaseOutcome;
  try {
    outcome = await ports.unregisterWorkspace(identity.workspaceId, "abandonWhenDeferred");
  } catch (error) {
    ports.reportError("Workspace", error);
    return "identity-release-failed";
  }
  switch (outcome) {
    case "deferred":
      return "identity-release-deferred";
    case "stale":
      ports.reportError("Workspace", new Error("Workspace identity release owner is stale."));
      return "identity-release-failed";
    case "released":
    case "retained":
      return closeIsCurrent() ? outcome : "stale";
    default: {
      const unsupported: never = outcome;
      return unsupported;
    }
  }
}

async function stopOwnedRuntimes(
  ports: AgentWorkspaceTabDisposalPorts,
  request: AgentWorkspaceTabDisposalRequest,
): Promise<WorkspaceTabDisposalResult | null> {
  const { closeIsCurrent, legacyOwnership, ownership, targetRootPath } = request;
  if (!closeIsCurrent() || !ownership.isCurrent()) return "stale";
  let result: ProjectRuntimeStopResult;
  try {
    result = await ports.stopRuntimes(targetRootPath, legacyOwnership ? null : ownership);
  } catch (error) {
    if (!closeIsCurrent()) return "stale";
    ports.reportError("Runtime cleanup", error);
    return "runtime-stop-incomplete";
  }
  if (!closeIsCurrent()) return "stale";
  switch (result) {
    case "stopped":
      return null;
    case "incomplete":
      return "runtime-stop-incomplete";
    case "stale":
      return "stale";
    default: {
      const unsupported: never = result;
      return unsupported;
    }
  }
}

function workspaceResourceRoots(
  tabPath: string,
  targetRootPath: string,
  identity: WorkspaceIdentityDescriptor | null,
): string[] {
  const roots = [tabPath, targetRootPath];
  if (identity) roots.push(identity.selectedPath, identity.canonicalRoot);
  return [...new Set(roots)];
}
