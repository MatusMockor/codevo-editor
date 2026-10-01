import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  agentRailSections,
  type AgentRailScopeEntry,
  type AgentRailSections,
} from "./agentSidebarPresentation";

export const AGENT_RAIL_PROJECT_PREVIEW_COUNT = 6;

export interface AgentRailProjectDisclosureState {
  readonly collapsed: ReadonlySet<string>;
  readonly showingAll: ReadonlySet<string>;
}

export const ALL_PROJECTS_EXPANDED: AgentRailProjectDisclosureState = Object.freeze({
  collapsed: new Set<string>(),
  showingAll: new Set<string>(),
});

export type AgentRailProjectOverflow =
  | { readonly kind: "none" }
  | { readonly kind: "more"; readonly hidden: number }
  | { readonly kind: "less" };

export interface AgentRailProjectSection {
  readonly entry: AgentRailScopeEntry;
  readonly collapsed: boolean;
  readonly threads: ReadonlyArray<AgentThreadView>;
  readonly rows: ReadonlyArray<AgentThreadView>;
  readonly overflow: AgentRailProjectOverflow;
  readonly shelved: number;
}

const NO_OVERFLOW: AgentRailProjectOverflow = Object.freeze({ kind: "none" });

export function agentRailOwnerIndex(
  entries: ReadonlyArray<AgentRailScopeEntry>,
): ReadonlyMap<string, AgentRailScopeEntry> {
  const index = new Map<string, AgentRailScopeEntry>();
  for (const entry of entries) {
    if (!index.has(entry.projectRootKey)) index.set(entry.projectRootKey, entry);
    for (const member of entry.memberProjectRootKeys ?? []) {
      if (!index.has(member)) index.set(member, entry);
    }
  }
  return index;
}

export function agentRailOwnedViews(
  views: ReadonlyArray<AgentThreadView>,
  entries: ReadonlyArray<AgentRailScopeEntry>,
): ReadonlyArray<AgentThreadView> {
  const owners = agentRailOwnerIndex(entries);
  return views.filter((view) => owners.has(view.thread.owner.rootKey));
}

export function agentRailProjectSections(
  sections: AgentRailSections,
  entries: ReadonlyArray<AgentRailScopeEntry>,
  disclosure: AgentRailProjectDisclosureState,
  selectedThreadId: string | null,
): ReadonlyArray<AgentRailProjectSection> {
  const owners = agentRailOwnerIndex(entries);
  const byProject = groupByProject(sections.active, owners);
  const shelved = groupByProject(
    [...sections.pinned, ...(sections.snoozed ?? []), ...(sections.settled ?? [])],
    owners,
  );
  return entries.map((entry) => ({
    ...projectSection(
      entry,
      byProject.get(entry.projectRootKey) ?? [],
      disclosure,
      selectedThreadId,
    ),
    shelved: shelved.get(entry.projectRootKey)?.length ?? 0,
  }));
}

export function agentRailVisibleThreadOrder(
  pinned: ReadonlyArray<AgentThreadView>,
  projects: ReadonlyArray<AgentRailProjectSection>,
): ReadonlyArray<string> {
  return [...pinned, ...projects.flatMap((project) => project.rows)].map(
    (view) => view.thread.threadId,
  );
}

export function agentRailThreadOrder(
  views: ReadonlyArray<AgentThreadView>,
  entries: ReadonlyArray<AgentRailScopeEntry>,
  disclosure: AgentRailProjectDisclosureState,
  selectedThreadId: string | null,
  now: number = Date.now(),
): ReadonlyArray<string> {
  const sections = agentRailSections(agentRailOwnedViews(views, entries), now);
  const projects = agentRailProjectSections(sections, entries, disclosure, selectedThreadId);
  return agentRailVisibleThreadOrder(sections.pinned, projects);
}

function groupByProject(
  views: ReadonlyArray<AgentThreadView>,
  owners: ReadonlyMap<string, AgentRailScopeEntry>,
): ReadonlyMap<string, ReadonlyArray<AgentThreadView>> {
  const byProject = new Map<string, AgentThreadView[]>();
  for (const view of views) {
    const owner = owners.get(view.thread.owner.rootKey);
    if (owner === undefined) continue;
    const threads = byProject.get(owner.projectRootKey) ?? [];
    threads.push(view);
    byProject.set(owner.projectRootKey, threads);
  }
  return byProject;
}

function projectSection(
  entry: AgentRailScopeEntry,
  threads: ReadonlyArray<AgentThreadView>,
  disclosure: AgentRailProjectDisclosureState,
  selectedThreadId: string | null,
): Omit<AgentRailProjectSection, "shelved"> {
  const key = entry.projectRootKey;
  if (disclosure.collapsed.has(key)) {
    const selected = threads.filter((view) => view.thread.threadId === selectedThreadId);
    return { entry, collapsed: true, threads, rows: selected, overflow: NO_OVERFLOW };
  }
  if (threads.length <= AGENT_RAIL_PROJECT_PREVIEW_COUNT) {
    return { entry, collapsed: false, threads, rows: threads, overflow: NO_OVERFLOW };
  }
  if (disclosure.showingAll.has(key)) {
    return { entry, collapsed: false, threads, rows: threads, overflow: { kind: "less" } };
  }
  const rows = threads.filter(
    (view, index) =>
      index < AGENT_RAIL_PROJECT_PREVIEW_COUNT || view.thread.threadId === selectedThreadId,
  );
  return {
    entry,
    collapsed: false,
    threads,
    rows,
    overflow: { kind: "more", hidden: threads.length - rows.length },
  };
}
