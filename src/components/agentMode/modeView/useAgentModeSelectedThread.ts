import { useLayoutEffect, useMemo } from "react";
import type { AgentThreadView } from "../../../application/agentThreadPorts";
import { useAgentTurnLogFacts } from "../../../application/agentTurnLogStatusStore";
import { useAgentResumeCompactionOffer } from "../../../application/useAgentResumeCompactionOffer";
import type { AgentProjectDescriptor } from "../../../domain/agentProject";
import type { AgentCliKind } from "../../../domain/agentTask";
import { parseRemoteAgentThreadIdentity } from "../../../domain/remoteAgentIdentity";
import { remoteThreadSelectionBlocksComposer } from "../../../domain/remoteThreadSelection";
import { agentThreadCheckoutRoot } from "../agentSurfacePolicy";
import type { AgentWorkbenchChrome } from "../agentWorkbenchChrome";
import { useAgentPendingInteractionObservations } from "../useAgentPendingInteractionObservations";
import {
  useAgentRailWorkingPendingInteractions,
  type useAgentRailWorkingRail,
} from "../useAgentRailWorkingRail";
import { useAgentSurfacePresentationView } from "../useAgentThreadPresentationViews";
import { REMOTE_PROVIDERS_ENABLED, type AgentModeAgents } from "./agentModeViewProps";
import {
  useAgentModeRemoteThreadSelection,
  type AgentModeRemoteInventory,
} from "./useAgentModeRemoteThreadSelection";

export interface AgentModeSelectedThreadOptions {
  readonly agents: AgentModeAgents;
  readonly chrome: AgentWorkbenchChrome;
  readonly sessionThread: AgentThreadView | null;
  readonly selectedThreadId: string | null;
  readonly presentationThreads: ReadonlyArray<AgentThreadView>;
  readonly workingRail: ReturnType<typeof useAgentRailWorkingRail>;
  readonly selectedServerId: string | null;
  readonly providerEnabled: Readonly<Record<AgentCliKind, boolean>>;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly remoteInventory: AgentModeRemoteInventory;
  onSelectedThreadChange(threadId: string | null): void;
}

export function useAgentModeSelectedThread({
  agents,
  chrome,
  sessionThread,
  selectedThreadId,
  presentationThreads,
  workingRail,
  selectedServerId,
  providerEnabled,
  projects,
  remoteInventory,
  onSelectedThreadChange,
}: AgentModeSelectedThreadOptions) {
  const contextThread = sessionThread?.thread ?? null;
  const contextTurnId = contextThread?.turns[contextThread.turns.length - 1]?.turnId ?? null;
  const contextFacts = useAgentTurnLogFacts(agents.turnLog ?? null, contextTurnId);
  const loggedContextWindow = contextFacts?.contextWindow ?? null;
  const compactionOffer = useAgentResumeCompactionOffer(contextThread, loggedContextWindow);
  useLayoutEffect(
    () => onSelectedThreadChange(selectedThreadId),
    [onSelectedThreadChange, selectedThreadId],
  );
  const bindLayoutThread = chrome.layout.bindThread;
  useLayoutEffect(() => {
    bindLayoutThread?.(selectedThreadId);
  }, [bindLayoutThread, selectedThreadId]);
  const selectedThread =
    selectedThreadId === null
      ? null
      : (presentationThreads.find((view) => view.thread.threadId === selectedThreadId) ?? null);
  const pendingObservations = useAgentPendingInteractionObservations(
    agents.threads,
    selectedThread?.thread.threadId ?? null,
  );
  const pendingInteractions = pendingObservations.pending;
  useAgentRailWorkingPendingInteractions(workingRail, pendingInteractions);
  const pendingRemoteIdentity =
    selectedThread === null ? parseRemoteAgentThreadIdentity(selectedThreadId) : null;
  const remoteThreadSelection = useAgentModeRemoteThreadSelection(
    selectedThreadId,
    selectedThread !== null,
    remoteInventory,
  );
  const resolvingRemoteThread = remoteThreadSelectionBlocksComposer(remoteThreadSelection);
  const effectiveProviderEnabled =
    selectedThread?.execution?.kind === "remote" ||
    (selectedThread === null && selectedServerId !== null)
      ? REMOTE_PROVIDERS_ENABLED
      : providerEnabled;
  const surfaceThread = useAgentSurfacePresentationView(selectedThread);
  const surfaceThreadRootPath = useMemo(
    () => (surfaceThread === null ? null : agentThreadCheckoutRoot(surfaceThread, projects)),
    [projects, surfaceThread],
  );
  return {
    compactionOffer,
    selectedThread,
    pendingObservations,
    pendingInteractions,
    pendingRemoteIdentity,
    remoteThreadSelection,
    resolvingRemoteThread,
    effectiveProviderEnabled,
    surfaceThread,
    surfaceThreadRootPath,
  };
}

export type AgentModeSelectedThread = ReturnType<typeof useAgentModeSelectedThread>;
