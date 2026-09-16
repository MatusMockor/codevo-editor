// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentComposerDraftStore } from "../../application/agentComposerDrafts";
import type { AgentComposerControllerProps } from "./AgentComposerController";

vi.mock("./AgentComposer", () => ({
  AgentComposer: ({
    prompt,
    onPromptChange,
  }: {
    readonly prompt: string;
    onPromptChange(next: string): void;
  }) => (
    <textarea
      aria-label="Prompt"
      onChange={(event) => onPromptChange(event.target.value)}
      value={prompt}
    />
  ),
}));

import { AgentComposerController } from "./AgentComposerController";

describe("AgentComposerController drafts", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    agentComposerDraftStore.reset();
    host = document.createElement("div");
    document.body.append(host);
  });

  afterEach(() => {
    agentComposerDraftStore.reset();
    host.remove();
  });

  it("restores the typed prompt when the same target is composed again", () => {
    const first = createRoot(host);
    act(() => first.render(<AgentComposerController {...props("agt-1")} />));

    act(() => type("Finish the migration"));
    expect(agentComposerDraftStore.readDraft("agt-1")).toBe("Finish the migration");

    act(() => first.unmount());
    const second = createRoot(host);
    act(() => second.render(<AgentComposerController {...props("agt-1")} />));

    expect(promptField().value).toBe("Finish the migration");

    act(() => second.unmount());
  });

  it("does not carry a draft into another target", () => {
    const first = createRoot(host);
    act(() => first.render(<AgentComposerController {...props("agt-1")} />));
    act(() => type("Finish the migration"));
    act(() => first.unmount());

    const second = createRoot(host);
    act(() => second.render(<AgentComposerController {...props("agt-2")} />));

    expect(promptField().value).toBe("");

    act(() => second.unmount());
  });

  function promptField(): HTMLTextAreaElement {
    const element = host.querySelector<HTMLTextAreaElement>("textarea");
    expect(element).not.toBeNull();
    return element ?? document.createElement("textarea");
  }

  function type(text: string): void {
    const field = promptField();
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set?.bind(field);
    expect(setter).not.toBeUndefined();
    setter?.(text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function props(draftKey: string): AgentComposerControllerProps {
    return {
      composerProps: { draftKey, promptOwnerKey: draftKey },
      providerManagement: {},
      providerEnabled: { claudeCode: true, codex: true },
      submissionBlocked: false,
      submit: async () => true,
      onOpenProviderSettings: () => undefined,
    } as unknown as AgentComposerControllerProps;
  }
});
