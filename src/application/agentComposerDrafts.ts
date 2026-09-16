import { MAX_AGENT_TASK_PROMPT_BYTES } from "../domain/agentTask";

export const MAX_AGENT_COMPOSER_DRAFTS = 64;
export const MAX_AGENT_COMPOSER_DRAFT_BYTES = 2 * MAX_AGENT_TASK_PROMPT_BYTES;

export interface AgentComposerDraftStore {
  readDraft(key: string): string;
  writeDraft(key: string, text: string): void;
  clearDraft(key: string): void;
  reset(): void;
}

const MAX_UTF8_BYTES_PER_UNIT = 3;
const ENCODER = new TextEncoder();

export function createAgentComposerDraftStore(): AgentComposerDraftStore {
  const drafts = new Map<string, string>();
  const evictOverflow = (): void => {
    while (drafts.size > MAX_AGENT_COMPOSER_DRAFTS) {
      const oldest = drafts.keys().next();
      if (oldest.done === true) return;
      drafts.delete(oldest.value);
    }
  };
  return {
    readDraft(key: string): string {
      return drafts.get(key) ?? "";
    },
    writeDraft(key: string, text: string): void {
      if (key === "") return;
      if (text === "") {
        drafts.delete(key);
        return;
      }
      if (!retainableDraft(text)) {
        drafts.delete(key);
        return;
      }
      drafts.delete(key);
      drafts.set(key, text);
      evictOverflow();
    },
    clearDraft(key: string): void {
      drafts.delete(key);
    },
    reset(): void {
      drafts.clear();
    },
  };
}

export const agentComposerDraftStore = createAgentComposerDraftStore();

function retainableDraft(text: string): boolean {
  if (text.length > MAX_AGENT_COMPOSER_DRAFT_BYTES) return false;
  if (text.length * MAX_UTF8_BYTES_PER_UNIT <= MAX_AGENT_COMPOSER_DRAFT_BYTES) return true;
  return ENCODER.encode(text).length <= MAX_AGENT_COMPOSER_DRAFT_BYTES;
}
