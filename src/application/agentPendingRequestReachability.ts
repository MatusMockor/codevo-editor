import type { RemoteRunnerReachability } from "../domain/remoteRunnerReachability";
import type { AgentPendingRequestAvailability } from "./agentPendingRequestPolling";
import type { AgentThreadView } from "./agentThreadPorts";

export function agentPendingRequestAvailability(
  view: AgentThreadView | null,
): AgentPendingRequestAvailability {
  const reachability = view?.execution?.reachability;
  if (reachability === undefined) return "available";
  return reachabilityAvailability(reachability);
}

function reachabilityAvailability(
  reachability: RemoteRunnerReachability,
): AgentPendingRequestAvailability {
  switch (reachability.kind) {
    case "reachable":
      return "available";
    case "reconnecting":
    case "disconnected":
      return "unreachable";
    default:
      return unsupportedReachability(reachability);
  }
}

function unsupportedReachability(reachability: never): never {
  throw new TypeError(`Unsupported remote runner reachability: ${String(reachability)}.`);
}
