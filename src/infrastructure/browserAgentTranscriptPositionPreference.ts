import type { AgentTranscriptPositionPreferencePort } from "../application/agentTranscriptPositionMemory";
import {
  parseAgentTranscriptPositions,
  serializeAgentTranscriptPositions,
  type AgentTranscriptPositionEntry,
} from "../domain/agentTranscriptPosition";
import type { KeyValueStorage } from "./browserSettingsGateway";

export const AGENT_TRANSCRIPT_POSITIONS_STORAGE_KEY = "editor.agentTranscript.positions.v1";

const NO_ENTRIES: ReadonlyArray<AgentTranscriptPositionEntry> = Object.freeze([]);

export class BrowserAgentTranscriptPositionPreference implements AgentTranscriptPositionPreferencePort {
  constructor(private readonly storage: KeyValueStorage | null = browserStorage()) {}

  load(): ReadonlyArray<AgentTranscriptPositionEntry> {
    if (this.storage === null) return NO_ENTRIES;
    try {
      return parseAgentTranscriptPositions(
        this.storage.getItem(AGENT_TRANSCRIPT_POSITIONS_STORAGE_KEY),
      );
    } catch {
      return NO_ENTRIES;
    }
  }

  save(entries: ReadonlyArray<AgentTranscriptPositionEntry>): void {
    if (this.storage === null) return;
    try {
      this.write(this.storage, entries);
    } catch {
      return;
    }
  }

  private write(
    storage: KeyValueStorage,
    entries: ReadonlyArray<AgentTranscriptPositionEntry>,
  ): void {
    if (entries.length === 0) {
      storage.removeItem(AGENT_TRANSCRIPT_POSITIONS_STORAGE_KEY);
      return;
    }
    storage.setItem(
      AGENT_TRANSCRIPT_POSITIONS_STORAGE_KEY,
      serializeAgentTranscriptPositions(entries),
    );
  }
}

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
