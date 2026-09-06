import { useCallback, useLayoutEffect, useRef } from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { ComposerScope, ComposerSelection, ComposerTarget } from "./agentComposerTarget";

export function useAgentComposerRepositoryInteraction(
  project: AgentProjectDescriptor | null,
  target: ComposerTarget | null,
  scope: ComposerScope | null,
  selection: ComposerSelection | null,
  thread: AgentThreadView | null,
): () => boolean {
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const identity = [
    project?.rootKey,
    project?.ownerId,
    project?.generation,
    project?.trust,
    target?.projectRootKey,
    target?.repositoryRoot,
    scope?.kind,
    scope?.projectRootKey,
    scope?.repositoryRoot,
    scope !== null && scope.kind !== "missing" ? scope.ownerId : null,
    scope !== null && scope.kind !== "missing" ? scope.generation : null,
    selection?.kind,
    selection?.projectRootKey,
    selection?.repositoryRoot,
    selection?.kind === "bound" ? selection.ownerId : null,
    selection?.kind === "bound" ? selection.generation : null,
    thread?.thread.threadId,
    thread?.thread.owner.rootKey,
    thread?.thread.owner.ownerId,
    thread?.thread.owner.repositoryRoot,
  ];
  const current = useRef(identity);
  if (identity.some((value, index) => value !== current.current[index])) {
    current.current = identity;
  }
  const captured = current.current;
  return useCallback(
    () => mounted.current && thread === null && current.current === captured,
    [captured, thread],
  );
}
