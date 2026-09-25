import { useCallback, useEffect, useMemo, useRef } from "react";
import { normalizeLastCloneParentPath } from "../../domain/projectOnboardingSettings";
import {
  isEligibleWorkspaceRoot,
  UNKNOWN_WORKSPACE_HOME,
  type WorkspaceHomeReference,
} from "../../domain/workspaceRootEligibility";
import type { AgentCloneDestinationPreference } from "./agentWorkbenchChrome";

export type AgentCloneDestinationPreferenceInput = Readonly<{
  lastParentPath: string | null;
  save(parentPath: string): Promise<void>;
  resolveHome(): Promise<WorkspaceHomeReference>;
}>;

export function useAgentCloneDestinationPreference(
  input: AgentCloneDestinationPreferenceInput,
): AgentCloneDestinationPreference {
  const { lastParentPath, save, resolveHome } = input;
  const saved = useRef<{ readonly source: string | null; value: string | null }>({
    source: lastParentPath,
    value: lastParentPath,
  });
  if (saved.current.source !== lastParentPath)
    saved.current = { source: lastParentPath, value: lastParentPath };
  const request = useRef(0);
  return useMemo(() => {
    const visible = normalizeLastCloneParentPath(lastParentPath);
    return {
      lastParentPath:
        visible !== null && isEligibleWorkspaceRoot(visible, UNKNOWN_WORKSPACE_HOME)
          ? visible
          : null,
      remember(parentPath: string) {
        const normalized = normalizeLastCloneParentPath(parentPath);
        if (normalized === null || normalized === saved.current.value) return;
        const generation = ++request.current;
        const current = saved.current;
        void resolveHome()
          .then((home) => {
            if (generation !== request.current || saved.current !== current) return;
            if (home.path === null || !isEligibleWorkspaceRoot(normalized, home)) return;
            if (normalized === current.value) return;
            const previous = current.value;
            current.value = normalized;
            return save(normalized).catch(() => {
              if (current.value === normalized) current.value = previous;
            });
          })
          .catch(() => undefined);
      },
    };
  }, [lastParentPath, resolveHome, save]);
}

export type CloneCompletionObservation = Readonly<{
  id: string;
  name: string;
  environment?: string;
  status: string;
}>;

type StagedCloneParent = Readonly<{
  name: string;
  parentPath: string;
  knownIds: ReadonlySet<string>;
}>;

export function useRememberCloneParentOnCompletion(
  clones: readonly CloneCompletionObservation[],
  preference: AgentCloneDestinationPreference | undefined,
): (name: string, parentPath: string) => void {
  const staged = useRef<StagedCloneParent | null>(null);
  const latestClones = useRef(clones);
  useEffect(() => {
    latestClones.current = clones;
    const current = staged.current;
    if (current === null) return;
    const started = clones.find(
      (clone) =>
        clone.environment === "local" &&
        clone.name === current.name &&
        !current.knownIds.has(clone.id),
    );
    if (started === undefined) return;
    if (started.status === "running" || started.status === "queued") return;
    staged.current = null;
    if (started.status === "succeeded") preference?.remember(current.parentPath);
  }, [clones, preference]);
  return useCallback((name: string, parentPath: string) => {
    staged.current = {
      name,
      parentPath,
      knownIds: new Set(latestClones.current.map((clone) => clone.id)),
    };
  }, []);
}
