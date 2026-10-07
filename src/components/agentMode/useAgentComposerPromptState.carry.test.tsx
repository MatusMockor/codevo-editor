// @vitest-environment jsdom

import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAgentComposerDraftStore,
  MAX_AGENT_COMPOSER_DRAFT_BYTES,
  type AgentComposerDraftStore,
} from "../../application/agentComposerDrafts";
import type { AgentComposerDraftCarry } from "../../domain/agentComposerDraftLineage";
import {
  useAgentComposerPromptState,
  type AgentComposerControllerProps,
  type AgentComposerPromptProps,
} from "./useAgentComposerState";

const LOCAL_KEY = "new:/workspace/app";
const SERVER_KEY = "new:remote:server:runner:project";

interface Scene {
  readonly draftKey: string | null;
  readonly draftCarry?: AgentComposerDraftCarry | null;
}

describe("composer prompt across draft keys", () => {
  let root: Root;
  let drafts: AgentComposerDraftStore;
  let captured: AgentComposerPromptProps | null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    root = createRoot(document.createElement("div"));
    drafts = createAgentComposerDraftStore();
    captured = null;
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  function Probe({ scene }: { readonly scene: Scene }) {
    captured = useAgentComposerPromptState({
      composerProps: {
        draftKey: scene.draftKey,
        draftCarry: scene.draftCarry ?? null,
        promptOwnerKey: scene.draftKey ?? "none",
      } as AgentComposerControllerProps,
      drafts,
      submissionBlocked: false,
      submit: async () => true,
    });
    return null;
  }

  function show(scene: Scene): void {
    act(() => root.render(createElement(StrictMode, null, createElement(Probe, { scene }))));
  }

  function prompt(): string {
    expect(captured).not.toBeNull();
    return captured?.prompt ?? "";
  }

  function type(text: string): void {
    act(() => captured?.onPromptChange(text));
  }

  it("moves the visible text to the carried key and leaves nothing behind", () => {
    show({ draftKey: LOCAL_KEY });
    type("Fix the login flow");

    show({ draftKey: SERVER_KEY, draftCarry: { from: LOCAL_KEY, to: SERVER_KEY } });

    expect(prompt()).toBe("Fix the login flow");
    expect(drafts.snapshot()).toEqual([[SERVER_KEY, "Fix the login flow"]]);
  });

  it("keeps the destination's stored draft after the carried text", () => {
    drafts.writeDraft(SERVER_KEY, "Older server draft");
    show({ draftKey: LOCAL_KEY });
    type("Fix the login flow");

    show({ draftKey: SERVER_KEY, draftCarry: { from: LOCAL_KEY, to: SERVER_KEY } });

    expect(prompt()).toBe("Fix the login flow\n\nOlder server draft");
    expect(drafts.snapshot()).toEqual([[SERVER_KEY, "Fix the login flow\n\nOlder server draft"]]);
  });

  it("keeps both drafts stored when together they exceed what a draft may retain", () => {
    const stored = "s".repeat(MAX_AGENT_COMPOSER_DRAFT_BYTES - 8);
    drafts.writeDraft(SERVER_KEY, stored);
    show({ draftKey: LOCAL_KEY });
    type("Fix the login flow");

    show({ draftKey: SERVER_KEY, draftCarry: { from: LOCAL_KEY, to: SERVER_KEY } });

    expect(prompt()).toBe("Fix the login flow");
    expect(drafts.readDraft(SERVER_KEY)).toBe("Fix the login flow");
    expect(drafts.readDraft(LOCAL_KEY)).toBe(stored);

    show({ draftKey: LOCAL_KEY, draftCarry: { from: SERVER_KEY, to: LOCAL_KEY } });

    expect(prompt()).toBe("Fix the login flow");
    expect(drafts.readDraft(LOCAL_KEY)).toBe("Fix the login flow");
    expect(drafts.readDraft(SERVER_KEY)).toBe(stored);
  });

  it("does not carry into a key the carry did not name", () => {
    show({ draftKey: LOCAL_KEY });
    type("Fix the login flow");

    show({ draftKey: "remote-thread:x", draftCarry: { from: LOCAL_KEY, to: SERVER_KEY } });

    expect(prompt()).toBe("");
    expect(drafts.snapshot()).toEqual([[LOCAL_KEY, "Fix the login flow"]]);
  });

  it("does not carry a draft the carry did not start from", () => {
    show({ draftKey: "thread-a" });
    type("Follow-up for A");

    show({ draftKey: SERVER_KEY, draftCarry: { from: LOCAL_KEY, to: SERVER_KEY } });

    expect(prompt()).toBe("");
    expect(drafts.snapshot()).toEqual([["thread-a", "Follow-up for A"]]);
  });

  it("does not repeat a settled carry when the composer keeps rendering", () => {
    show({ draftKey: LOCAL_KEY });
    type("Fix the login flow");
    const carry = { from: LOCAL_KEY, to: SERVER_KEY };
    show({ draftKey: SERVER_KEY, draftCarry: carry });
    drafts.writeDraft(LOCAL_KEY, "A later local draft");

    type("Fix the login flow on the server");
    show({ draftKey: SERVER_KEY, draftCarry: carry });

    expect(prompt()).toBe("Fix the login flow on the server");
    expect(drafts.readDraft(LOCAL_KEY)).toBe("A later local draft");
  });

  it("blanks a keyed draft when the composer loses its identity and adopts only unowned text", () => {
    show({ draftKey: "thread-a" });
    type("Follow-up for A");

    show({ draftKey: null });
    expect(prompt()).toBe("");

    type("Typed without a target");
    show({ draftKey: LOCAL_KEY });
    expect(prompt()).toBe("Typed without a target");
    expect(drafts.readDraft("thread-a")).toBe("Follow-up for A");
  });
});
