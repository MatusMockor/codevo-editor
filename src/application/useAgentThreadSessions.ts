import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { agentProjectOwnsOwner, type AgentProjectDescriptor } from "../domain/agentProject";
import type { AgentThread, AgentThreadsState } from "../domain/agentThread";
import type { AgentThreadSessionGateway } from "../domain/agentThreadSession";
import {
  recoverEvictedAgentThread,
  type AgentEvictedThreadPort,
  type AgentRecoveryProject,
} from "./agentEvictedThreadRecovery";
import type {
  AgentSessionEndResult,
  AgentTasksNotice,
  AgentThreadStoreSurface,
} from "./agentThreadPorts";
import {
  useAgentThreadSessionLifecycle,
  type AgentThreadSessionLifecycle,
  type AgentThreadSessionLifecycleOptions,
} from "./useAgentThreadSessionLifecycle";
import type { AgentHistoryCatalogGateway } from "./useAgentHistoryCatalog";

export interface AgentThreadSessionDispatchPorts {
  resumeSessionIdFor(thread: AgentThread): string | null;
  mintUnreservedTurnId(): string | null;
}

export interface AgentThreadSessionsOptions {
  readonly gateway: AgentThreadSessionGateway | undefined;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly store: Pick<
    AgentThreadStoreSurface,
    "currentState" | "dispatchAction" | "restoreThread"
  >;
  readonly historyCatalog: AgentHistoryCatalogGateway | undefined;
  readonly dispatch: { readonly current: AgentThreadSessionDispatchPorts | null };
  readonly setNotice: (notice: AgentTasksNotice) => void;
  readonly reportError: (source: string, error: unknown) => void;
  readonly now: (() => number) | undefined;
  readonly watchSession?: AgentThreadSessionLifecycleOptions["watchSession"];
}

export interface AgentThreadSessions extends Pick<
  AgentThreadSessionLifecycle,
  "interrupt" | "inspectRestart" | "inspectBackground" | "stopBackgroundTask"
> {
  endSession(threadId: string): Promise<AgentSessionEndResult>;
  endThreadSession(thread: AgentThread): void;
}

export function useAgentThreadSessions(options: AgentThreadSessionsOptions): AgentThreadSessions {
  const { projects, store, dispatch } = options;
  const evictedThreads = useEvictedThreadRecovery(options);
  const lifecycle = useAgentThreadSessionLifecycle({
    gateway: options.gateway,
    readThread: (threadId) => ownedThread(projects, store.currentState(), threadId),
    recordHaltRequest: (request) => store.dispatchAction({ kind: "turnHaltRequested", ...request }),
    ownsOwner: (owner) => projects.some((project) => agentProjectOwnsOwner(project, owner)),
    resumeSessionId: (thread) => dispatch.current?.resumeSessionIdFor(thread) ?? null,
    setNotice: options.setNotice,
    reportError: options.reportError,
    backgroundTurns: {
      mintTurnId: () => dispatch.current?.mintUnreservedTurnId() ?? null,
      dispatch: store.dispatchAction,
      now: () => (options.now ?? Date.now)(),
    },
    evictedThreads,
    watchSession: options.watchSession,
  });
  const {
    endSession: endLifecycleSession,
    interrupt,
    inspectRestart,
    inspectBackground,
    stopBackgroundTask,
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
    () => ({
      interrupt,
      inspectRestart,
      inspectBackground,
      stopBackgroundTask,
      endSession,
      endThreadSession,
    }),
    [
      endSession,
      endThreadSession,
      inspectBackground,
      inspectRestart,
      interrupt,
      stopBackgroundTask,
    ],
  );
}

function useEvictedThreadRecovery(options: AgentThreadSessionsOptions): AgentEvictedThreadPort {
  const optionsRef = useRef(options);
  useLayoutEffect(() => {
    optionsRef.current = options;
  });
  return useMemo(
    () => ({
      rootKeyOf: (workspaceId) =>
        workspaceProject(optionsRef.current.projects, workspaceId)?.rootKey ?? null,
      recover: (threadId, workspaceId) =>
        recoverEvictedAgentThread(
          {
            catalog: optionsRef.current.historyCatalog,
            project: (candidate) => workspaceProject(optionsRef.current.projects, candidate),
            restoreThread: (thread) =>
              optionsRef.current.store.restoreThread?.(thread) ?? Promise.resolve(false),
            reportError: (source, error) => optionsRef.current.reportError(source, error),
          },
          threadId,
          workspaceId,
        ),
    }),
    [],
  );
}

function workspaceProject(
  projects: ReadonlyArray<AgentProjectDescriptor>,
  workspaceId: string,
): AgentRecoveryProject | undefined {
  return projects.find((project) => project.ownerId === workspaceId);
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
