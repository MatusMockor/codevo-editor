// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentMarkdownBlockView, type AgentMarkdownLinkActivation } from "./AgentMarkdown";

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
          onActivateLink={() => undefined}
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

describe("markdown links", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(onActivateLink: AgentMarkdownLinkActivation) {
    act(() => {
      root.render(
        <AgentMarkdownBlockView
          block={{
            key: "message",
            nodes: [
              {
                kind: "link",
                target: {
                  kind: "localFile",
                  anchor: "relative",
                  location: { path: "src/a.ts", line: 3, column: null },
                },
                children: [{ kind: "text", text: "local" }],
              },
              {
                kind: "link",
                target: { kind: "external", url: "https://example.com/" },
                children: [{ kind: "text", text: "external" }],
              },
            ],
          }}
          current={null}
          hitOffset={0}
          onActivateLink={onActivateLink}
          query=""
          textClipboard={null}
        />,
      );
    });
    return [...host.querySelectorAll<HTMLAnchorElement>("a.agent-md__link")];
  }

  it("renders local file links without a navigable href but keyboard accessible", () => {
    const [local, external] = render(() => undefined);
    expect(local!.hasAttribute("href")).toBe(false);
    expect(local!.getAttribute("role")).toBe("link");
    expect(local!.tabIndex).toBe(0);
    expect(local!.dataset.agentLink).toBe("localFile");
    expect(external!.getAttribute("href")).toBe("https://example.com/");
    expect(external!.hasAttribute("role")).toBe(false);
    expect(external!.hasAttribute("tabindex")).toBe(false);
  });

  it("activates a local file link on click and Enter only", () => {
    const activations: string[] = [];
    const [local] = render((event, link) => activations.push(`${event.type}:${link.kind}`));
    act(() => local!.click());
    act(() => {
      local!.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
      local!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(activations).toEqual(["click:localFile", "keydown:localFile"]);
  });

  it("leaves Enter on external links to the native click", () => {
    const activations: string[] = [];
    const [, external] = render((event) => activations.push(event.type));
    act(() => {
      external!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(activations).toEqual([]);
  });
});
