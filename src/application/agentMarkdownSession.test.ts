// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentMarkdownRenderer,
  AgentMarkdownSourceBlock,
} from "../domain/agentMarkdown/agentMarkdownRenderer";
import {
  MAX_AGENT_MARKDOWN_BLOCKS,
  MAX_AGENT_MARKDOWN_CHARS,
  type AgentMarkdownNode,
  type AgentMarkdownView,
} from "../domain/agentMarkdown/agentMarkdownTree";
import { loadAgentMarkdownRenderer } from "../infrastructure/markdown/agentMarkdownRendererAdapter";
import { sharedAgentMarkdownDocumentCache } from "./agentMarkdownDocumentCache";
import { createAgentMarkdownSession } from "./agentMarkdownSession";

interface SpyRenderer extends AgentMarkdownRenderer {
  readonly lexed: string[];
  readonly rendered: string[];
  readonly documents: string[];
}

let real: AgentMarkdownRenderer;

beforeAll(async () => {
  real = await loadAgentMarkdownRenderer();
});

function spyRenderer(base: AgentMarkdownRenderer = real): SpyRenderer {
  const lexed: string[] = [];
  const rendered: string[] = [];
  const documents: string[] = [];
  return {
    lexed,
    rendered,
    documents,
    lexBlocks(markdown) {
      lexed.push(markdown);
      return base.lexBlocks(markdown);
    },
    renderBlock(block) {
      rendered.push(block.raw);
      return base.renderBlock(block);
    },
    renderDocument(markdown) {
      documents.push(markdown);
      return base.renderDocument(markdown);
    },
  };
}

function expectRendered(view: AgentMarkdownView): Extract<AgentMarkdownView, { kind: "rendered" }> {
  expect(view.kind).toBe("rendered");
  return view as Extract<AgentMarkdownView, { kind: "rendered" }>;
}

function blockKinds(view: AgentMarkdownView): ReadonlyArray<string> {
  if (view.kind !== "rendered") return [];
  return view.blocks.map((block) => block.nodes.map((node) => node.kind).join("+"));
}

function firstLink(view: AgentMarkdownView): AgentMarkdownNode | undefined {
  const paragraph = expectRendered(view).blocks[0]?.nodes[0];
  if (paragraph?.kind !== "container") return undefined;
  return paragraph.children.find((child) => child.kind === "link");
}

const DOCUMENT = [
  "# Plan",
  "",
  "First paragraph with **bold**.",
  "",
  "| kontrola | výsledok |",
  "|---|---|",
  "| lint | ok |",
  "",
  "- one",
  "- two",
  "",
  "```ts",
  "const x = 1;",
  "```",
  "",
  "Closing words.",
].join("\n");

function chunks(text: string, size: number): ReadonlyArray<string> {
  const prefixes: string[] = [];
  for (let end = size; end < text.length; end += size) prefixes.push(text.slice(0, end));
  prefixes.push(text);
  return prefixes;
}

