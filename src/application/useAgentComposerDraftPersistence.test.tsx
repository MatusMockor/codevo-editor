// @vitest-environment jsdom
import { act, StrictMode, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_COMPOSER_DRAFTS_STORAGE_KEY,
  BrowserAgentComposerDraftPreference,
} from "../infrastructure/browserAgentComposerDraftPreference";
import type { KeyValueStorage } from "../infrastructure/browserSettingsGateway";
import type { AgentComposerDraftPreferencePort } from "./agentComposerDraftPreferencePort";
import { createAgentComposerDraftStore, type AgentComposerDraftStore } from "./agentComposerDrafts";
import {
  createSessionRestoreFlushRegistry,
  type SessionRestoreFlushRegistry,
  type SessionRestoreTimers,
} from "./sessionRestorePersistence";
import { useAgentComposerDraftPersistence } from "./useAgentComposerDraftPersistence";

const cleanups: (() => void)[] = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

interface CountingStorage extends KeyValueStorage {
  readonly values: Map<string, string>;
  reads(): number;
}

function memoryStorage(): CountingStorage {
  const values = new Map<string, string>();
  let reads = 0;
  return {
    values,
    reads: () => reads,
    getItem: (key) => {
      reads += 1;
      return values.get(key) ?? null;
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

interface ManualTimers extends SessionRestoreTimers {
  pending(): number;
  runAll(): void;
}

function manualTimers(): ManualTimers {
  const callbacks = new Map<number, () => void>();
  let next = 1;
  return {
    setTimeout: (callback) => {
      const handle = next;
      next += 1;
      callbacks.set(handle, callback);
      return handle;
    },
    clearTimeout: (handle) => {
      callbacks.delete(handle);
    },
    pending: () => callbacks.size,
    runAll: () => {
      const due = [...callbacks.values()];
      callbacks.clear();
      due.forEach((callback) => callback());
    },
  };
}

interface Session {
  readonly port: AgentComposerDraftPreferencePort | null;
  readonly store: AgentComposerDraftStore;
  readonly registry: SessionRestoreFlushRegistry;
  readonly timers: ManualTimers;
}

function session(
  storage: KeyValueStorage,
  store: AgentComposerDraftStore = createAgentComposerDraftStore(),
): Session {
  return {
    port: new BrowserAgentComposerDraftPreference(storage),
    store,
    registry: createSessionRestoreFlushRegistry(),
    timers: manualTimers(),
  };
}

function ChildComposer({
  store,
  draftKey,
  seen,
}: {
  readonly store: AgentComposerDraftStore;
  readonly draftKey: string;
  readonly seen: (text: string) => void;
}) {
  const [text] = useState(() => store.readDraft(draftKey));
  seen(text);
  return null;
}

function Screen({
  current,
  children,
}: {
  readonly current: Session;
  readonly children?: ReactNode;
}) {
  useAgentComposerDraftPersistence(current.port, current.store, {
    registry: current.registry,
    timers: current.timers,
  });
  return <>{children}</>;
}

function mount(node: ReactNode): () => void {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.createElement("div"));
  act(() => root.render(node));
  let mounted = true;
  const unmount = (): void => {
    if (!mounted) return;
    mounted = false;
    act(() => root.unmount());
  };
  cleanups.push(unmount);
  return unmount;
}

describe("useAgentComposerDraftPersistence", () => {
  it("restores thread and new-thread drafts after a relaunch on the debounced save", () => {
    const storage = memoryStorage();
    const first = session(storage);
    const unmountFirst = mount(<Screen current={first} />);

    act(() => {
      first.store.writeDraft("agt-mue1wenj-7ede", "reply to the agent");
      first.store.writeDraft("new:/workspace/app", "start a new thread");
    });
    expect(storage.values.has(AGENT_COMPOSER_DRAFTS_STORAGE_KEY)).toBe(false);
    expect(first.timers.pending()).toBe(1);

    act(() => first.timers.runAll());
    expect(storage.values.has(AGENT_COMPOSER_DRAFTS_STORAGE_KEY)).toBe(true);
    unmountFirst();

    const relaunched = session(storage);
    const seen: string[] = [];
    mount(
      <Screen current={relaunched}>
        <ChildComposer
          store={relaunched.store}
          draftKey="agt-mue1wenj-7ede"
          seen={(text) => seen.push(text)}
        />
      </Screen>,
    );

    expect(seen[0]).toBe("reply to the agent");
    expect(relaunched.store.readDraft("agt-mue1wenj-7ede")).toBe("reply to the agent");
    expect(relaunched.store.readDraft("new:/workspace/app")).toBe("start a new thread");
  });

  it("saves pending drafts when the flush registry is flushed", () => {
    const storage = memoryStorage();
    const current = session(storage);
    mount(<Screen current={current} />);

    act(() => current.store.writeDraft("agt-1", "typed right before quit"));
    act(() => current.registry.flushAll());

    expect(current.timers.pending()).toBe(0);
    expect(session(storage).port?.load()).toEqual([["agt-1", "typed right before quit"]]);
  });

  it("never clobbers a live draft with persisted text", () => {
    const storage = memoryStorage();
    new BrowserAgentComposerDraftPreference(storage).save([
      ["agt-1", "stale persisted text"],
      ["agt-2", "restored"],
    ]);
    const current = session(storage);
    current.store.writeDraft("agt-1", "typed after launch");

    mount(<Screen current={current} />);

    expect(current.store.readDraft("agt-1")).toBe("typed after launch");
    expect(current.store.readDraft("agt-2")).toBe("restored");

    act(() => current.store.writeDraft("agt-3", "more"));
    act(() => current.registry.flushAll());
    expect(session(storage).port?.load()).toEqual([
      ["agt-2", "restored"],
      ["agt-1", "typed after launch"],
      ["agt-3", "more"],
    ]);
  });

  it("persists a cleared draft as removed", () => {
    const storage = memoryStorage();
    const current = session(storage);
    mount(<Screen current={current} />);
    act(() => current.store.writeDraft("agt-1", "sent soon"));
    act(() => current.registry.flushAll());

    act(() => current.store.clearDraft("agt-1"));
    act(() => current.registry.flushAll());

    expect(storage.values.has(AGENT_COMPOSER_DRAFTS_STORAGE_KEY)).toBe(false);
  });

  it("hydrates once under StrictMode double rendering and still persists", () => {
    const storage = memoryStorage();
    new BrowserAgentComposerDraftPreference(storage).save([["agt-1", "restored"]]);
    const current = session(storage);
    const readsBefore = storage.reads();

    mount(
      <StrictMode>
        <Screen current={current} />
      </StrictMode>,
    );

    expect(storage.reads() - readsBefore).toBe(1);
    expect(current.store.readDraft("agt-1")).toBe("restored");

    act(() => current.store.writeDraft("agt-2", "after strict mount"));
    act(() => current.timers.runAll());
    expect(session(storage).port?.load()).toEqual([
      ["agt-1", "restored"],
      ["agt-2", "after strict mount"],
    ]);
  });

  it("does not hydrate the same store again when the screen remounts", () => {
    const storage = memoryStorage();
    new BrowserAgentComposerDraftPreference(storage).save([["agt-1", "restored"]]);
    const store = createAgentComposerDraftStore();
    const unmountFirst = mount(<Screen current={session(storage, store)} />);
    store.clearDraft("agt-1");
    unmountFirst();
    new BrowserAgentComposerDraftPreference(storage).save([["agt-1", "restored"]]);

    mount(<Screen current={session(storage, store)} />);

    expect(store.readDraft("agt-1")).toBe("");
  });

  it("flushes a pending save on unmount and stops listening afterwards", () => {
    const storage = memoryStorage();
    const current = session(storage);
    const unmount = mount(<Screen current={current} />);
    act(() => current.store.writeDraft("agt-1", "pending"));

    unmount();
    expect(session(storage).port?.load()).toEqual([["agt-1", "pending"]]);

    current.store.writeDraft("agt-2", "after unmount");
    expect(current.timers.pending()).toBe(0);
    current.registry.flushAll();
    expect(session(storage).port?.load()).toEqual([["agt-1", "pending"]]);
  });

  it("keeps drafts in memory only when there is no persistence port", () => {
    const current: Session = { ...session(memoryStorage()), port: null };
    mount(<Screen current={current} />);

    act(() => current.store.writeDraft("agt-1", "memory only"));

    expect(current.timers.pending()).toBe(0);
    expect(current.store.readDraft("agt-1")).toBe("memory only");
  });
});
