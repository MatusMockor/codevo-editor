import { describe, expect, it } from "vitest";
import { MAX_AGENT_TASK_PROMPT_BYTES } from "../domain/agentTask";
import {
  agentComposerDraftStore,
  createAgentComposerDraftStore,
  MAX_AGENT_COMPOSER_DRAFTS,
  MAX_AGENT_COMPOSER_DRAFT_BYTES,
} from "./agentComposerDrafts";

describe("agentComposerDrafts", () => {
  it("returns an empty draft for an unknown key and keeps targets separate", () => {
    const store = createAgentComposerDraftStore();

    expect(store.readDraft("agt-1")).toBe("");

    store.writeDraft("agt-1", "reply to the agent");
    store.writeDraft("new:/workspace/app", "start a new thread");

    expect(store.readDraft("agt-1")).toBe("reply to the agent");
    expect(store.readDraft("new:/workspace/app")).toBe("start a new thread");
    expect(store.readDraft("agt-2")).toBe("");
  });

  it("replaces a draft and clears it on demand", () => {
    const store = createAgentComposerDraftStore();

    store.writeDraft("agt-1", "first");
    store.writeDraft("agt-1", "second");
    expect(store.readDraft("agt-1")).toBe("second");

    store.clearDraft("agt-1");
    expect(store.readDraft("agt-1")).toBe("");
  });

  it("drops the draft when the composer is emptied and ignores an empty key", () => {
    const store = createAgentComposerDraftStore();

    store.writeDraft("agt-1", "typed");
    store.writeDraft("agt-1", "");
    expect(store.readDraft("agt-1")).toBe("");

    store.writeDraft("", "nowhere");
    expect(store.readDraft("")).toBe("");
  });

  it("evicts the least recently written draft past the key bound", () => {
    const store = createAgentComposerDraftStore();
    for (let index = 0; index < MAX_AGENT_COMPOSER_DRAFTS; index += 1) {
      store.writeDraft(`agt-${index}`, `draft ${index}`);
    }

    store.writeDraft("agt-0", "draft 0 again");
    store.writeDraft("agt-overflow", "newest");

    expect(store.readDraft("agt-0")).toBe("draft 0 again");
    expect(store.readDraft("agt-1")).toBe("");
    expect(store.readDraft("agt-overflow")).toBe("newest");
    expect(store.readDraft(`agt-${MAX_AGENT_COMPOSER_DRAFTS - 1}`)).toBe(
      `draft ${MAX_AGENT_COMPOSER_DRAFTS - 1}`,
    );
  });

  it("reads without disturbing the eviction order", () => {
    const store = createAgentComposerDraftStore();
    for (let index = 0; index < MAX_AGENT_COMPOSER_DRAFTS; index += 1) {
      store.writeDraft(`agt-${index}`, `draft ${index}`);
    }

    expect(store.readDraft("agt-0")).toBe("draft 0");
    store.writeDraft("agt-overflow", "newest");

    expect(store.readDraft("agt-0")).toBe("");
  });

  it("keeps a draft that the composer already flags as over the turn limit", () => {
    const store = createAgentComposerDraftStore();
    const overTurnLimit = "a".repeat(MAX_AGENT_TASK_PROMPT_BYTES + 1);

    store.writeDraft("agt-1", overTurnLimit);

    expect(MAX_AGENT_COMPOSER_DRAFT_BYTES).toBe(2 * MAX_AGENT_TASK_PROMPT_BYTES);
    expect(store.readDraft("agt-1")).toBe(overTurnLimit);
  });

  it("drops every retained draft when the store is reset", () => {
    const store = createAgentComposerDraftStore();
    store.writeDraft("agt-1", "one");
    store.writeDraft("agt-2", "two");

    store.reset();

    expect(store.readDraft("agt-1")).toBe("");
    expect(store.readDraft("agt-2")).toBe("");
  });

  it("refuses to retain an oversized draft instead of keeping a truncated one", () => {
    const store = createAgentComposerDraftStore();
    store.writeDraft("agt-1", "short");

    store.writeDraft("agt-1", "a".repeat(MAX_AGENT_COMPOSER_DRAFT_BYTES + 1));
    expect(store.readDraft("agt-1")).toBe("");

    const multibyte = "é".repeat(MAX_AGENT_COMPOSER_DRAFT_BYTES / 2 + 1);
    store.writeDraft("agt-2", multibyte);
    expect(store.readDraft("agt-2")).toBe("");

    const atLimit = "a".repeat(MAX_AGENT_COMPOSER_DRAFT_BYTES);
    store.writeDraft("agt-3", atLimit);
    expect(store.readDraft("agt-3")).toBe(atLimit);
  });

  it("hands every caller of the shared store an independent instance from the factory", () => {
    const store = createAgentComposerDraftStore();
    store.writeDraft("agt-isolated", "only here");

    expect(agentComposerDraftStore.readDraft("agt-isolated")).toBe("");

    agentComposerDraftStore.writeDraft("agt-isolated", "shared");
    expect(store.readDraft("agt-isolated")).toBe("only here");
    agentComposerDraftStore.clearDraft("agt-isolated");
  });
});

