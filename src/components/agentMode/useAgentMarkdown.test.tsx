// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentMarkdownRenderer } from "../../domain/agentMarkdown/agentMarkdownRenderer";
import { useAgentMarkdown, useAgentMarkdownRenderer } from "./useAgentMarkdown";

const loader = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let loaded: AgentMarkdownRenderer | null = null;
  let resolveLoad: ((renderer: AgentMarkdownRenderer) => void) | null = null;
  const pending = new Promise<AgentMarkdownRenderer>((resolve) => {
    resolveLoad = resolve;
  });
  return {
    loadCalls: 0,
    loadAgentMarkdownRenderer: vi.fn(() => {
      loader.loadCalls += 1;
      return pending;
    }),
    peekAgentMarkdownRenderer: () => loaded,
    subscribeAgentMarkdownRenderer: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    finish(renderer: AgentMarkdownRenderer) {
      loaded = renderer;
      resolveLoad?.(renderer);
      listeners.forEach((listener) => listener());
    },
  };
});

vi.mock("../../infrastructure/markdown/agentMarkdownRendererAdapter", () => ({
  loadAgentMarkdownRenderer: loader.loadAgentMarkdownRenderer,
  peekAgentMarkdownRenderer: loader.peekAgentMarkdownRenderer,
  subscribeAgentMarkdownRenderer: loader.subscribeAgentMarkdownRenderer,
}));

const renderer: AgentMarkdownRenderer = {
  lexBlocks: (markdown) => [{ type: "paragraph", raw: markdown, token: {} as never }],
  renderBlock: (block) => paragraphNodes(block.raw),
  renderDocument: (markdown) => paragraphNodes(markdown),
};

function paragraphNodes(text: string): ReturnType<AgentMarkdownRenderer["renderDocument"]> {
  return {
    kind: "nodes",
    nodes: [{ kind: "container", tag: "p", children: [{ kind: "text", text }] }],
  };
}

describe("useAgentMarkdown", () => {
  let host: HTMLDivElement;
  let root: Root;
  const seen: string[] = [];

  function Probe({ override }: { readonly override?: AgentMarkdownRenderer | null }) {
    const active = useAgentMarkdownRenderer(override);
    const presentation = useAgentMarkdown(active, "hello", false, "");
    seen.push(presentation.kind);
    return <span data-kind={presentation.kind} />;
  }

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    seen.length = 0;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("reports pending until the lazy renderer arrives, then renders without a reload", async () => {
    act(() => root.render(<Probe />));
    expect(host.querySelector("span")?.getAttribute("data-kind")).toBe("pending");
    expect(loader.loadAgentMarkdownRenderer).toHaveBeenCalledTimes(1);

    await act(async () => loader.finish(renderer));

    expect(host.querySelector("span")?.getAttribute("data-kind")).toBe("rendered");
    expect(seen).toEqual(["pending", "rendered"]);
  });

  it("prefers an injected renderer and skips the lazy load", () => {
    const calls = loader.loadCalls;
    act(() => root.render(<Probe override={renderer} />));

    expect(host.querySelector("span")?.getAttribute("data-kind")).toBe("rendered");
    expect(loader.loadCalls).toBe(calls);
  });
});
