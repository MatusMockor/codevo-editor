import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { AgentSessionBackground } from "../../../domain/agentSessionBackground";
import type { AgentCliKind } from "../../../domain/agentTask";
import type { AgentAgentsPanelGroup } from "../agentAgentsPanelPresentation";
import type { AgentSessionTaskControls } from "../conversation/agentSessionTaskControls";
import type { AgentRunningWorkSurface } from "./agentAgentsPanelHooks";
import {
  agentRunningStopPolicy,
  agentRunningWork,
  reuseAgentRunningWork,
  type AgentLiveBackground,
  type AgentRunningWork,
} from "./agentRunningWork";

export interface AgentRunningWorkInput {
  readonly threadId: string;
  readonly provider: AgentCliKind;
  readonly remote: boolean;
  readonly groups: ReadonlyArray<AgentAgentsPanelGroup>;
  readonly session: AgentSessionBackground | null;
  readonly live: AgentLiveBackground | null;
  readonly controls: AgentSessionTaskControls | null;
  readonly onStopSessionTask: ((threadId: string, taskId: string) => void) | undefined;
}

export function useAgentRunningWork({
  controls,
  groups,
  live,
  onStopSessionTask,
  provider,
  remote,
  session,
  threadId,
}: AgentRunningWorkInput): AgentRunningWorkSurface {
  const pendingTaskIds =
    onStopSessionTask === undefined ? null : (controls?.pendingTaskIds ?? null);
  const stop = useMemo(
    () => agentRunningStopPolicy({ remote, pendingTaskIds }),
    [pendingTaskIds, remote],
  );
  const previousWork = useRef<AgentRunningWork | null>(null);
  const work = useMemo(
    () =>
      reuseAgentRunningWork(
        previousWork.current,
        agentRunningWork({ provider, groups, session, live, stop }),
      ),
    [groups, live, provider, session, stop],
  );
  useLayoutEffect(() => {
    previousWork.current = work;
  }, [work]);
  const stopTask = useCallback(
    (taskId: string): void => onStopSessionTask?.(threadId, taskId),
    [onStopSessionTask, threadId],
  );
  return useMemo(() => ({ threadId, work, stopTask }), [stopTask, threadId, work]);
}