describe("createAgentMarkdownSession", () => {
  beforeEach(() => {
    sharedAgentMarkdownDocumentCache().clear();
  });

  it("renders a settled message in one shot through the document path", () => {
    const renderer = spyRenderer();
    const view = createAgentMarkdownSession(renderer).update(DOCUMENT, false);

    expect(blockKinds(view)).toEqual([
      "container",
      "container",
      "container",
      "list",
      "codeBlock",
      "container",
    ]);
    expect(renderer.documents).toEqual([DOCUMENT]);
    expect(renderer.lexed).toEqual([]);
    expect(renderer.rendered).toEqual([]);
  });

  it("returns the identical view while text and liveness are unchanged", () => {
    const session = createAgentMarkdownSession(spyRenderer());
    const first = session.update(DOCUMENT, false);
    expect(session.update(DOCUMENT, false)).toBe(first);
    expect(session.update(DOCUMENT, true)).not.toBe(first);
  });

  it("re-lexes only the unstable tail while streaming and never re-renders committed blocks", () => {
    const renderer = spyRenderer();
    const session = createAgentMarkdownSession(renderer);
    let view: AgentMarkdownView = { kind: "plain", reason: "parse-failed" };
    for (const prefix of chunks(DOCUMENT, 7)) view = session.update(prefix, true);

    expect(view.kind).toBe("rendered");
    const lexedBytes = renderer.lexed.reduce((total, tail) => total + tail.length, 0);
    const naiveBytes = chunks(DOCUMENT, 7).reduce((total, prefix) => total + prefix.length, 0);
    expect(lexedBytes).toBeLessThan(naiveBytes / 2);
    expect(renderer.lexed[renderer.lexed.length - 1]).not.toContain("# Plan");

    const committedRaws = ["# Plan\n\n", "First paragraph with **bold**."];
    for (const raw of committedRaws) {
      expect(renderer.rendered.filter((candidate) => candidate === raw)).toHaveLength(1);
    }
  });

  it("produces the same tree as a one-shot parse once the stream settles", () => {
    const renderer = spyRenderer();
    const streamed = createAgentMarkdownSession(renderer);
    for (const prefix of chunks(DOCUMENT, 5)) streamed.update(prefix, true);
    const renderedBeforeSettle = renderer.rendered.length;
    const settled = streamed.update(DOCUMENT, false);
    const oneShot = createAgentMarkdownSession(spyRenderer()).update(DOCUMENT, false);

    expect(settled).toEqual(oneShot);
    expect(renderer.documents).toEqual([DOCUMENT]);
    expect(renderer.rendered).toHaveLength(renderedBeforeSettle);
  });

  it("keeps the streamed tree identical to the one-shot tree even before settling", () => {
    const streamed = createAgentMarkdownSession(spyRenderer());
    let live: AgentMarkdownView = { kind: "plain", reason: "parse-failed" };
    for (const prefix of chunks(DOCUMENT, 3)) live = streamed.update(prefix, true);
    const oneShot = createAgentMarkdownSession(spyRenderer()).update(DOCUMENT, false);

    expect(live).toEqual(oneShot);
  });

  it("normalizes CRLF so committed offsets never split a block", () => {
    const crlf = DOCUMENT.replace(/\n/g, "\r\n");
    const streamed = createAgentMarkdownSession(spyRenderer());
    let live: AgentMarkdownView = { kind: "plain", reason: "parse-failed" };
    for (const prefix of chunks(crlf, 4)) live = streamed.update(prefix, true);
    const oneShot = createAgentMarkdownSession(spyRenderer()).update(DOCUMENT, false);

    expect(live).toEqual(oneShot);
    expect(createAgentMarkdownSession(spyRenderer()).update(crlf, false)).toEqual(oneShot);
  });

  it("resolves reference links whose definition arrives after the paragraph was committed", () => {
    const text = "See [foo].\n\nAnother para.\n\n[foo]: https://example.com\n";
    const renderer = spyRenderer();
    const session = createAgentMarkdownSession(renderer);
    const before = session.update("See [foo].\n\nAnother para.\n\n", true);
    expect(firstLink(before)).toBeUndefined();

    const after = session.update(text, true);
    expect(firstLink(after)).toMatchObject({ kind: "link", href: "https://example.com" });

    const settled = session.update(text, false);
    expect(firstLink(settled)).toMatchObject({ kind: "link", href: "https://example.com" });
    expect(createAgentMarkdownSession(spyRenderer()).update(text, false)).toEqual(settled);
  });

  it("shows an unterminated fence as a code block without swallowing committed prose", () => {
    const session = createAgentMarkdownSession(spyRenderer());
    const view = session.update("Intro paragraph.\n\n```ts\nconst partial = ", true);

    expect(blockKinds(view)).toEqual(["container", "codeBlock"]);
    const code = expectRendered(view).blocks[1]?.nodes[0];
    expect(code).toEqual({ kind: "codeBlock", language: "ts", code: "const partial = \n" });
  });

  it("renders a streaming pipe row as a table header before its delimiter arrives", () => {
    const session = createAgentMarkdownSession(spyRenderer());
    const header = session.update("Result:\n\n| kontrola | výsledok |", true);
    expect(blockKinds(header)).toEqual(["container", "container"]);
    expect(expectRendered(header).blocks[1]?.nodes[0]).toMatchObject({
      kind: "container",
      tag: "table",
    });

    const complete = session.update(
      "Result:\n\n| kontrola | výsledok |\n|---|---|\n| lint | ok |",
      true,
    );
    expect(expectRendered(complete).blocks[1]?.nodes[0]).toMatchObject({
      kind: "container",
      tag: "table",
    });
  });

  it("promotes a pipe row that directly follows prose, and never touches a streaming fence", () => {
    const session = createAgentMarkdownSession(spyRenderer());
    const attached = session.update("Výsledky:\n| kontrola | výsledok |", true);
    expect(blockKinds(attached)).toEqual(["container", "container"]);
    expect(expectRendered(attached).blocks[1]?.nodes[0]).toMatchObject({
      kind: "container",
      tag: "table",
    });

    const fence = createAgentMarkdownSession(spyRenderer()).update("```\n| a |\n| b |", true);
    expect(expectRendered(fence).blocks[0]?.nodes[0]).toEqual({
      kind: "codeBlock",
      language: null,
      code: "| a |\n| b |\n",
    });
  });

  it("drops the committed prefix when the text is replaced rather than extended", () => {
    const renderer = spyRenderer();
    const session = createAgentMarkdownSession(renderer);
    session.update("Alpha.\n\nBeta.\n\nGamma", true);
    const replaced = session.update("Different.\n\nText", true);

    expect(blockKinds(replaced)).toEqual(["container", "container"]);
    expect(renderer.lexed[renderer.lexed.length - 1]).toBe("Different.\n\nText");
  });

  it("falls back to plain text with a truthful reason for oversized input", () => {
    const renderer = spyRenderer();
    const view = createAgentMarkdownSession(renderer).update(
      "x".repeat(MAX_AGENT_MARKDOWN_CHARS + 1),
      false,
    );
    expect(view).toEqual({ kind: "plain", reason: "too-long" });
    expect(renderer.documents).toEqual([]);
    expect(renderer.lexed).toEqual([]);
  });

  it("falls back to plain text when a message has too many blocks", () => {
    const text = Array.from({ length: MAX_AGENT_MARKDOWN_BLOCKS + 1 }, (_, i) => `p${i}`).join(
      "\n\n",
    );
    expect(createAgentMarkdownSession(spyRenderer()).update(text, false)).toEqual({
      kind: "plain",
      reason: "too-complex",
    });
    expect(createAgentMarkdownSession(spyRenderer()).update(text, true)).toEqual({
      kind: "plain",
      reason: "too-complex",
    });
  });

  it("latches a live degrade so later chunks do not re-parse the whole message", () => {
    const renderer = spyRenderer();
    const session = createAgentMarkdownSession(renderer);
    const deep = "> ".repeat(30) + "deep";
    expect(session.update(deep, true)).toEqual({ kind: "plain", reason: "too-complex" });
    const lexedAfterDegrade = renderer.lexed.length;
    const renderedAfterDegrade = renderer.rendered.length;

    expect(session.update(`${deep} more`, true)).toEqual({ kind: "plain", reason: "too-complex" });
    expect(session.update(`${deep} more text`, true)).toEqual({
      kind: "plain",
      reason: "too-complex",
    });
    expect(renderer.lexed).toHaveLength(lexedAfterDegrade);
    expect(renderer.rendered).toHaveLength(renderedAfterDegrade);

    expect(session.update("fresh text", true).kind).toBe("rendered");
  });

  it("never throws when the renderer fails and reports the failure", () => {
    const renderBlock = vi.fn<AgentMarkdownRenderer["renderBlock"]>();
    const failing: AgentMarkdownRenderer = {
      lexBlocks() {
        throw new Error("lexer exploded");
      },
      renderBlock,
      renderDocument() {
        throw new Error("document exploded");
      },
    };
    expect(createAgentMarkdownSession(failing).update("# hi", false)).toEqual({
      kind: "plain",
      reason: "parse-failed",
    });
    expect(createAgentMarkdownSession(failing).update("# hi", true)).toEqual({
      kind: "plain",
      reason: "parse-failed",
    });
    expect(renderBlock).not.toHaveBeenCalled();
  });

  it("propagates an unsupported block as a plain fallback on both paths", () => {
    const unsupported = { kind: "unsupported", reason: "unsupported" } as const;
    const renderer: AgentMarkdownRenderer = {
      lexBlocks: (markdown) => real.lexBlocks(markdown),
      renderBlock: vi.fn(() => unsupported),
      renderDocument: vi.fn(() => unsupported),
    };
    expect(createAgentMarkdownSession(renderer).update("text", false)).toEqual({
      kind: "plain",
      reason: "unsupported",
    });
    expect(createAgentMarkdownSession(renderer).update("text", true)).toEqual({
      kind: "plain",
      reason: "unsupported",
    });
  });

  it("renders blank and definition tokens to nothing without leaving holes", () => {
    const renderer = spyRenderer();
    const view = createAgentMarkdownSession(renderer).update("[ref]: https://x.y\n\nHello", false);
    expect(blockKinds(view)).toEqual(["container"]);
    const lexed: ReadonlyArray<AgentMarkdownSourceBlock> = renderer.lexBlocks("a\n\nb");
    expect(lexed.map((block) => block.type)).toEqual(["paragraph", "space", "paragraph"]);
  });
});
