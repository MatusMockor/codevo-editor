import { describe, expect, it } from "vitest";
import {
  MAX_AGENT_MARKDOWN_CHARS,
  agentMarkdownBlockHighlights,
  agentMarkdownCodeText,
  agentMarkdownImageLabel,
  agentMarkdownPlainReasonLabel,
  resolveAgentMarkdownPresentation,
  type AgentMarkdownBlock,
  type AgentMarkdownNode,
  type AgentMarkdownPlainReason,
} from "./agentMarkdownTree";

function text(value: string): AgentMarkdownNode {
  return { kind: "text", text: value };
}

function paragraph(...children: AgentMarkdownNode[]): AgentMarkdownNode {
  return { kind: "container", tag: "p", children };
}

const BLOCKS: ReadonlyArray<AgentMarkdownBlock> = [
  {
    key: "b0",
    nodes: [
      paragraph(text("The parser is ready. "), {
        kind: "container",
        tag: "strong",
        children: [text("parser")],
      }),
    ],
  },
  {
    key: "b1",
    nodes: [
      {
        kind: "list",
        ordered: false,
        start: 1,
        children: [{ kind: "container", tag: "li", children: [text("parser item")] }],
      },
    ],
  },
  { key: "b2", nodes: [{ kind: "codeBlock", language: "ts", code: "const parser = 1;\n" }] },
  { key: "b3", nodes: [{ kind: "image", alt: "parser diagram", src: null }] },
  {
    key: "b4",
    nodes: [{ kind: "rule" }, { kind: "checkbox", checked: true }, { kind: "lineBreak" }],
  },
];

describe("agentMarkdownBlockHighlights", () => {
  it("counts matches in text, list items, code blocks and image labels", () => {
    const counts = BLOCKS.map((block) => agentMarkdownBlockHighlights(block, "parser"));
    expect(counts).toEqual([2, 1, 1, 1, 0]);
  });

  it("matches case-insensitively and ignores queries below the minimum", () => {
    expect(agentMarkdownBlockHighlights(BLOCKS[0] as AgentMarkdownBlock, "PARSER")).toBe(2);
    expect(agentMarkdownBlockHighlights(BLOCKS[0] as AgentMarkdownBlock, "p")).toBe(0);
  });
});

describe("resolveAgentMarkdownPresentation", () => {
  const source =
    "The parser is ready. **parser**\n\n- parser item\n\n```ts\nconst parser = 1;\n```\n\n![parser diagram](x)\n\n---\n- [x] done";

  it("reports pending while no view exists", () => {
    expect(resolveAgentMarkdownPresentation(null, source, "")).toEqual({ kind: "pending" });
  });

  it("passes plain views through unchanged", () => {
    const plain = { kind: "plain", reason: "too-long" } as const;
    expect(resolveAgentMarkdownPresentation(plain, source, "parser")).toBe(plain);
  });

  it("assigns cumulative hit offsets per block when raw and rendered counts agree", () => {
    const presentation = resolveAgentMarkdownPresentation(
      { kind: "rendered", blocks: BLOCKS },
      source,
      "parser",
    );
    expect(presentation).toEqual({
      kind: "rendered",
      blocks: BLOCKS,
      hitOffsets: [0, 2, 3, 4, 5],
      hitCount: 5,
    });
  });

  it("degrades to plain text with a truthful reason when matches hide inside syntax", () => {
    const presentation = resolveAgentMarkdownPresentation(
      { kind: "rendered", blocks: BLOCKS },
      source,
      "**",
    );
    expect(presentation).toEqual({ kind: "plain", reason: "find-syntax" });
  });

  it("never counts the fabricated image placeholder as a match", () => {
    const presentation = resolveAgentMarkdownPresentation(
      { kind: "rendered", blocks: BLOCKS },
      source,
      "diagram",
    );
    expect(presentation.kind).toBe("rendered");
    const placeholder = resolveAgentMarkdownPresentation(
      { kind: "rendered", blocks: [{ key: "b0", nodes: [{ kind: "image", alt: "", src: null }] }] },
      "[x](https://image.com) ![](https://b.com)",
      "image",
    );
    expect(placeholder).toEqual({ kind: "plain", reason: "find-syntax" });
  });

  it("skips the count comparison for an empty or too-short query", () => {
    for (const query of ["", " ", "p"]) {
      expect(
        resolveAgentMarkdownPresentation({ kind: "rendered", blocks: BLOCKS }, source, query),
      ).toEqual({ kind: "rendered", blocks: BLOCKS, hitOffsets: [0, 0, 0, 0, 0], hitCount: 0 });
    }
  });
});

describe("labels", () => {
  it("gives every plain reason a user-facing sentence", () => {
    const reasons: ReadonlyArray<AgentMarkdownPlainReason> = [
      "too-long",
      "too-complex",
      "unsupported",
      "parse-failed",
      "find-syntax",
    ];
    for (const reason of reasons) {
      expect(agentMarkdownPlainReasonLabel(reason)).toMatch(/^Shown as plain text/);
    }
    expect(agentMarkdownPlainReasonLabel("too-long")).toContain(
      MAX_AGENT_MARKDOWN_CHARS.toLocaleString("en-US"),
    );
  });

  it("labels images by their alt text and reports a missing alt as null", () => {
    expect(agentMarkdownImageLabel("  Diagram ")).toBe("Diagram");
    expect(agentMarkdownImageLabel("")).toBeNull();
  });

  it("trims exactly one trailing newline from code blocks", () => {
    expect(agentMarkdownCodeText({ kind: "codeBlock", language: null, code: "a\n\n" })).toBe("a\n");
    expect(agentMarkdownCodeText({ kind: "codeBlock", language: null, code: "a" })).toBe("a");
  });
});