describe("agentComposerDrafts persistence surface", () => {
  it("snapshots drafts oldest-first in write recency order", () => {
    const store = createAgentComposerDraftStore();
    store.writeDraft("agt-1", "one");
    store.writeDraft("agt-2", "two");
    store.writeDraft("agt-1", "one again");

    expect(store.snapshot()).toEqual([
      ["agt-2", "two"],
      ["agt-1", "one again"],
    ]);
  });

  it("hydrates only absent keys and never overrides live text", () => {
    const store = createAgentComposerDraftStore();
    store.writeDraft("agt-live", "typed after launch");

    store.hydrate([
      ["agt-live", "stale persisted text"],
      ["agt-restored", "restored"],
      ["new:/workspace/app", "restored new thread"],
    ]);

    expect(store.readDraft("agt-live")).toBe("typed after launch");
    expect(store.readDraft("agt-restored")).toBe("restored");
    expect(store.readDraft("new:/workspace/app")).toBe("restored new thread");
    expect(store.snapshot()).toEqual([
      ["agt-restored", "restored"],
      ["new:/workspace/app", "restored new thread"],
      ["agt-live", "typed after launch"],
    ]);
  });

  it("hydrates within the existing caps and evicts restored drafts before live ones", () => {
    const store = createAgentComposerDraftStore();
    store.writeDraft("agt-live", "live");
    const restored = Array.from(
      { length: MAX_AGENT_COMPOSER_DRAFTS },
      (_, index) => [`agt-${index}`, `draft ${index}`] as const,
    );

    store.hydrate([
      ...restored,
      ["", "empty key"],
      ["agt-empty", ""],
      ["agt-oversize", "a".repeat(MAX_AGENT_COMPOSER_DRAFT_BYTES + 1)],
    ]);

    const snapshot = store.snapshot();
    expect(snapshot).toHaveLength(MAX_AGENT_COMPOSER_DRAFTS);
    expect(snapshot[snapshot.length - 1]).toEqual(["agt-live", "live"]);
    expect(store.readDraft("agt-0")).toBe("");
    expect(store.readDraft(`agt-${MAX_AGENT_COMPOSER_DRAFTS - 1}`)).toBe(
      `draft ${MAX_AGENT_COMPOSER_DRAFTS - 1}`,
    );
    expect(store.readDraft("agt-oversize")).toBe("");
    expect(store.readDraft("")).toBe("");
  });

  it("notifies subscribers only when a write, clear or reset changes state", () => {
    const store = createAgentComposerDraftStore();
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });

    store.writeDraft("agt-1", "one");
    expect(notifications).toBe(1);
    store.writeDraft("agt-1", "one");
    expect(notifications).toBe(1);
    store.writeDraft("agt-2", "two");
    expect(notifications).toBe(2);
    store.writeDraft("agt-1", "one");
    expect(notifications).toBe(3);
    store.writeDraft("agt-1", "changed");
    expect(notifications).toBe(4);
    store.clearDraft("agt-missing");
    store.writeDraft("agt-missing", "");
    store.writeDraft("", "nowhere");
    expect(notifications).toBe(4);
    store.clearDraft("agt-1");
    expect(notifications).toBe(5);
    store.writeDraft("agt-2", "");
    expect(notifications).toBe(6);
    store.hydrate([["agt-restored", "restored"]]);
    expect(notifications).toBe(6);
    store.reset();
    expect(notifications).toBe(7);
    store.reset();
    expect(notifications).toBe(7);

    unsubscribe();
    store.writeDraft("agt-3", "after unsubscribe");
    expect(notifications).toBe(7);
  });
});
