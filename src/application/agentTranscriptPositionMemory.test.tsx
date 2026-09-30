// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_AGENT_TRANSCRIPT_POSITION_THREADS,
  type AgentTranscriptPosition,
} from "../domain/agentTranscriptPosition";
import {
  AGENT_TRANSCRIPT_POSITIONS_STORAGE_KEY,
  BrowserAgentTranscriptPositionPreference,
} from "../infrastructure/browserAgentTranscriptPositionPreference";
import type { KeyValueStorage } from "../infrastructure/browserSettingsGateway";
import {
  createAgentTranscriptPositionMemory,
  useAgentTranscriptPositionMemory,
  type AgentTranscriptPositionMemory,
  type AgentTranscriptPositionPreferencePort,
} from "./agentTranscriptPositionMemory";
import {
  createSessionRestoreFlushRegistry,
  type SessionRestoreFlushRegistry,
  type SessionRestoreTimers,
} from "./sessionRestorePersistence";

function at(turnId: string, offsetPx: number): AgentTranscriptPosition {
  return { kind: "turn", turnId, offsetPx };
}

describe("createAgentTranscriptPositionMemory", () => {
  it("reads nothing for an unknown thread", () => {
    expect(createAgentTranscriptPositionMemory().read("agt-1")).toBeNull();
  });

  it("remembers a position and forgets it when the reader returns to the latest", () => {
    const memory = createAgentTranscriptPositionMemory();
    memory.remember("agt-1", at("turn-a", -20.4));
    expect(memory.read("agt-1")).toEqual(at("turn-a", -20));
    memory.remember("agt-1", null);
    expect(memory.read("agt-1")).toBeNull();
    expect(memory.snapshot()).toEqual([]);
  });

  it("evicts the least recently remembered thread beyond its capacity", () => {
    const memory = createAgentTranscriptPositionMemory(2);
    memory.remember("a", at("t", 1));
    memory.remember("b", at("t", 2));
    memory.remember("a", at("t", 3));
    memory.remember("c", at("t", 4));
    expect(memory.read("b")).toBeNull();
    expect(memory.snapshot().map((entry) => entry.threadId)).toEqual(["a", "c"]);
  });

  it("never holds more than the persisted thread bound", () => {
    const memory = createAgentTranscriptPositionMemory(10_000);
    for (let index = 0; index < MAX_AGENT_TRANSCRIPT_POSITION_THREADS + 10; index += 1) {
      memory.remember(`thread-${index}`, at("t", index));
    }
    expect(memory.snapshot()).toHaveLength(MAX_AGENT_TRANSCRIPT_POSITION_THREADS);
  });

  it("ignores invalid thread ids and positions", () => {
    const memory = createAgentTranscriptPositionMemory();
    memory.remember("", at("t", 1));
    memory.remember("agt-1", at("", 1));
    memory.remember("agt-2", at("t", Number.NaN));
    expect(memory.snapshot()).toEqual([]);
  });

  it("notifies subscribers only when a remembered position actually changes", () => {
    const memory = createAgentTranscriptPositionMemory();
    let changes = 0;
    const unsubscribe = memory.subscribe(() => {
      changes += 1;
    });
    memory.remember("agt-1", at("t", 1));
    memory.remember("agt-1", at("t", 1.2));
    memory.remember("agt-2", null);
    expect(changes).toBe(1);
    memory.remember("agt-1", null);
    expect(changes).toBe(2);
    unsubscribe();
    memory.remember("agt-1", at("t", 5));
    expect(changes).toBe(2);
  });

  it("hydrates bounded entries in recency order, replacing what it held", () => {
    const memory = createAgentTranscriptPositionMemory(2);
    memory.remember("old", at("t", 9));
    memory.hydrate([
      { threadId: "a", position: at("t", 1) },
      { threadId: "b", position: at("t", 2) },
      { threadId: "c", position: at("t", 3) },
    ]);
    expect(memory.read("old")).toBeNull();
    expect(memory.snapshot()).toEqual([
      { threadId: "b", position: at("t", 2) },
      { threadId: "c", position: at("t", 3) },
    ]);
  });
});

function memoryStorage(): KeyValueStorage & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
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

function manualTimers(): SessionRestoreTimers & { pending(): number } {
  const callbacks = new Map<number, () => void>();
  let next = 1;
  return {
    setTimeout(callback) {
      const handle = next;
      next += 1;
      callbacks.set(handle, callback);
      return handle;
    },
    clearTimeout(handle) {
      callbacks.delete(handle);
    },
    pending: () => callbacks.size,
  };
}

describe("useAgentTranscriptPositionMemory", () => {
  let host: HTMLDivElement;
  let root: Root;
  let registry: SessionRestoreFlushRegistry;
  let timers: ReturnType<typeof manualTimers>;
  let captured: AgentTranscriptPositionMemory | null;

  function Probe({ port }: { readonly port: AgentTranscriptPositionPreferencePort | null }) {
    captured = useAgentTranscriptPositionMemory(port, { registry, timers });
    return null;
  }

  function mount(
    port: AgentTranscriptPositionPreferencePort | null,
  ): AgentTranscriptPositionMemory {
    act(() => root.render(<Probe port={port} />));
    expect(captured).not.toBeNull();
    return captured as AgentTranscriptPositionMemory;
  }

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    registry = createSessionRestoreFlushRegistry();
    timers = manualTimers();
    captured = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("persists remembered positions on flush and a fresh memory reads them back", () => {
    const storage = memoryStorage();
    const memory = mount(new BrowserAgentTranscriptPositionPreference(storage));
    act(() => memory.remember("agt-1", at("turn-a", -64)));
    expect(storage.values.has(AGENT_TRANSCRIPT_POSITIONS_STORAGE_KEY)).toBe(false);
    expect(timers.pending()).toBe(1);

    registry.flushAll();
    expect(storage.values.has(AGENT_TRANSCRIPT_POSITIONS_STORAGE_KEY)).toBe(true);

    act(() => root.unmount());
    root = createRoot(host);
    const restored = mount(new BrowserAgentTranscriptPositionPreference(storage));
    expect(restored).not.toBe(memory);
    expect(restored.read("agt-1")).toEqual(at("turn-a", -64));
  });

  it("removes the stored key once no thread is scrolled up", () => {
    const storage = memoryStorage();
    const memory = mount(new BrowserAgentTranscriptPositionPreference(storage));
    act(() => memory.remember("agt-1", at("turn-a", 0)));
    registry.flushAll();
    act(() => memory.remember("agt-1", null));
    registry.flushAll();
    expect(storage.values.has(AGENT_TRANSCRIPT_POSITIONS_STORAGE_KEY)).toBe(false);
  });

  it("flushes a pending save when it unmounts", () => {
    const storage = memoryStorage();
    const memory = mount(new BrowserAgentTranscriptPositionPreference(storage));
    act(() => memory.remember("agt-1", at("turn-a", 12)));
    act(() => root.unmount());
    root = createRoot(host);
    expect(mount(new BrowserAgentTranscriptPositionPreference(storage)).read("agt-1")).toEqual(
      at("turn-a", 12),
    );
  });

  it("keeps the same memory across renders and still works without a port", () => {
    const memory = mount(null);
    expect(mount(null)).toBe(memory);
    act(() => memory.remember("agt-1", at("turn-a", 3)));
    expect(() => registry.flushAll()).not.toThrow();
    expect(memory.read("agt-1")).toEqual(at("turn-a", 3));
  });
});
