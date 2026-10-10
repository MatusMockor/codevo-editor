import type {
  RemoteRunnerDisconnectReason,
  RemoteRunnerReachability,
} from "../domain/remoteRunnerReachability";

export type RemoteAgentBlockedAction = "send" | "command";

export interface RemoteAgentUnreachableNotice {
  readonly serverId: string;
  readonly action: RemoteAgentBlockedAction;
}

export type RemoteAgentNoticeState =
  | {
      readonly kind: "message";
      readonly owner: object;
      readonly message: string;
      readonly threadId?: string;
    }
  | {
      readonly kind: "unreachable";
      readonly owner: object;
      readonly unreachable: RemoteAgentUnreachableNotice;
    };

export interface RemoteAgentNoticeContext {
  readonly selectedThreadId: string | null;
  reachabilityOf(serverId: string): RemoteRunnerReachability;
  serverNameOf(serverId: string): string | null;
}

const UNNAMED_SERVER = "The server";
const REPLACED_RUNNER_REMEDY = "Remove the server and add it again in Settings.";

export function remoteAgentNoticeMessage(
  state: RemoteAgentNoticeState,
  context: RemoteAgentNoticeContext,
): string | null {
  switch (state.kind) {
    case "message":
      return state.threadId === undefined || state.threadId === context.selectedThreadId
        ? state.message
        : null;
    case "unreachable":
      return remoteAgentUnreachableMessage(
        context.reachabilityOf(state.unreachable.serverId),
        context.serverNameOf(state.unreachable.serverId),
        state.unreachable.action,
      );
    default:
      return unsupportedNotice(state);
  }
}

export function remoteAgentUnreachableMessage(
  reachability: RemoteRunnerReachability,
  serverName: string | null,
  action: RemoteAgentBlockedAction,
): string | null {
  const name = serverName ?? UNNAMED_SERVER;
  switch (reachability.kind) {
    case "reachable":
      return null;
    case "reconnecting":
      return blockedMessage(action, {
        state: `${name} is reconnecting.`,
        sendRemedy: null,
        commandRemedy: "Try again once it is back.",
      });
    case "disconnected":
      return blockedMessage(action, disconnectedOutage(reachability.reason, name));
    default:
      return unsupportedReachability(reachability);
  }
}

interface BlockedOutage {
  readonly state: string;
  readonly sendRemedy: string | null;
  readonly commandRemedy: string;
}

function disconnectedOutage(reason: RemoteRunnerDisconnectReason, name: string): BlockedOutage {
  switch (reason) {
    case "serverDisconnected":
      return {
        state: `${name} is disconnected.`,
        sendRemedy: null,
        commandRemedy: "Reconnect it to continue.",
      };
    case "runnerReplaced":
      return {
        state: `${name} is disconnected because its runner was replaced.`,
        sendRemedy: REPLACED_RUNNER_REMEDY,
        commandRemedy: REPLACED_RUNNER_REMEDY,
      };
    default:
      return unsupportedReason(reason);
  }
}

function blockedMessage(action: RemoteAgentBlockedAction, outage: BlockedOutage): string {
  switch (action) {
    case "send":
      return ["Message not sent:", outage.state, outage.sendRemedy, "Your draft is kept."]
        .filter((part) => part !== null)
        .join(" ");
    case "command":
      return `${outage.state} ${outage.commandRemedy}`;
    default:
      return unsupportedAction(action);
  }
}

function unsupportedReason(reason: never): never {
  throw new TypeError(`Unsupported remote runner disconnect reason: ${String(reason)}.`);
}

function unsupportedReachability(reachability: never): never {
  throw new TypeError(`Unsupported remote runner reachability: ${String(reachability)}.`);
}

function unsupportedNotice(state: never): never {
  throw new TypeError(`Unsupported remote notice: ${String(state)}.`);
}

function unsupportedAction(action: never): never {
  throw new TypeError(`Unsupported blocked remote action: ${String(action)}.`);
}
