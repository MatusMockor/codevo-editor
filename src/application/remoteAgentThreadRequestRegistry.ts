import { remoteAgentThreadRequestIdentity } from "../domain/remoteAgentThreadRequestScope";
import type { AgentThreadRequestScope } from "./agentThreadRequestPorts";
import {
  MAX_REMOTE_AGENT_THREAD_REQUEST_TRACKED_SCOPES,
  MAX_REMOTE_AGENT_THREAD_REQUEST_UNDESCRIBED_PULLS,
} from "./remoteAgentThreadRequestPolicy";
import {
  createRemoteAgentThreadRequestLane,
  type RemoteAgentThreadRequestLane as Lane,
  type RemoteAgentThreadRequestTracked as Tracked,
} from "./remoteAgentThreadRequestTracking";

export class RemoteAgentThreadRequestRegistry {
  private readonly tracked = new Map<string, Tracked>();
  private readonly lanes = new Map<string, Lane>();
  private readonly undescribed = new Set<string>();

  thread(key: string): Tracked | undefined {
    return this.tracked.get(key);
  }

  lane(serverId: string): Lane | undefined {
    return this.lanes.get(serverId);
  }

  owns(thread: Tracked): boolean {
    return this.tracked.get(thread.key) === thread;
  }

  admits(serverId: string): boolean {
    if (this.tracked.size >= MAX_REMOTE_AGENT_THREAD_REQUEST_TRACKED_SCOPES) return false;
    return (
      this.lanes.has(serverId) || this.lanes.size < MAX_REMOTE_AGENT_THREAD_REQUEST_TRACKED_SCOPES
    );
  }

  laneOf(serverId: string): Lane {
    const known = this.lanes.get(serverId);
    if (known !== undefined) return known;
    const lane = createRemoteAgentThreadRequestLane(serverId);
    this.lanes.set(serverId, lane);
    return lane;
  }

  track(thread: Tracked): void {
    this.tracked.set(thread.key, thread);
    thread.lane.threads.add(thread);
  }

  untrack(thread: Tracked): void {
    this.tracked.delete(thread.key);
    thread.lane.threads.delete(thread);
  }

  forgetUndescribed(key: string): boolean {
    return this.undescribed.delete(key);
  }

  remember(scope: AgentThreadRequestScope, key: string): void {
    if (remoteAgentThreadRequestIdentity(scope) === null) return;
    this.undescribed.delete(key);
    this.undescribed.add(key);
    const excess = this.undescribed.size - MAX_REMOTE_AGENT_THREAD_REQUEST_UNDESCRIBED_PULLS;
    for (const stale of [...this.undescribed].slice(0, Math.max(0, excess)))
      this.undescribed.delete(stale);
  }

  retire(lane: Lane): void {
    if (lane.lease !== null || lane.threads.size > 0 || lane.pulls.length > 0) return;
    clearTimeout(lane.timer);
    lane.timer = undefined;
    if (this.lanes.get(lane.serverId) === lane) this.lanes.delete(lane.serverId);
  }
}
