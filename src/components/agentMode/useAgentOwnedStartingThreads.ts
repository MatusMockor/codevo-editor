import { useMemo, useRef } from "react";
import { projectHoldsAuthority } from "../../application/agentProjectAuthority";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { NO_AGENT_STARTING_THREADS, type AgentStartingThread } from "./agentStartingThreads";

export function agentOwnedStartingThreads(
  threads: ReadonlyArray<AgentStartingThread>,
  projects: ReadonlyArray<AgentProjectDescriptor>,
  previous: ReadonlyArray<AgentStartingThread> = NO_AGENT_STARTING_THREADS,
): ReadonlyArray<AgentStartingThread> {
  if (threads.length === 0) return NO_AGENT_STARTING_THREADS;
  const owned = threads.filter((thread) => startingThreadOwnerHolds(thread, projects));
  if (owned.length === 0) return NO_AGENT_STARTING_THREADS;
  if (owned.length === threads.length) return threads;
  if (sameThreads(previous, owned)) return previous;
  return owned;
}

export function useAgentOwnedStartingThreads(
  threads: ReadonlyArray<AgentStartingThread>,
  projects: ReadonlyArray<AgentProjectDescriptor>,
): ReadonlyArray<AgentStartingThread> {
  const previous = useRef(NO_AGENT_STARTING_THREADS);
  const owned = useMemo(
    () => agentOwnedStartingThreads(threads, projects, previous.current),
    [projects, threads],
  );
  previous.current = owned;
  return owned;
}

function startingThreadOwnerHolds(
  thread: AgentStartingThread,
  projects: ReadonlyArray<AgentProjectDescriptor>,
): boolean {
  const owner = thread.owner;
  if (owner === null) return false;
  const authority = {
    rootKey: thread.projectRootKey,
    ownerId: owner.ownerId,
    generation: owner.generation,
  };
  return projects.some((project) => projectHoldsAuthority(project, authority));
}

function sameThreads(
  left: ReadonlyArray<AgentStartingThread>,
  right: ReadonlyArray<AgentStartingThread>,
): boolean {
  return left.length === right.length && right.every((thread, index) => thread === left[index]);
}
