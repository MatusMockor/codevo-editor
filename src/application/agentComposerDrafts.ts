import {
  isAgentComposerDraftTextRetainable,
  MAX_AGENT_COMPOSER_DRAFT_TEXT_BYTES,
  type AgentComposerDraftEntry,
} from "../domain/agentComposerDraftSnapshot";

export const MAX_AGENT_COMPOSER_DRAFTS = 64;
export const MAX_AGENT_COMPOSER_DRAFT_BYTES = MAX_AGENT_COMPOSER_DRAFT_TEXT_BYTES;

export interface AgentComposerDraftStore {
  readDraft(key: string): string;
  writeDraft(key: string, text: string): void;
  clearDraft(key: string): void;
  reset(): void;
  snapshot(): readonly AgentComposerDraftEntry[];
  hydrate(entries: readonly AgentComposerDraftEntry[]): void;
  subscribe(listener: () => void): () => void;
}

export function createAgentComposerDraftStore(): AgentComposerDraftStore {
  let drafts = new Map<string, string>();
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };
  const evictOverflow = (): void => {
    while (drafts.size > MAX_AGENT_COMPOSER_DRAFTS) {
      const oldest = drafts.keys().next();
      if (oldest.done === true) return;
      drafts.delete(oldest.value);
    }
  };
  const remove = (key: string): void => {
    if (!drafts.delete(key)) return;
    notify();
  };
  const isNewest = (key: string): boolean => {
    let newest: string | null = null;
    for (const candidate of drafts.keys()) newest = candidate;
    return newest === key;
  };
  return {
    readDraft(key: string): string {
      return drafts.get(key) ?? "";
    },
    writeDraft(key: string, text: string): void {
      if (key === "") return;
      if (!isAgentComposerDraftTextRetainable(text)) {
        remove(key);
        return;
      }
      if (drafts.get(key) === text && isNewest(key)) return;
      drafts.delete(key);
      drafts.set(key, text);
      evictOverflow();
      notify();
    },
    clearDraft(key: string): void {
      remove(key);
    },
    reset(): void {
      if (drafts.size === 0) return;
      drafts.clear();
      notify();
    },
    snapshot(): readonly AgentComposerDraftEntry[] {
      return [...drafts.entries()];
    },
    hydrate(entries: readonly AgentComposerDraftEntry[]): void {
      const restored = new Map<string, string>();
      for (const [key, text] of entries) {
        if (key === "" || drafts.has(key)) continue;
        if (!isAgentComposerDraftTextRetainable(text)) continue;
        restored.delete(key);
        restored.set(key, text);
      }
      if (restored.size === 0) return;
      drafts = new Map([...restored, ...drafts]);
      evictOverflow();
    },
    subscribe(listener: () => void): () => void {
      const entry = (): void => listener();
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },
  };
}

export const agentComposerDraftStore = createAgentComposerDraftStore();
