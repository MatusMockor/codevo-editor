// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentConversationEscapeApplies } from "./agentConversationEscape";
import { agentConversationEscapeAction } from "./useAgentConversationEscape";

function conversation(markup = ""): HTMLElement {
  const element = document.createElement("div");
  element.innerHTML = markup;
  document.body.append(element);
  return element;
}

function escapeAt(target: EventTarget, init: KeyboardEventInit = {}): KeyboardEvent {
  let captured: KeyboardEvent | null = null;
  const capture = (event: Event): void => {
    captured = event as KeyboardEvent;
  };
  target.addEventListener("keydown", capture);
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...init }),
  );
  target.removeEventListener("keydown", capture);
  expect(captured).not.toBeNull();
  return captured!;
}

describe("agentConversationEscapeApplies", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("applies to a plain element inside the conversation", () => {
    const root = conversation('<div class="row"><span>text</span></div>');
    const event = escapeAt(root.querySelector("span")!);
    expect(
      agentConversationEscapeApplies(event, { conversation: root, ownsDetachedFocus: false }),
    ).toBe(true);
  });

  it.each([
    ["an input", "<input />", "input"],
    ["a textarea", "<textarea></textarea>", "textarea"],
    ["contenteditable text", '<div contenteditable="true"><b>x</b></div>', "b"],
    ["a menu", '<div role="menu"><button>item</button></div>', "button"],
    ["a listbox", '<ul role="listbox"><li>item</li></ul>', "li"],
    ["a dialog", '<div role="dialog"><button>ok</button></div>', "button"],
    ["a popover", '<div class="agent-popover"><button>jump</button></div>', "button"],
    ["a Monaco editor", '<div class="monaco-editor"><div class="line">x</div></div>', ".line"],
    ["a terminal", '<div class="xterm"><div class="rows">x</div></div>', ".rows"],
  ])("leaves Escape to %s", (_label, markup, selector) => {
    const root = conversation(markup);
    const event = escapeAt(root.querySelector(selector)!);
    expect(
      agentConversationEscapeApplies(event, { conversation: root, ownsDetachedFocus: true }),
    ).toBe(false);
  });

  it.each([
    ["IME composition", { isComposing: true }],
    ["a modified Escape", { shiftKey: true }],
    ["another key", { key: "Enter" }],
  ])("ignores %s", (_label, init: KeyboardEventInit) => {
    const root = conversation("<span></span>");
    const event = escapeAt(root.querySelector("span")!, init);
    expect(
      agentConversationEscapeApplies(event, { conversation: root, ownsDetachedFocus: true }),
    ).toBe(false);
  });

  it("ignores targets outside the conversation", () => {
    const root = conversation();
    const outside = document.createElement("button");
    document.body.append(outside);
    const event = escapeAt(outside);
    expect(
      agentConversationEscapeApplies(event, { conversation: root, ownsDetachedFocus: true }),
    ).toBe(false);
  });

  it("applies to body focus only while the conversation owns the last interaction", () => {
    const root = conversation();
    const event = escapeAt(document.body);
    expect(
      agentConversationEscapeApplies(event, { conversation: root, ownsDetachedFocus: true }),
    ).toBe(true);
    expect(
      agentConversationEscapeApplies(event, { conversation: root, ownsDetachedFocus: false }),
    ).toBe(false);
  });

  it.each([
    ["inert", (element: HTMLElement) => element.setAttribute("inert", "")],
    ["hidden", (element: HTMLElement) => element.setAttribute("hidden", "")],
  ])("ignores an %s conversation", (_label, hide) => {
    const root = conversation("<span></span>");
    const wrapper = document.createElement("div");
    wrapper.append(root);
    document.body.append(wrapper);
    hide(wrapper);
    const event = escapeAt(root.querySelector("span")!);
    expect(
      agentConversationEscapeApplies(event, { conversation: root, ownsDetachedFocus: true }),
    ).toBe(false);
  });

  it("ignores a detached conversation", () => {
    const root = document.createElement("div");
    const event = escapeAt(document.body);
    expect(
      agentConversationEscapeApplies(event, { conversation: root, ownsDetachedFocus: true }),
    ).toBe(false);
  });
});

describe("agentConversationEscapeAction", () => {
  it("cancels a queued-message edit before stopping the running agent", () => {
    const onCancel = vi.fn();
    const onStop = vi.fn();
    const action = agentConversationEscapeAction({
      running: true,
      onStop,
      queuedEdit: {
        threadId: "agt-1",
        lease: 1,
        prompt: "",
        attachments: [],
        onRemoveAttachment: () => undefined,
        onCancel,
        commit: async () => true,
      },
    });
    action?.();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
  });

  it("stops only a running agent", () => {
    const onStop = vi.fn();
    expect(agentConversationEscapeAction({ running: false, onStop })).toBeNull();
    agentConversationEscapeAction({ running: true, onStop })?.();
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
