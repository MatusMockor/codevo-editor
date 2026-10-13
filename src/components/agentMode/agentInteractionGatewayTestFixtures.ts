import { vi } from "vitest";
import type { AgentApprovalGateway } from "../../application/agentApprovalPorts";
import type {
  AgentInteractionFeed,
  AgentInteractionOwner,
} from "../../application/agentInteractionPorts";
import type { AgentQuestionGateway } from "../../application/agentQuestionPorts";
import {
  agentInteractionFeedFake,
  agentInteractionSnapshotOf,
  type AgentInteractionSnapshotParts,
} from "../../test/agentInteractionFeedFake";
import type { AgentInteractionSnapshot } from "../../domain/agentInteractionSnapshot";

export class FakeAgentInteractionGateway
  implements AgentQuestionGateway, AgentApprovalGateway, AgentInteractionFeed
{
  readable = true;
  readonly list = vi.fn<AgentQuestionGateway["list"]>(() => Promise.resolve([]));
  readonly answer = vi.fn<AgentQuestionGateway["answer"]>();
  readonly answerApproval = vi.fn<AgentApprovalGateway["answerApproval"]>();
  private readonly feed = agentInteractionFeedFake();
  private sequence = 0;
  readonly subscribeInteractions = this.feed.subscribeInteractions;
  readonly currentInteractions = vi.fn<AgentInteractionFeed["currentInteractions"]>((owner) =>
    this.read(owner),
  );

  get subscribers(): number {
    return this.feed.subscribers();
  }

  stage(owner: AgentInteractionOwner, interactions: AgentInteractionSnapshotParts): void {
    this.feed.record(this.next(owner, interactions));
  }

  push(owner: AgentInteractionOwner, interactions: AgentInteractionSnapshotParts): void {
    this.feed.publish(this.next(owner, interactions));
  }

  private read(owner: AgentInteractionOwner): Promise<AgentInteractionSnapshot> {
    if (!this.readable) return Promise.reject(new Error("Agent interactions are unavailable."));
    return this.feed.currentInteractions(owner);
  }

  private next(
    owner: AgentInteractionOwner,
    interactions: AgentInteractionSnapshotParts,
  ): AgentInteractionSnapshot {
    this.sequence += 1;
    return agentInteractionSnapshotOf(owner, this.sequence, structuredClone(interactions));
  }
}
