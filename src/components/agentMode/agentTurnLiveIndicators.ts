import {
  isRemoteRunnerReachable,
  type RemoteRunnerReachability,
} from "../../domain/remoteRunnerReachability";
import type { AgentProseStream } from "./AgentAssistantText";
import type { AgentBackgroundIndicator } from "./agentBackgroundIndicatorPresentation";
import { AGENT_TURN_UNTIMED, type AgentTurnTiming } from "./agentTurnHeadPresentation";

export interface AgentTurnLiveIndicators {
  readonly workRunning: boolean;
  readonly stream: AgentProseStream;
  readonly backgroundTitle: string | null;
  readonly backgroundIndicator: AgentBackgroundIndicator;
  readonly compactionActivity: boolean;
  readonly codexStarting: boolean;
  readonly waitingForOutput: boolean;
  readonly timing: AgentTurnTiming;
}

const NO_BACKGROUND_INDICATOR: AgentBackgroundIndicator = Object.freeze({ kind: "hidden" });

export function agentTurnServerWait(
  running: boolean,
  reachability: RemoteRunnerReachability | undefined,
): RemoteRunnerReachability | null {
  if (!running || reachability === undefined) return null;
  if (isRemoteRunnerReachable(reachability)) return null;
  return reachability;
}

export function agentLiveWhileServerReachable<Live>(
  reachability: RemoteRunnerReachability | undefined,
  live: Live | null,
): Live | null {
  if (reachability !== undefined && !isRemoteRunnerReachable(reachability)) return null;
  return live;
}

export function agentTurnLiveIndicators(
  serverWait: RemoteRunnerReachability | null,
  live: AgentTurnLiveIndicators,
): AgentTurnLiveIndicators {
  if (serverWait === null) return live;
  return {
    workRunning: false,
    stream: lastKnownStream(live.stream),
    backgroundTitle: null,
    backgroundIndicator: NO_BACKGROUND_INDICATOR,
    compactionActivity: false,
    codexStarting: false,
    waitingForOutput: false,
    timing: AGENT_TURN_UNTIMED,
  };
}

function lastKnownStream(stream: AgentProseStream): AgentProseStream {
  switch (stream) {
    case "streaming":
      return "streamed";
    case "streamed":
    case "settled":
      return stream;
    default:
      return unsupportedStream(stream);
  }
}

function unsupportedStream(stream: never): never {
  throw new TypeError(`Unsupported prose stream: ${String(stream)}.`);
}
