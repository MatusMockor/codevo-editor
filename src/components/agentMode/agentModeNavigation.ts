import type { AgentThreadView } from "../../application/agentThreadPorts";
import { agentRailSections, type AgentRailScope } from "./agentSidebarPresentation";

export function agentThreadsInScope(
  views: ReadonlyArray<AgentThreadView>,
  scope: AgentRailScope,
): ReadonlyArray<AgentThreadView> {
  if (scope.kind === "all") return views;
  return views.filter((view) => view.thread.owner.repositoryRoot === scope.repositoryRoot);
}

export function orderedRailThreadIds(
  views: ReadonlyArray<AgentThreadView>,
  scope: AgentRailScope,
): ReadonlyArray<string> {
  const sections = agentRailSections(views, scope, false, 0);
  return [...sections.pinned, ...sections.active].map((view) => view.thread.threadId);
}

export function adjacentThreadId(
  ordered: ReadonlyArray<string>,
  current: string | null,
  step: 1 | -1,
): string | null {
  if (ordered.length === 0) return null;
  const index = current === null ? -1 : ordered.indexOf(current);
  if (index === -1)
    return step === 1 ? (ordered[0] ?? null) : (ordered[ordered.length - 1] ?? null);
  return ordered[(index + step + ordered.length) % ordered.length] ?? null;
}
