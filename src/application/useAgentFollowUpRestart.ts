import { useCallback } from "react";
import type { AgentLaunchOptions } from "../domain/agentLaunch";
import type { AgentThread } from "../domain/agentThread";
import { AGENT_TASKS_SOURCE, attempt } from "./agentProjectAuthority";
import type { FollowUpRestartRefusals } from "./agentSessionRestartConsent";
import type {
  AgentFollowUpRequest,
  AgentFollowUpRestartConsent,
  AgentSessionRestartVerdict,
  AgentTasksNotice,
  AgentThreadStoreSurface,
} from "./agentThreadPorts";

export type AgentSessionRestartInspector = (
  threadId: string,
  launch: AgentLaunchOptions,
) => Promise<AgentSessionRestartVerdict>;

export interface AgentFollowUpRestartDependencies {
  readonly store: Pick<AgentThreadStoreSurface, "currentState">;
  readonly setNotice: (notice: AgentTasksNotice | null) => void;
  readonly reportError: (source: string, error: unknown) => void;
  readonly inspectSessionRestart?: AgentSessionRestartInspector;
}

export interface AgentFollowUpRestartOptions {
  readonly dependenciesRef: { readonly current: AgentFollowUpRestartDependencies };
  readonly refusals: FollowUpRestartRefusals;
  readonly sendFollowUp: (request: AgentFollowUpRequest) => Promise<boolean>;
  readonly restartDeferredFollowUp: (threadId: string, id: string) => Promise<void>;
}

export interface AgentFollowUpRestartSurface {
  sendFollowUp(
    request: AgentFollowUpRequest,
    restartConsent?: AgentFollowUpRestartConsent,
  ): Promise<boolean>;
  restartDeferredFollowUp(threadId: string, id: string): Promise<void>;
}

export async function inspectFollowUpRestart(
  deps: AgentFollowUpRestartDependencies,
  thread: AgentThread,
  request: AgentFollowUpRequest,
): Promise<AgentSessionRestartVerdict> {
  const inspect = deps.inspectSessionRestart;
  if (inspect === undefined || request.sessionRestart !== undefined) return "proceed";
  if (thread.provider.kind !== "claudeCode") return "proceed";
  const inspected = await attempt(() => inspect(thread.threadId, request.launch));
  if (inspected.ok) return inspected.value;
  deps.reportError(AGENT_TASKS_SOURCE, inspected.error);
  return "proceed";
}

export function refuseFollowUpBeforeStart(
  deps: AgentFollowUpRestartDependencies,
  refusals: FollowUpRestartRefusals,
  threadId: string,
): void {
  const thread = deps.store.currentState().threads.get(threadId);
  if (thread === undefined) return;
  refusals.refuseBeforeStart(thread);
}

export function useAgentFollowUpRestart(
  options: AgentFollowUpRestartOptions,
): AgentFollowUpRestartSurface {
  const { dependenciesRef, refusals, sendFollowUp, restartDeferredFollowUp } = options;

  const sendFollowUpOrOfferRestart = useCallback(
    async (
      request: AgentFollowUpRequest,
      restartConsent: AgentFollowUpRestartConsent = "notice",
    ): Promise<boolean> => {
      if (await sendFollowUp(request)) return true;
      if (restartConsent === "caller") return false;
      const deps = dependenciesRef.current;
      const thread = deps.store.currentState().threads.get(request.threadId);
      const notice = refusals.offer(thread, request);
      if (notice !== null) deps.setNotice(notice);
      return false;
    },
    [dependenciesRef, refusals, sendFollowUp],
  );

  const restartRefusedFollowUp = useCallback(
    async (threadId: string, id: string): Promise<void> => {
      const thread = dependenciesRef.current.store.currentState().threads.get(threadId);
      const request = refusals.take(thread, id);
      if (request === null) return restartDeferredFollowUp(threadId, id);
      await sendFollowUpOrOfferRestart({ ...request, sessionRestart: "stopBackground" });
    },
    [dependenciesRef, refusals, restartDeferredFollowUp, sendFollowUpOrOfferRestart],
  );

  return {
    sendFollowUp: sendFollowUpOrOfferRestart,
    restartDeferredFollowUp: restartRefusedFollowUp,
  };
}
