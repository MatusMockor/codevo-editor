// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentComposerCommands } from "./useAgentComposerCommands";

describe("composer command keyboard ownership", () => {
  let root: Root;
  let host: HTMLDivElement;
  const choose = vi.fn();
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    choose.mockClear();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  function Harness({ initial = "/" }: { readonly initial?: string }) {
    const [prompt, setPrompt] = useState(initial);
    const commands = useAgentComposerCommands({
      prompt,
      provider: "claudeCode",
      followUp: true,
      onChoose: (id, submit) => {
        choose(id, submit);
        if (id === "compact" && !submit) setPrompt("/compact ");
      },
    });
    return (
      <>
        <textarea
          value={prompt}
          onChange={() => undefined}
          onFocus={commands.onFocus}
          onKeyDown={commands.onKeyDown}
          onSelect={(event) => commands.onSelect(event.currentTarget)}
        />
        <output>{commands.open ? commands.rows[commands.activeIndex]?.id : "closed"}</output>
        <button onClick={commands.interceptSubmit}>Send</button>
      </>
    );
  }
  function render(initial = "/") {
    act(() => root.render(<Harness initial={initial} />));
    act(() => {
      const textarea = host.querySelector("textarea");
      textarea?.setSelectionRange(initial.length, initial.length);
      textarea?.focus();
    });
  }
  function key(key: string, options: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    act(() => host.querySelector("textarea")?.dispatchEvent(event));
    return event;
  }
  it("navigates without moving focus or submitting", () => {
    render();
    key("ArrowDown");
    expect(document.activeElement).toBe(host.querySelector("textarea"));
    expect(choose).not.toHaveBeenCalled();
    const selected = host.querySelector("output")?.textContent;
    expect(key("Tab").defaultPrevented).toBe(true);
    expect(choose).toHaveBeenCalledWith(selected, false);
  });
  it("dismisses on Escape but intercepts explicit exact command submission", () => {
    render("/model");
    key("Escape");
    expect(host.querySelector("output")?.textContent).toBe("closed");
    act(() => host.querySelector("button")?.click());
    expect(choose).toHaveBeenCalledWith("model", true);
  });
  it("leaves modified enter and IME events to the composer", () => {
    render("/model");
    expect(key("Enter", { metaKey: true }).defaultPrevented).toBe(false);
    expect(key("Enter", { isComposing: true }).defaultPrevented).toBe(false);
    expect(key("Tab", { shiftKey: true }).defaultPrevented).toBe(false);
    expect(choose).not.toHaveBeenCalled();
  });
  it("stages compact and requires a separate explicit send", () => {
    render("/compact");
    key("Enter");
    expect(choose).toHaveBeenCalledExactlyOnceWith("compact", false);
    expect(host.querySelector("textarea")?.value).toBe("/compact ");
    expect(host.querySelector("output")?.textContent).toBe("closed");
    act(() => host.querySelector("button")?.click());
    expect(choose).toHaveBeenLastCalledWith("compact", true);
  });
  it("does not intercept unknown slash commands", () => {
    render("/custom");
    expect(host.querySelector("output")?.textContent).toBe("closed");
    act(() => host.querySelector("button")?.click());
    expect(choose).not.toHaveBeenCalled();
  });
});
