import { useCallback, useMemo } from "react";
import { agentProjectOwnsOwner, type AgentProjectDescriptor } from "../domain/agentProject";
import type { AgentThread, AgentThreadsState } from "../domain/agentThread";
import type { AgentThreadSessionGateway } from "../domain/agentThreadSession";
import type {
  AgentSessionEndResult,
  AgentTasksNotice,
  AgentThreadStoreSurface,
} from "./agentThreadPorts";
import {
  useAgentThreadSessionLifecycle,
  type AgentThreadSessionLifecycle,
} from "./useAgentThreadSessionLifecycle";

export interface AgentThreadSessionDispatchPorts {
  resumeSessionIdFor(thread: AgentThread): string | null;
  mintUnreservedTurnId(): string | null;
}

export interface AgentThreadSessionsOptions {
  readonly gateway: AgentThreadSessionGateway | undefined;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly store: Pick<AgentThreadStoreSurface, "currentState" | "dispatchAction">;
  readonly stateRevision: unknown;
  readonly dispatch: { readonly current: AgentThreadSessionDispatchPorts | null };
  readonly setNotice: (notice: AgentTasksNotice) => void;
  readonly reportError: (source: string, error: unknown) => void;
  readonly now: (() => number) | undefined;
}

export interface AgentThreadSessions extends Pick<
  AgentThreadSessionLifecycle,
  "interrupt" | "inspectRestart" | "inspectBackground"
> {
  endSession(threadId: string): Promise<AgentSessionEndResult>;
  endThreadSession(thread: AgentThread): void;
}

export function useAgentThreadSessions(options: AgentThreadSessionsOptions): AgentThreadSessions {
  const { projects, store, dispatch } = options;
  const lifecycle = useAgentThreadSessionLifecycle({
    gateway: options.gateway,
    readThread: (threadId) => ownedThread(projects, store.currentState(), threadId),
    ownsOwner: (owner) => projects.some((project) => agentProjectOwnsOwner(project, owner)),
    resumeSessionId: (thread) => dispatch.current?.resumeSessionIdFor(thread) ?? null,
    setNotice: options.setNotice,
    reportError: options.reportError,
    stateRevision: options.stateRevision,
    backgroundTurns: {
      mintTurnId: () => dispatch.current?.mintUnreservedTurnId() ?? null,
      dispatch: store.dispatchAction,
      now: () => (options.now ?? Date.now)(),
    },
  });
  const {
    endSession: endLifecycleSession,
    interrupt,
    inspectRestart,
    inspectBackground,
  } = lifecycle;
  const endSession = useCallback(
    async (threadId: string): Promise<AgentSessionEndResult> => {
      const thread = ownedThread(projects, store.currentState(), threadId);
      if (thread === undefined) return "none";
      return endLifecycleSession(thread);
    },
    [endLifecycleSession, projects, store],
  );
  const endThreadSession = useCallback(
    (thread: AgentThread): void => void endLifecycleSession(thread),
    [endLifecycleSession],
  );
  return useMemo(
    () => ({ interrupt, inspectRestart, inspectBackground, endSession, endThreadSession }),
    [endSession, endThreadSession, inspectBackground, inspectRestart, interrupt],
  );
}

function ownedThread(
  projects: ReadonlyArray<AgentProjectDescriptor>,
  state: AgentThreadsState,
  threadId: string,
): AgentThread | undefined {
  const thread = state.threads.get(threadId);
  if (thread === undefined) return undefined;
  if (!projects.some((project) => agentProjectOwnsOwner(project, thread.owner))) return undefined;
  return thread;
}
