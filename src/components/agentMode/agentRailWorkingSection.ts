import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentPendingInteraction } from "../../domain/agentPendingInteraction";
import {
  WORKING_SECTION_OFF,
  type AgentRailWorkingSection,
} from "../../domain/agentRailWorkingSection";
import { compareAgentThreadOrder } from "../../domain/agentThreadOrganization";
import { NO_AGENT_TURN_LOG_EVIDENCE } from "../../domain/agentTurnContentLoss";
import type { AgentRailScopeEntry, AgentRailSections } from "./agentSidebarPresentation";
import {
  agentRowBelongsInWorkingSection,
  agentRowStatus,
  agentRowWorkingAgents,
  type AgentRowStatus,
} from "./agentThreadRowStatus";

export type AgentRailStatusLookup = (view: AgentThreadView) => AgentRowStatus;

export type AgentRailWorkingDisclosure = "collapsed" | "expanded";

export const DEFAULT_AGENT_RAIL_WORKING_DISCLOSURE: AgentRailWorkingDisclosure = "collapsed";

export interface AgentRailWorkingSections extends AgentRailSections {
  readonly working: ReadonlyArray<AgentThreadView>;
}

export interface AgentRailWorkingSplit {
  readonly workingSection: AgentRailWorkingSection;
  readonly disclosure: AgentRailWorkingDisclosure;
  readonly statusOf: AgentRailStatusLookup;
  now(): number;
}

export interface AgentRailWorkingShelf {
  readonly threads: ReadonlyArray<AgentThreadView>;
  readonly rows: ReadonlyArray<AgentThreadView>;
  readonly disclosure: AgentRailWorkingDisclosure;
}

const NO_WORKING_THREADS: ReadonlyArray<AgentThreadView> = Object.freeze([]);

export const NO_AGENT_RAIL_WORKING_SPLIT: AgentRailWorkingSplit = Object.freeze({
  workingSection: WORKING_SECTION_OFF,
  disclosure: DEFAULT_AGENT_RAIL_WORKING_DISCLOSURE,
  statusOf: (): AgentRowStatus => ({ kind: "none" }),
  now: () => Date.now(),
});

export const NO_AGENT_RAIL_WORKING_SHELF: AgentRailWorkingShelf = Object.freeze({
  threads: NO_WORKING_THREADS,
  rows: NO_WORKING_THREADS,
  disclosure: DEFAULT_AGENT_RAIL_WORKING_DISCLOSURE,
});

export function agentRailRowStatus(
  view: AgentThreadView,
  pendingInteractions: ReadonlyMap<string, AgentPendingInteraction>,
): AgentRowStatus {
  return agentRowStatus(view, NO_AGENT_TURN_LOG_EVIDENCE, null, {
    pending: pendingInteractions.get(view.thread.threadId) ?? null,
    workingAgents: agentRowWorkingAgents(view),
  });
}

export function agentRailStatusLookup(
  pendingInteractions: ReadonlyMap<string, AgentPendingInteraction>,
): AgentRailStatusLookup {
  return (view) => agentRailRowStatus(view, pendingInteractions);
}

export function agentRailWorkingSections(
  sections: AgentRailSections,
  statusOf: AgentRailStatusLookup,
  workingSection: AgentRailWorkingSection,
): AgentRailWorkingSections {
  switch (workingSection) {
    case "off":
      return { ...sections, working: NO_WORKING_THREADS };
    case "on":
      return splitWorkingThreads(sections, statusOf);
    default:
      return unsupportedWorkingSection(workingSection);
  }
}

export function agentRailWorkingThreads(
  sections: AgentRailSections | AgentRailWorkingSections,
): ReadonlyArray<AgentThreadView> {
  if ("working" in sections) return sections.working;
  return NO_WORKING_THREADS;
}

export function agentRailWorkingCountByProject(
  working: ReadonlyArray<AgentThreadView>,
  owners: ReadonlyMap<string, AgentRailScopeEntry>,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const view of working) {
    const owner = owners.get(view.thread.owner.rootKey);
    if (owner === undefined) continue;
    counts.set(owner.projectRootKey, (counts.get(owner.projectRootKey) ?? 0) + 1);
  }
  return counts;
}

export function agentRailWorkingVisibleRows(
  working: ReadonlyArray<AgentThreadView>,
  disclosure: AgentRailWorkingDisclosure,
  selectedThreadId: string | null,
): ReadonlyArray<AgentThreadView> {
  switch (disclosure) {
    case "expanded":
      return working;
    case "collapsed":
      return working.filter((view) => view.thread.threadId === selectedThreadId);
    default:
      return unsupportedWorkingDisclosure(disclosure);
  }
}

export function agentRailWorkingShelf(
  working: ReadonlyArray<AgentThreadView>,
  disclosure: AgentRailWorkingDisclosure,
  selectedThreadId: string | null,
): AgentRailWorkingShelf {
  if (working.length === 0) return NO_AGENT_RAIL_WORKING_SHELF;
  return {
    threads: working,
    rows: agentRailWorkingVisibleRows(working, disclosure, selectedThreadId),
    disclosure,
  };
}

export function agentRailToggledWorkingDisclosure(
  disclosure: AgentRailWorkingDisclosure,
): AgentRailWorkingDisclosure {
  switch (disclosure) {
    case "collapsed":
      return "expanded";
    case "expanded":
      return "collapsed";
    default:
      return unsupportedWorkingDisclosure(disclosure);
  }
}

export function agentRailProjectEmptyLabel(working: number, shelved: number): string {
  if (working === 1) return "1 thread in Working";
  if (working > 1) return `${working} threads in Working`;
  if (shelved > 0) return "No active threads";
  return "No threads yet";
}

function splitWorkingThreads(
  sections: AgentRailSections,
  statusOf: AgentRailStatusLookup,
): AgentRailWorkingSections {
  const active: AgentThreadView[] = [];
  const working: AgentThreadView[] = [];
  for (const view of sections.active) {
    const destination = belongsInWorkingSection(view, statusOf) ? working : active;
    destination.push(view);
  }
  if (working.length === 0) return { ...sections, working: NO_WORKING_THREADS };
  working.sort(compareManualOrder);
  return { ...sections, active, working };
}

function belongsInWorkingSection(view: AgentThreadView, statusOf: AgentRailStatusLookup): boolean {
  if (view.thread.pinned) return false;
  return agentRowBelongsInWorkingSection(statusOf(view));
}

function compareManualOrder(left: AgentThreadView, right: AgentThreadView): number {
  return compareAgentThreadOrder(left.thread, right.thread);
}

function unsupportedWorkingSection(workingSection: never): never {
  throw new TypeError(`Unsupported agent rail working section: ${String(workingSection)}.`);
}

function unsupportedWorkingDisclosure(disclosure: never): never {
  throw new TypeError(`Unsupported agent rail working disclosure: ${String(disclosure)}.`);
}
