import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { emptyDeferredFollowUps, type DeferredFollowUps } from "./agentDeferredFollowUps";
import type {
  AgentTurnSteerOptions,
  AgentTurnSteerSurface,
} from "./agentThreads/agentSteerQueueState";
import { createAgentTurnSteerCoordinator } from "./agentThreads/agentTurnSteerCoordinator";
export {
  DEFERRED_CLEARED_NOTICE,
  DEFERRED_FULL_NOTICE,
  STEER_DROPPED_NOTICE,
  STEER_FAILED_NOTICE,
  STEER_STOPPING_NOTICE,
  STEER_TOO_LONG_NOTICE,
  STEER_UNAVAILABLE_NOTICE,
  STEER_UNREGISTERED_NOTICE,
  STEER_WRITE_FAILED_NOTICE,
  STORED_LAUNCH_NEEDS_CONFIRMATION_NOTICE,
} from "./agentThreads/agentSteerSend";
export type {
  AgentTurnSteerDependencies,
  AgentTurnSteerOptions,
  AgentTurnSteerSurface,
} from "./agentThreads/agentSteerQueueState";

export function useAgentTurnSteer(options: AgentTurnSteerOptions): AgentTurnSteerSurface {
  const { state } = options;
  const optionsRef = useRef(options);
  useLayoutEffect(() => {
    optionsRef.current = options;
  });
  const [deferredFollowUps, setDeferredFollowUps] =
    useState<DeferredFollowUps>(emptyDeferredFollowUps);
  const [drainTick, setDrainTick] = useState(0);
  const [coordinator] = useState(() =>
    createAgentTurnSteerCoordinator({
      initialDeferred: deferredFollowUps,
      options: () => optionsRef.current,
      publishDeferred: setDeferredFollowUps,
      requestDrain: () => setDrainTick((tick) => tick + 1),
    }),
  );

  useEffect(() => {
    if (deferredFollowUps.size === 0) return;
    const timer = setInterval(() => coordinator.releaseBlockedThreads(), 1_000);
    return () => clearInterval(timer);
  }, [coordinator, deferredFollowUps.size]);

  useEffect(() => {
    coordinator.drainDeferred(state);
  }, [coordinator, drainTick, state, deferredFollowUps]);

  return {
    deferredFollowUps,
    steer: coordinator.steer,
    removeDeferredFollowUp: coordinator.removeDeferredFollowUp,
    beginDeferredFollowUpEdit: coordinator.beginDeferredFollowUpEdit,
    cancelDeferredFollowUpEdit: coordinator.cancelDeferredFollowUpEdit,
    commitDeferredFollowUpEdit: coordinator.commitDeferredFollowUpEdit,
    sendDeferredFollowUpNow: coordinator.sendDeferredFollowUpNow,
    resumeDeferredFollowUps: coordinator.resumeDeferredFollowUps,
    restartDeferredFollowUp: coordinator.restartDeferredFollowUp,
    onTurnSettled: coordinator.onTurnSettled,
    onThreadStopped: coordinator.onThreadStopped,
    clearDeferredForOwner: coordinator.clearDeferredForOwner,
  };
}
