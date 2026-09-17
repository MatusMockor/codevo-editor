// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentMarkdownBlockView } from "./AgentMarkdown";

describe("markdown code block wrapping", () => {
  let host: HTMLDivElement;
  let root: Root;
  const writeText = vi.fn(async () => undefined);
  const raw = '  const url = "' + "a".repeat(300) + '";\n\treturn url;\n';

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    writeText.mockClear();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(query = "") {
    act(() => {
      root.render(
        <AgentMarkdownBlockView
          block={{
            key: "message",
            nodes: [
              { kind: "codeBlock", language: null, code: raw },
              { kind: "codeBlock", language: "typescript", code: raw },
              { kind: "text", text: "return" },
            ],
          }}
          current={1}
          hitOffset={0}
          query={query}
          textClipboard={{ canWriteText: () => true, writeText }}
        />,
      );
    });
  }

  it("wraps labelled and unlabelled blocks by default and toggles each independently", () => {
    render();
    const toggles = host.querySelectorAll<HTMLButtonElement>('button[aria-label="Wrap lines"]');
    const bodies = host.querySelectorAll("pre");
    expect([...toggles].map((button) => button.getAttribute("aria-pressed"))).toEqual([
      "true",
      "true",
    ]);
    act(() => toggles[0]!.click());
    expect(bodies[0]!.getAttribute("data-wrap")).toBe("false");
    expect(bodies[1]!.getAttribute("data-wrap")).toBe("true");
    expect(toggles[0]!.title).toBe("Enable line wrap");
    render("return");
    expect(bodies[0]!.getAttribute("data-wrap")).toBe("false");
    act(() => toggles[0]!.click());
    expect(bodies[0]!.getAttribute("data-wrap")).toBe("true");
    expect(toggles[0]!.title).toBe("Disable line wrap");
    expect([...host.querySelectorAll("mark")].map((mark) => mark.dataset.hitIndex)).toEqual([
      "0",
      "1",
      "2",
    ]);
    expect(host.querySelector<HTMLElement>(".agent-find__hit--current")?.dataset.hitIndex).toBe(
      "1",
    );
  });

  it("copies the same original text with indentation and long tokens in both modes", async () => {
    render();
    const copy = host.querySelector<HTMLButtonElement>('button[aria-label="Copy code block"]')!;
    const toggle = host.querySelector<HTMLButtonElement>('button[aria-label="Wrap lines"]')!;
    await act(async () => copy.click());
    act(() => toggle.click());
    await act(async () => copy.click());
    expect(writeText.mock.calls).toEqual([[raw.slice(0, -1)], [raw.slice(0, -1)]]);
    expect(host.querySelector("pre code")!.textContent).toBe(raw.slice(0, -1));
  });
});
