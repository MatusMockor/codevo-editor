import {
  MAX_PERSISTED_AGENT_PROJECT_SELECTIONS,
  type PersistedAgentProjectSelection,
} from "../../domain/agentProjectSelectionSnapshot";

export interface AgentNavigationRestoreLedger {
  recall(projectRootKey: string): PersistedAgentProjectSelection | null;
  remember(selection: PersistedAgentProjectSelection): void;
  settle(projectRootKey: string): void;
  decline(projectRootKey: string): void;
  forgetThread(threadId: string): void;
  snapshot(): ReadonlyArray<PersistedAgentProjectSelection>;
}

const REMOTE_PROJECT_PREFIX = "remote:";

export function createAgentNavigationRestoreLedger(
  restored: ReadonlyArray<PersistedAgentProjectSelection>,
  onChange: () => void,
): AgentNavigationRestoreLedger {
  const entries = new Map<string, PersistedAgentProjectSelection>();
  const settled = new Set<string>();
  const declined = new Set<string>();
  for (const entry of restored) store(entries, entry);
  return {
    recall(projectRootKey: string): PersistedAgentProjectSelection | null {
      if (settled.has(projectRootKey) || declined.has(projectRootKey)) return null;
      return entries.get(projectRootKey) ?? null;
    },
    remember(selection: PersistedAgentProjectSelection): void {
      if (selection.projectRootKey.startsWith(REMOTE_PROJECT_PREFIX)) return;
      if (selection.threadId === null && !settled.has(selection.projectRootKey)) return;
      settled.add(selection.projectRootKey);
      if (sameAsNewest(entries, selection)) return;
      store(entries, normalized(selection));
      onChange();
    },
    settle(projectRootKey: string): void {
      settled.add(projectRootKey);
    },
    decline(projectRootKey: string): void {
      declined.add(projectRootKey);
    },
    forgetThread(threadId: string): void {
      let changed = false;
      for (const [projectRootKey, entry] of entries) {
        if (entry.threadId !== threadId) continue;
        entries.delete(projectRootKey);
        changed = true;
      }
      if (changed) onChange();
    },
    snapshot(): ReadonlyArray<PersistedAgentProjectSelection> {
      return [...entries.values()];
    },
  };
}

function normalized(selection: PersistedAgentProjectSelection): PersistedAgentProjectSelection {
  if (selection.threadId === null) {
    return { projectRootKey: selection.projectRootKey, threadId: null, repositoryRoot: null };
  }
  return selection;
}

function store(
  entries: Map<string, PersistedAgentProjectSelection>,
  entry: PersistedAgentProjectSelection,
): void {
  entries.delete(entry.projectRootKey);
  entries.set(entry.projectRootKey, entry);
  while (entries.size > MAX_PERSISTED_AGENT_PROJECT_SELECTIONS) {
    const oldest = entries.keys().next();
    if (oldest.done === true) return;
    entries.delete(oldest.value);
  }
}

function sameAsNewest(
  entries: ReadonlyMap<string, PersistedAgentProjectSelection>,
  selection: PersistedAgentProjectSelection,
): boolean {
  const current = entries.get(selection.projectRootKey);
  if (current === undefined) return false;
  if (current.threadId !== selection.threadId) return false;
  if (selection.threadId !== null && current.repositoryRoot !== selection.repositoryRoot) {
    return false;
  }
  const keys = [...entries.keys()];
  return keys[keys.length - 1] === selection.projectRootKey;
}
