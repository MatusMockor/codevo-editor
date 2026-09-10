// @vitest-environment jsdom

import { beforeAll, describe, expect, it, vi } from "vitest";
import type {
  AgentMarkdownRenderer,
  AgentMarkdownSourceBlock,
} from "../../domain/agentMarkdown/agentMarkdownRenderer";
import {
  MAX_AGENT_MARKDOWN_BLOCKS,
  MAX_AGENT_MARKDOWN_DEPTH,
  MAX_AGENT_MARKDOWN_NODES_PER_BLOCK,
  type AgentMarkdownNode,
} from "../../domain/agentMarkdown/agentMarkdownTree";
import {
  createAgentMarkdownRenderer,
  loadAgentMarkdownRenderer,
  peekAgentMarkdownRenderer,
  subscribeAgentMarkdownRenderer,
} from "./agentMarkdownRendererAdapter";
import { loadHardenedMarkdown, type HardenedMarkdown } from "../../domain/markdownPreview";

let renderer: AgentMarkdownRenderer;
let pipeline: HardenedMarkdown;

beforeAll(async () => {
  pipeline = await loadHardenedMarkdown();
  renderer = await loadAgentMarkdownRenderer();
});

function render(markdown: string): ReadonlyArray<AgentMarkdownNode> {
  const nodes: AgentMarkdownNode[] = [];
  for (const block of renderer.lexBlocks(markdown)) {
    const outcome = renderer.renderBlock(block);
    expect(outcome.kind).toBe("nodes");
    if (outcome.kind === "nodes") nodes.push(...outcome.nodes);
  }
  return nodes;
}

function texts(node: AgentMarkdownNode): string {
  switch (node.kind) {
    case "text":
      return node.text;
    case "codeBlock":
      return node.code;
    case "image":
      return node.alt;
    case "container":
    case "link":
    case "list":
    case "cell":
      return node.children.map(texts).join("");
    default:
      return "";
  }
}

function expectKind<K extends AgentMarkdownNode["kind"]>(
  node: AgentMarkdownNode | undefined,
  kind: K,
): Extract<AgentMarkdownNode, { kind: K }> {
  expect(node?.kind).toBe(kind);
  return node as Extract<AgentMarkdownNode, { kind: K }>;
}

function expectContainer(
  node: AgentMarkdownNode | undefined,
  tag: string,
): Extract<AgentMarkdownNode, { kind: "container" }> {
  const container = expectKind(node, "container");
  expect(container.tag).toBe(tag);
  return container;
}

function firstBlock(candidate: AgentMarkdownRenderer, markdown: string): AgentMarkdownSourceBlock {
  const block = candidate.lexBlocks(markdown)[0];
  expect(block).toBeDefined();
  return block as AgentMarkdownSourceBlock;
}

function withPipeline(overrides: Partial<HardenedMarkdown>): AgentMarkdownRenderer {
  return createAgentMarkdownRenderer({ ...pipeline, ...overrides });
}

