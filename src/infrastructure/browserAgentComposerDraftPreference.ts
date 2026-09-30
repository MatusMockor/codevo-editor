import type { AgentComposerDraftPreferencePort } from "../application/agentComposerDraftPreferencePort";
import {
  parseAgentComposerDraftSnapshot,
  serializeAgentComposerDraftSnapshot,
  type AgentComposerDraftEntry,
} from "../domain/agentComposerDraftSnapshot";
import type { KeyValueStorage } from "./browserSettingsGateway";

export const AGENT_COMPOSER_DRAFTS_STORAGE_KEY = "editor.agentComposer.drafts.v1";

const EMPTY_SNAPSHOT = serializeAgentComposerDraftSnapshot([]);
const NO_ENTRIES: readonly AgentComposerDraftEntry[] = Object.freeze([]);

export class BrowserAgentComposerDraftPreference implements AgentComposerDraftPreferencePort {
  constructor(private readonly storage: KeyValueStorage | null = browserStorage()) {}

  load(): readonly AgentComposerDraftEntry[] {
    if (this.storage === null) return NO_ENTRIES;
    try {
      return parseAgentComposerDraftSnapshot(
        this.storage.getItem(AGENT_COMPOSER_DRAFTS_STORAGE_KEY),
      );
    } catch {
      return NO_ENTRIES;
    }
  }

  save(entries: readonly AgentComposerDraftEntry[]): void {
    if (this.storage === null) return;
    const raw = serializeAgentComposerDraftSnapshot(entries);
    try {
      if (raw === EMPTY_SNAPSHOT) {
        this.storage.removeItem(AGENT_COMPOSER_DRAFTS_STORAGE_KEY);
        return;
      }
      this.storage.setItem(AGENT_COMPOSER_DRAFTS_STORAGE_KEY, raw);
    } catch {
      return;
    }
  }
}

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
