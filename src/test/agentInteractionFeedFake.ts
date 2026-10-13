import { vi, type Mock } from "vitest";
import type {
  AgentInteractionFeed,
  AgentInteractionOwner,
} from "../application/agentInteractionPorts";
import type { AgentApprovalRequest } from "../domain/agentApproval";
import type { AgentInteractionSnapshot } from "../domain/agentInteractionSnapshot";
import type { AgentQuestionRequest } from "../domain/agentQuestion";

type InteractionHandler = (snapshot: AgentInteractionSnapshot) => void;

export interface AgentInteractionFeedFake extends AgentInteractionFeed {
  readonly currentInteractions: Mock<AgentInteractionFeed["currentInteractions"]>;
  readonly subscribeInteractions: Mock<AgentInteractionFeed["subscribeInteractions"]>;
  readonly unsubscribed: Mock<() => void>;
  subscribers(): number;
  record(snapshot: AgentInteractionSnapshot): void;
  push(snapshot: AgentInteractionSnapshot): void;
  publish(snapshot: AgentInteractionSnapshot): void;
}

export interface AgentInteractionSnapshotParts {
  readonly questions?: readonly AgentQuestionRequest[];
  readonly approvals?: readonly AgentApprovalRequest[];
}

export function agentInteractionSnapshotOf(
  owner: AgentInteractionOwner,
  sequence: number,
  parts: AgentInteractionSnapshotParts = {},
): AgentInteractionSnapshot {
  return {
    workspaceId: owner.workspaceId,
    taskId: owner.taskId,
    sequence,
    questions: parts.questions ?? [],
    approvals: parts.approvals ?? [],
  };
}

export function agentInteractionFeedFake(): AgentInteractionFeedFake {
  const handlers = new Set<InteractionHandler>();
  const recorded = new Map<string, AgentInteractionSnapshot>();
  const unsubscribed = vi.fn<() => void>();
  const record = (snapshot: AgentInteractionSnapshot): void => {
    recorded.set(ownerKey(snapshot), snapshot);
  };
  const push = (snapshot: AgentInteractionSnapshot): void => {
    [...handlers].forEach((handler) => handler(snapshot));
  };
  return {
    currentInteractions: vi.fn((owner: AgentInteractionOwner) =>
      Promise.resolve(recorded.get(ownerKey(owner)) ?? agentInteractionSnapshotOf(owner, 0)),
    ),
    subscribeInteractions: vi.fn((handler: InteractionHandler) => {
      handlers.add(handler);
      return Promise.resolve(() => {
        handlers.delete(handler);
        unsubscribed();
      });
    }),
    unsubscribed,
    subscribers: () => handlers.size,
    record,
    push,
    publish: (snapshot) => {
      record(snapshot);
      push(snapshot);
    },
  };
}

function ownerKey(owner: AgentInteractionOwner): string {
  return JSON.stringify([owner.workspaceId, owner.taskId]);
}
