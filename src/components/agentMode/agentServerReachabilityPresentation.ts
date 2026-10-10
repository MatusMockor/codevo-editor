import type {
  RemoteRunnerDisconnectReason,
  RemoteRunnerReachability,
} from "../../domain/remoteRunnerReachability";

export const AGENT_SERVER_RECONNECTING_GRACE_MS = 2_000;
export const AGENT_SERVER_RETRY_LABEL = "Retry now";
export const AGENT_SERVER_RECONNECT_LABEL = "Reconnect";
export const AGENT_SERVER_RECONNECT_FAILED = "Could not reconnect. Check the server in Settings.";

const UNNAMED_SERVER = "The server";
const UNNAMED_SERVER_INLINE = "the server";

export type AgentServerBannerAction = "retry" | "reconnect" | "none";

export interface AgentServerBannerPresentation {
  readonly tone: "working" | "warn";
  readonly message: string;
  readonly detail: string | null;
  readonly action: AgentServerBannerAction;
}

export function agentServerBannerPresentation(
  reachability: RemoteRunnerReachability,
  serverName: string | null,
  reconnectingDetail: string | null,
): AgentServerBannerPresentation | null {
  const name = serverName ?? UNNAMED_SERVER;
  switch (reachability.kind) {
    case "reachable":
      return null;
    case "reconnecting":
      return {
        tone: "working",
        message: `${name} is reconnecting…`,
        detail: reconnectingDetail,
        action: "retry",
      };
    case "disconnected":
      return disconnectedBanner(reachability.reason, name);
    default:
      return unsupportedReachability(reachability);
  }
}

export function agentServerWaitLabel(
  reachability: RemoteRunnerReachability,
  serverName: string | null,
): string | null {
  switch (reachability.kind) {
    case "reachable":
      return null;
    case "reconnecting":
      return `Waiting for ${serverName ?? UNNAMED_SERVER_INLINE}…`;
    case "disconnected":
      return `${serverName ?? UNNAMED_SERVER} is disconnected`;
    default:
      return unsupportedReachability(reachability);
  }
}

function disconnectedBanner(
  reason: RemoteRunnerDisconnectReason,
  name: string,
): AgentServerBannerPresentation {
  switch (reason) {
    case "serverDisconnected":
      return {
        tone: "warn",
        message: `${name} is disconnected`,
        detail: null,
        action: "reconnect",
      };
    case "runnerReplaced":
      return {
        tone: "warn",
        message: `${name} is disconnected: its runner was replaced. Remove the server and add it again in Settings.`,
        detail: null,
        action: "none",
      };
    default:
      return unsupportedReason(reason);
  }
}

function unsupportedReachability(reachability: never): never {
  throw new TypeError(`Unsupported remote runner reachability: ${String(reachability)}.`);
}

function unsupportedReason(reason: never): never {
  throw new TypeError(`Unsupported remote runner disconnect reason: ${String(reason)}.`);
}
