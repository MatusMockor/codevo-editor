import type { AgentThreadRequests } from "../domain/agentRuntimeRequest";
import { MAX_REMOTE_AGENT_THREAD_REQUEST_SUBSCRIBERS } from "./remoteAgentThreadRequestPolicy";
import type { RemoteAgentThreadRequestRegistry } from "./remoteAgentThreadRequestRegistry";
import type { RemoteAgentThreadRequestSendGuards } from "./remoteAgentThreadRequestSendGuards";
import type { RemoteAgentThreadRequestTracked as Tracked } from "./remoteAgentThreadRequestTracking";

type Handler = (message: AgentThreadRequests) => void;

export class RemoteAgentThreadRequestBroadcast {
  private readonly handlers = new Set<Handler>();

  constructor(
    private readonly registry: RemoteAgentThreadRequestRegistry,
    private readonly guards: RemoteAgentThreadRequestSendGuards,
  ) {}

  subscribe(handler: Handler): Promise<() => void> {
    if (this.handlers.size >= MAX_REMOTE_AGENT_THREAD_REQUEST_SUBSCRIBERS)
      return Promise.reject(new Error("Too many remote thread request subscribers."));
    const registration: Handler = (message) => handler(message);
    this.handlers.add(registration);
    return Promise.resolve(() => {
      this.handlers.delete(registration);
    });
  }

  announce(thread: Tracked, message: AgentThreadRequests | null): boolean {
    if (message === null || !this.registry.owns(thread) || !thread.watch.owns(message))
      return false;
    this.guards.forgetClosed(thread.key, message.requests);
    this.push(thread, thread.watch.deliver(message));
    return true;
  }

  push(thread: Tracked, message: AgentThreadRequests | null): void {
    if (message === null) return;
    if (thread.pulls === 0) thread.kickOwed = false;
    for (const handler of [...this.handlers]) deliver(handler, message);
  }
}

function deliver(handler: Handler, message: AgentThreadRequests): void {
  try {
    handler(message);
  } catch {
    return;
  }
}
