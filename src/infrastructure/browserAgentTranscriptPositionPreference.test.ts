import { describe, expect, it } from "vitest";
import type { AgentTranscriptPositionEntry } from "../domain/agentTranscriptPosition";
import {
  AGENT_TRANSCRIPT_POSITIONS_STORAGE_KEY,
  BrowserAgentTranscriptPositionPreference,
} from "./browserAgentTranscriptPositionPreference";
import type { KeyValueStorage } from "./browserSettingsGateway";

function memoryStorage(initial: string | null = null): KeyValueStorage & {
  readonly values: Map<string, string>;
} {
  const values = new Map<string, string>();
  if (initial !== null) values.set(AGENT_TRANSCRIPT_POSITIONS_STORAGE_KEY, initial);
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function throwingStorage(): KeyValueStorage {
  const fail = (): never => {
    throw new DOMException("denied", "SecurityError");
  };
  return { getItem: fail, setItem: fail, removeItem: fail };
}

const ENTRIES: ReadonlyArray<AgentTranscriptPositionEntry> = [
  { threadId: "agt-1", position: { kind: "turn", turnId: "turn-a", offsetPx: -120 } },
  { threadId: "agt-2", position: { kind: "turn", turnId: "turn-b", offsetPx: 8 } },
];

describe("BrowserAgentTranscriptPositionPreference", () => {
  it("uses the versioned app-wide key", () => {
    expect(AGENT_TRANSCRIPT_POSITIONS_STORAGE_KEY).toBe("editor.agentTranscript.positions.v1");
  });

  it("round-trips positions through storage", () => {
    const storage = memoryStorage();
    const preference = new BrowserAgentTranscriptPositionPreference(storage);
    preference.save(ENTRIES);
    expect(new BrowserAgentTranscriptPositionPreference(storage).load()).toEqual(ENTRIES);
  });

  it("removes the key when nothing is left to remember", () => {
    const storage = memoryStorage();
    const preference = new BrowserAgentTranscriptPositionPreference(storage);
    preference.save(ENTRIES);
    preference.save([]);
    expect(storage.values.has(AGENT_TRANSCRIPT_POSITIONS_STORAGE_KEY)).toBe(false);
  });

  it("fails closed on a corrupt stored value", () => {
    expect(new BrowserAgentTranscriptPositionPreference(memoryStorage("{nope")).load()).toEqual([]);
  });

  it("swallows storage failures on load and save", () => {
    const preference = new BrowserAgentTranscriptPositionPreference(throwingStorage());
    expect(preference.load()).toEqual([]);
    expect(() => preference.save(ENTRIES)).not.toThrow();
    expect(() => preference.save([])).not.toThrow();
  });

  it("works without storage", () => {
    const preference = new BrowserAgentTranscriptPositionPreference(null);
    expect(preference.load()).toEqual([]);
    expect(() => preference.save(ENTRIES)).not.toThrow();
  });
});
