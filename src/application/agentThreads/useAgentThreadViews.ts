import { useMemo, useRef } from "react";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { AgentSessionBackgrounds } from "../../domain/agentSessionBackground";
import type { AgentShipState } from "../../domain/agentShip";
import type { AgentThread } from "../../domain/agentThread";
import type { AgentTaskChangeSummary, AgentThreadView } from "../agentThreadPorts";
import { agentThreadViews } from "../agentThreadViewProjection";
import type { AgentFileNavigationSurface } from "../useAgentFileNavigation";

export interface AgentThreadViewsInput {
  readonly threads: ReadonlyMap<string, AgentThread>;
  readonly summaries: ReadonlyMap<string, AgentTaskChangeSummary>;
  readonly removedWorktreeThreadIds: ReadonlySet<string>;
  readonly missingWorktreeThreadIds: ReadonlySet<string>;
  readonly shipStates: ReadonlyMap<string, AgentShipState>;
  readonly editor: AgentFileNavigationSurface;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly sessionBackgrounds: AgentSessionBackgrounds;
}

export function useAgentThreadViews({
  threads,
  summaries,
  removedWorktreeThreadIds,
  missingWorktreeThreadIds,
  shipStates,
  editor,
  projects,
  sessionBackgrounds,
}: AgentThreadViewsInput): ReadonlyArray<AgentThreadView> {
  const viewCacheRef = useRef<ReadonlyMap<string, AgentThreadView>>(new Map());
  return useMemo(() => {
    const views = agentThreadViews(
      viewCacheRef.current,
      threads,
      summaries,
      removedWorktreeThreadIds,
      missingWorktreeThreadIds,
      shipStates,
      editor,
      projects,
      sessionBackgrounds,
    );
    viewCacheRef.current = new Map(views.map((view) => [view.thread.threadId, view]));
    return views;
  }, [
    editor,
    missingWorktreeThreadIds,
    projects,
    removedWorktreeThreadIds,
    sessionBackgrounds,
    shipStates,
    summaries,
    threads,
  ]);
}
