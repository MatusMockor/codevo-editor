import type {
  RemoteFileRevealSettlement,
  RemoteFileRevealTarget,
} from "../domain/remoteFileReveal";
import type { RemoteSurfaceScope } from "../domain/remoteRunnerSurfaces";

export interface RemoteFileRevealRequest {
  readonly id: number;
  readonly scope: RemoteSurfaceScope;
  readonly target: RemoteFileRevealTarget;
  accept(): void;
  settle(outcome: RemoteFileRevealSettlement): void;
}

export interface RemoteFileRevealCallbacks {
  readonly accepted?: () => void;
  readonly settled: (outcome: RemoteFileRevealSettlement) => void;
}

export function createRemoteFileRevealRequest(
  id: number,
  scope: RemoteSurfaceScope,
  target: RemoteFileRevealTarget,
  callbacks: RemoteFileRevealCallbacks,
): RemoteFileRevealRequest {
  let accepted = false;
  let settled = false;
  return {
    id,
    scope,
    target,
    accept() {
      if (accepted || settled) return;
      accepted = true;
      callbacks.accepted?.();
    },
    settle(outcome) {
      if (settled) return;
      settled = true;
      callbacks.settled(outcome);
    },
  };
}
