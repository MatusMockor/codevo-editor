import type { StoredAgentLaunchAdmission } from "../../domain/agentStoredLaunch";
import type { SteerAgentTaskRequest } from "../../domain/agentTask";
import {
  agentTurnAcceptsSteerBytes,
  agentTurnEventUtf8Bytes,
  runningTurn,
  type AgentTurnEvent,
} from "../../domain/agentThread";
import type { AgentQueuedEditCommit } from "../agentQueuedFollowUpEdit";
import { AGENT_TASKS_SOURCE, type AgentTaskLaunchAuthority } from "../agentProjectAuthority";
import type { AgentFollowUpRequest, AgentSteerRequest } from "../agentThreadPorts";
import {
  releaseTurnAttachments,
  type AgentTurnAttachmentAuthority,
  type ClaimedTurnAttachments,
} from "../agentTurnAttachments";
import type { AgentTurnSteerDependencies } from "./agentSteerQueueState";

export function steerEventFits(
  deps: AgentTurnSteerDependencies,
  threadId: string,
  turnId: string,
  event: Extract<AgentTurnEvent, { kind: "userMessage" }>,
): boolean {
  const turn = deps.store
    .currentState()
    .threads.get(threadId)
    ?.turns.find((candidate) => candidate.turnId === turnId);
  return turn !== undefined && agentTurnAcceptsSteerBytes(turn, agentTurnEventUtf8Bytes(event));
}

export function steerThreadIsCurrent(
  deps: AgentTurnSteerDependencies,
  threadId: string,
  turnId: string,
  ownerId: string,
): boolean {
  const thread = deps.store.currentState().threads.get(threadId);
  if (thread === undefined || thread.archived || thread.owner.ownerId !== ownerId) return false;
  return thread.turns[thread.turns.length - 1]?.turnId === turnId;
}

export function steerTargetIsCurrent(
  dependenciesRef: { readonly current: AgentTurnSteerDependencies },
  mountedRef: { readonly current: boolean },
  threadId: string,
  turnId: string,
  ownerId: string,
): boolean {
  if (!mountedRef.current) return false;
  const thread = dependenciesRef.current.store.currentState().threads.get(threadId);
  if (thread === undefined) return false;
  if (thread.owner.ownerId !== ownerId) return false;
  const turn = runningTurn(thread);
  return turn !== null && turn.turnId === turnId;
}

export async function releaseQueuedEditClaim(
  deps: AgentTurnSteerDependencies,
  workspaceId: string,
  commit: AgentQueuedEditCommit,
): Promise<void> {
  const gateway = deps.agentAttachmentGateway;
  if (gateway === undefined) return;
  await releaseTurnAttachments(gateway, workspaceId, commit.attachments ?? [], (error) =>
    deps.reportError(AGENT_TASKS_SOURCE, error),
  );
}

export function steerAttachmentAuthority(
  authority: AgentTaskLaunchAuthority,
): AgentTurnAttachmentAuthority {
  return {
    rootKey: authority.rootKey,
    ownerId: authority.ownerId,
    generation: authority.generation,
    workspaceId: authority.workspaceId,
  };
}

export function steerPayload(
  taskId: string,
  workspaceId: string,
  threadId: string,
  prepared: ClaimedTurnAttachments,
): SteerAgentTaskRequest {
  const payload = { taskId, workspaceId, threadId, prompt: prepared.prompt };
  if (prepared.references.length === 0) return payload;
  return { ...payload, attachments: prepared.references };
}

export function steeredEvent(
  prepared: ClaimedTurnAttachments,
): Extract<AgentTurnEvent, { kind: "userMessage" }> {
  if (prepared.attachments.length === 0) return { kind: "userMessage", text: prepared.prompt };
  return { kind: "userMessage", text: prepared.prompt, attachments: prepared.attachments };
}

export function deferredFollowUpRequest(
  threadId: string,
  admission: Extract<StoredAgentLaunchAdmission, { kind: "ready" }>,
  request: AgentSteerRequest,
): AgentFollowUpRequest {
  const followUp: AgentFollowUpRequest = {
    threadId,
    prompt: request.prompt,
    launch: admission.launch,
    dangerousLaunchConfirmed: admission.dangerousLaunchConfirmed,
  };
  if (request.attachments === undefined) return followUp;
  if (request.attachmentOwner === undefined) {
    return { ...followUp, attachments: request.attachments };
  }
  return {
    ...followUp,
    attachments: request.attachments,
    attachmentOwner: request.attachmentOwner,
  };
}

export function unsupportedSteerRejection(reason: never): never {
  throw new TypeError(`Unsupported agent task steer rejection: ${String(reason)}.`);
}

/** A disconnected request registry must not hold the per-thread send lease forever. */
export async function boundedPendingInputCheck(
  check: (threadId: string) => Promise<boolean>,
  threadId: string,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => check(threadId)),
      new Promise<boolean>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Pending request check timed out.")), 5_000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
