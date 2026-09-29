import { useLayoutEffect, useRef, useState } from "react";
import {
  NO_AGENT_SESSION_BACKGROUNDS,
  applyAgentSessionBackgroundLevel,
  endAgentSessionBackground,
  type AgentSessionBackgrounds,
} from "../domain/agentSessionBackground";
import type {
  AgentSessionBackgroundTasksEvent,
  AgentSessionEndedEvent,
  AgentThreadSessionGateway,
} from "../domain/agentThreadSession";
import {
  useAgentSessionEventSubscription,
  type AgentSessionEventSubscription,
} from "./useAgentSessionEventSubscription";

const subscribeLevels: AgentSessionEventSubscription<AgentSessionBackgroundTasksEvent> = (
  gateway,
  handler,
) => gateway.subscribeAgentSessionBackgroundTasks(handler);

const subscribeEnded: AgentSessionEventSubscription<AgentSessionEndedEvent> = (gateway, handler) =>
  gateway.subscribeAgentSessionEnded(handler);

export function useAgentSessionBackgrounds(
  gateway: AgentThreadSessionGateway | undefined,
  now: () => number,
  reportFailure: (error: unknown) => void,
): AgentSessionBackgrounds {
  const [backgrounds, setBackgrounds] = useState(NO_AGENT_SESSION_BACKGROUNDS);
  const nowRef = useRef(now);
  useLayoutEffect(() => {
    nowRef.current = now;
  });
  useAgentSessionEventSubscription(gateway, subscribeLevels, {
    onEvent: (event) =>
      setBackgrounds((current) =>
        applyAgentSessionBackgroundLevel(current, event, nowRef.current()),
      ),
    onFailure: reportFailure,
  });
  useAgentSessionEventSubscription(gateway, subscribeEnded, {
    onEvent: (event) => setBackgrounds((current) => endAgentSessionBackground(current, event)),
    onFailure: reportFailure,
  });
  return backgrounds;
}
