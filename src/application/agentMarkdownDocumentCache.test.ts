import { describe, expect, it } from "vitest";
import type { AgentMarkdownRenderer } from "../domain/agentMarkdown/agentMarkdownRenderer";
import { MAX_AGENT_MARKDOWN_CHARS } from "../domain/agentMarkdown/agentMarkdownTree";
import {
  createAgentMarkdownDocumentCache,
  MAX_AGENT_MARKDOWN_CACHE_SOURCE_BYTES,
} from "./agentMarkdownDocumentCache";

interface CountingRenderer {
  readonly renderer: AgentMarkdownRenderer;
  documents(): number;
}

function renderer(label: string): CountingRenderer {
  let documents = 0;
  return {
    renderer: {
      lexBlocks: (markdown) => [{ type: "paragraph", raw: markdown, token: {} as never }],
      renderBlock: () => ({ kind: "nodes", nodes: [] }),
      renderDocument: (markdown) => {
        documents += 1;
        return {
          kind: "nodes",
          nodes: [
            {
              kind: "container",
              tag: "p",
              children: [{ kind: "text", text: `${label}:${markdown}` }],
            },
          ],
        };
      },
    },
    documents: () => documents,
  };
}

function firstText(view: ReturnType<ReturnType<typeof cacheFor>["read"]>): string {
  expect(view.kind).toBe("rendered");
  if (view.kind !== "rendered") return "";
  const block = view.blocks[0];
  const node = block?.nodes[0];
  if (node?.kind !== "container") return "";
  const child = node.children[0];
  return child?.kind === "text" ? child.text : "";
}

function cacheFor(capacitySourceBytes?: number) {
  return createAgentMarkdownDocumentCache(capacitySourceBytes);
}

describe("agent markdown document cache", () => {
  it("parses identical content once and serves the same view", () => {
    const cache = cacheFor();
    const counting = renderer("a");

    const first = cache.read(counting.renderer, "# Title");
    const second = cache.read(counting.renderer, "# Title");

    expect(counting.documents()).toBe(1);
    expect(second).toBe(first);
  });

  it("normalizes line endings before keying so the same content shares one entry", () => {
    const cache = cacheFor();
    const counting = renderer("a");

    cache.read(counting.renderer, "one\r\ntwo");
    const second = cache.read(counting.renderer, "one\ntwo");

    expect(counting.documents()).toBe(1);
    expect(firstText(second)).toBe("a:one\ntwo");
  });

  it("never serves an entry parsed for different content or a different renderer", () => {
    const cache = cacheFor();
    const first = renderer("first");
    const second = renderer("second");

    expect(firstText(cache.read(first.renderer, "shared"))).toBe("first:shared");
    expect(firstText(cache.read(second.renderer, "shared"))).toBe("second:shared");
    expect(firstText(cache.read(first.renderer, "other"))).toBe("first:other");
    expect(first.documents()).toBe(2);
    expect(second.documents()).toBe(1);
  });

  it("evicts the least recently used entries once the byte bound is exceeded", () => {
    const cache = cacheFor(200);
    const counting = renderer("a");
    const text = (label: string): string => label.repeat(40);

    cache.read(counting.renderer, text("a"));
    cache.read(counting.renderer, text("b"));
    cache.read(counting.renderer, text("a"));
    expect(counting.documents()).toBe(2);
    expect(cache.sourceBytes()).toBeLessThanOrEqual(200);

    cache.read(counting.renderer, text("c"));
    expect(cache.sourceBytes()).toBeLessThanOrEqual(200);

    cache.read(counting.renderer, text("a"));
    expect(counting.documents()).toBe(3);
    cache.read(counting.renderer, text("b"));
    expect(counting.documents()).toBe(4);
  });

  it("refuses to retain a document larger than the whole bound", () => {
    const cache = cacheFor(64);
    const counting = renderer("a");
    const text = "x".repeat(200);

    cache.read(counting.renderer, text);
    cache.read(counting.renderer, text);

    expect(counting.documents()).toBe(2);
    expect(cache.sourceBytes()).toBe(0);
  });

  it("caches the bounded plain outcome instead of reparsing an oversized document", () => {
    const cache = cacheFor();
    const counting = renderer("a");
    const text = "x".repeat(MAX_AGENT_MARKDOWN_CHARS + 1);

    const view = cache.read(counting.renderer, text);
    cache.read(counting.renderer, text);

    expect(view).toEqual({ kind: "plain", reason: "too-long" });
    expect(counting.documents()).toBe(0);
  });

  it("drops every entry when cleared", () => {
    const cache = cacheFor();
    const counting = renderer("a");

    cache.read(counting.renderer, "# Title");
    cache.clear();
    expect(cache.sourceBytes()).toBe(0);

    cache.read(counting.renderer, "# Title");
    expect(counting.documents()).toBe(2);
  });

  it("bounds the shared cache to one mebibyte of message source text", () => {
    expect(MAX_AGENT_MARKDOWN_CACHE_SOURCE_BYTES).toBe(1_048_576);
  });
});