describe("agent markdown renderer adapter", () => {
  it("exposes the loaded renderer synchronously and does not re-notify after load", async () => {
    expect(peekAgentMarkdownRenderer()).toBe(renderer);
    let notified = 0;
    const unsubscribe = subscribeAgentMarkdownRenderer(() => {
      notified += 1;
    });
    await loadAgentMarkdownRenderer();
    unsubscribe();
    expect(notified).toBe(0);
  });

  it("notifies subscribers exactly once when a fresh module instance finishes loading", async () => {
    vi.resetModules();
    const fresh = await import("./agentMarkdownRendererAdapter");
    expect(fresh.peekAgentMarkdownRenderer()).toBeNull();
    let notified = 0;
    fresh.subscribeAgentMarkdownRenderer(() => {
      notified += 1;
    });
    const loaded = await fresh.loadAgentMarkdownRenderer();
    await fresh.loadAgentMarkdownRenderer();
    expect(notified).toBe(1);
    expect(fresh.peekAgentMarkdownRenderer()).toBe(loaded);
  });

  it("sanitizes a settled document exactly once and bounds its block count", () => {
    const sanitizeToFragment = vi.fn(pipeline.sanitizeToFragment);
    const counted = withPipeline({ sanitizeToFragment });
    const outcome = counted.renderDocument("# a\n\nb\n\n- c\n\n```\nd\n```");
    expect(outcome.kind).toBe("nodes");
    expect(sanitizeToFragment).toHaveBeenCalledTimes(1);

    const blocks = Array.from({ length: MAX_AGENT_MARKDOWN_BLOCKS + 1 }, (_, i) => `p${i}`);
    expect(counted.renderDocument(blocks.join("\n\n"))).toEqual({
      kind: "unsupported",
      reason: "too-complex",
    });
    expect(sanitizeToFragment).toHaveBeenCalledTimes(1);
  });

  it("projects the exact table the owner reported", () => {
    const nodes = render("| kontrola | výsledok |\n|---|---|\n| lint | ok |");
    expect(nodes).toHaveLength(1);
    const table = expectContainer(nodes[0], "table");
    const thead = expectContainer(table.children[0], "thead");
    expectContainer(table.children[1], "tbody");
    const headerRow = expectContainer(thead.children[0], "tr");
    expect(headerRow.children).toEqual([
      { kind: "cell", header: true, align: null, children: [{ kind: "text", text: "kontrola" }] },
      { kind: "cell", header: true, align: null, children: [{ kind: "text", text: "výsledok" }] },
    ]);
  });

  it("carries column alignment and ordered list starts", () => {
    const [table] = render("| a | b |\n|:--:|--:|\n| 1 | 2 |");
    const cells: AgentMarkdownNode[] = [];
    const walk = (node: AgentMarkdownNode): void => {
      if (node.kind === "cell") cells.push(node);
      if ("children" in node) node.children.forEach(walk);
    };
    if (table !== undefined) walk(table);
    expect(cells.map((cell) => (cell.kind === "cell" ? cell.align : null))).toEqual([
      "center",
      "right",
      "center",
      "right",
    ]);

    const [list] = render("3. three\n4. four");
    expect(list).toMatchObject({ kind: "list", ordered: true, start: 3 });
  });

  it("projects headings, emphasis, inline code, blockquotes, nested lists and rules", () => {
    const nodes = render(
      "## Title\n\nSome **bold** _em_ ~~gone~~ `code` text\n\n> quoted\n\n- a\n  - nested\n- b\n\n---",
    );
    expect(nodes.map((node) => (node.kind === "container" ? node.tag : node.kind))).toEqual([
      "h2",
      "p",
      "blockquote",
      "list",
      "rule",
    ]);
    const paragraph = expectContainer(nodes[1], "p");
    expect(
      paragraph.children.map((child) => (child.kind === "container" ? child.tag : "text")),
    ).toEqual(["text", "strong", "text", "em", "text", "del", "text", "code", "text"]);
    const list = expectKind(nodes[3], "list");
    const first = expectContainer(list.children[0], "li");
    expect(first.children[first.children.length - 1]).toMatchObject({ kind: "list" });
  });

  it("projects fenced code with a validated language label", () => {
    expect(render("```ts\nconst x = 1;\n```")).toEqual([
      { kind: "codeBlock", language: "ts", code: "const x = 1;\n" },
    ]);
    expect(render("```\nplain\n```")).toEqual([
      { kind: "codeBlock", language: null, code: "plain\n" },
    ]);
    expect(render("```" + "x".repeat(40) + "\ncode\n```")[0]).toMatchObject({ language: null });
  });

  it("projects task list checkboxes and hard line breaks", () => {
    const list = expectKind(render("- [x] done\n- [ ] open")[0], "list");
    const first = expectContainer(list.children[0], "li");
    expect(first.children[0]).toEqual({ kind: "checkbox", checked: true });
    const paragraph = expectContainer(render("line one  \nline two")[0], "p");
    expect(paragraph.children[1]).toEqual({ kind: "lineBreak" });
  });

  it("escapes raw HTML instead of executing it", () => {
    const nodes = render(
      '<script>globalThis.pwned = true</script>\n\n<b onclick="x">bold</b> text',
    );
    expect(nodes.every((node) => node.kind === "container" && node.tag === "p")).toBe(true);
    expect(nodes.map(texts)).toEqual([
      "<script>globalThis.pwned = true</script>",
      '<b onclick="x">bold</b> text',
    ]);
    expect(JSON.stringify(nodes)).not.toContain('"tag":"b"');
  });

  it("strips javascript links and keeps only http(s) targets", () => {
    const paragraph = expectContainer(
      render("[bad](javascript:alert(1)) [ok](https://example.com) [file](file:///etc)")[0],
      "p",
    );
    const links = paragraph.children.filter((child) => child.kind === "link");
    expect(links.map((link) => (link.kind === "link" ? link.href : ""))).toEqual([
      null,
      "https://example.com",
      null,
    ]);
  });

  it("strips non-http image sources and keeps the alt text", () => {
    const paragraph = expectContainer(
      render(
        "![data](data:image/png;base64,AAAA) ![asset](asset://localhost/x.png) ![web](https://example.com/a.png)",
      )[0],
      "p",
    );
    const images = paragraph.children.filter((child) => child.kind === "image");
    expect(images).toEqual([
      { kind: "image", alt: "data", src: null },
      { kind: "image", alt: "asset", src: null },
      { kind: "image", alt: "web", src: "https://example.com/a.png" },
    ]);
  });

  it("removes forbidden tags even when they slip past the escaping renderer", () => {
    const hostile = withPipeline({
      renderTokens: () =>
        '<p>x<iframe src="https://e.com"></iframe><svg><script>1</script></svg><img src="https://e.com/a.png" onerror="alert(1)"></p>',
    });
    const outcome = hostile.renderBlock(firstBlock(hostile, "x"));
    expect(outcome).toEqual({
      kind: "nodes",
      nodes: [
        {
          kind: "container",
          tag: "p",
          children: [
            { kind: "text", text: "x" },
            { kind: "image", alt: "", src: "https://e.com/a.png" },
          ],
        },
      ],
    });
  });

  it("fails closed on any element outside the closed tag set", () => {
    const hostile = withPipeline({ renderTokens: () => "<p>ok</p><div>loose</div>" });
    expect(hostile.renderBlock(firstBlock(hostile, "x"))).toEqual({
      kind: "unsupported",
      reason: "unsupported",
    });

    const oddInput = withPipeline({ renderTokens: () => '<p><input type="text"></p>' });
    expect(oddInput.renderBlock(firstBlock(oddInput, "x"))).toEqual({
      kind: "unsupported",
      reason: "unsupported",
    });
  });

  it("bounds nesting depth and node count per block", () => {
    const deep = "> ".repeat(MAX_AGENT_MARKDOWN_DEPTH + 2) + "deep";
    expect(renderer.renderBlock(firstBlock(renderer, deep))).toEqual({
      kind: "unsupported",
      reason: "too-complex",
    });

    const wide = withPipeline({
      renderTokens: () => `<p>${"<em>x</em>".repeat(MAX_AGENT_MARKDOWN_NODES_PER_BLOCK)}</p>`,
    });
    expect(wide.renderBlock(firstBlock(wide, "x"))).toEqual({
      kind: "unsupported",
      reason: "too-complex",
    });
  });

  it("drops whitespace-only text between structural elements but keeps prose whitespace", () => {
    const list = expectKind(render("- a\n- b")[0], "list");
    expect(list.children.every((child) => child.kind === "container" && child.tag === "li")).toBe(
      true,
    );
    expect(texts(render("a  b")[0] as AgentMarkdownNode)).toBe("a  b");
  });

  it("renders blank tokens to nothing", () => {
    const blank = renderer.lexBlocks("a\n\nb")[1] as AgentMarkdownSourceBlock;
    expect(blank?.type).toBe("space");
    expect(renderer.renderBlock(blank)).toEqual({ kind: "nodes", nodes: [] });
  });
});
