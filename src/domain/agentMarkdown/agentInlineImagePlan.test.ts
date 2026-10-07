import { describe, expect, it } from "vitest";
import { MAX_AGENT_INLINE_IMAGES_PER_MESSAGE } from "./agentInlineImage";
import {
  MAX_AGENT_INLINE_IMAGE_SLOTS_PER_BLOCK,
  agentInlineImageBlockSlots,
  agentInlineImagePlan,
  isAgentInlineImageShown,
  type AgentInlineImageSlot,
} from "./agentInlineImagePlan";
import { parseAgentMarkdownImageSource } from "./agentMarkdownLink";
import type {
  AgentMarkdownBlock,
  AgentMarkdownContainerTag,
  AgentMarkdownNode,
} from "./agentMarkdownTree";

const BASE = "/workspace/app";

function text(value: string): AgentMarkdownNode {
  return { kind: "text", text: value };
}

function image(source: string, alt = ""): AgentMarkdownNode {
  return { kind: "image", alt, source: parseAgentMarkdownImageSource(source) };
}

function container(
  tag: AgentMarkdownContainerTag,
  ...children: AgentMarkdownNode[]
): AgentMarkdownNode {
  return { kind: "container", tag, children };
}

function block(...nodes: AgentMarkdownNode[]): AgentMarkdownBlock {
  return { key: "b0", nodes };
}

function slots(
  target: AgentMarkdownBlock,
  base: string | null = BASE,
): ReadonlyArray<AgentInlineImageSlot> {
  return [...agentInlineImageBlockSlots(target, base).values()];
}

describe("agentInlineImageBlockSlots", () => {
  it("gives a slot only to images that resolve to a supported local file", () => {
    const found = slots(
      block(
        container(
          "p",
          image("/abs/one.png", "One"),
          text(" "),
          image("shots/two.webp"),
          image("https://example.com/three.png", "Three"),
          image("notes/four.svg", "Four"),
          image("data:image/png;base64,AAAA", "Five"),
          image("~/six.png", "Six"),
        ),
      ),
    );

    expect(found).toEqual([
      {
        index: 0,
        path: "/abs/one.png",
        name: "One",
        alt: "One",
        layout: "inline",
        host: "flow",
      },
      {
        index: 1,
        path: `${BASE}/shots/two.webp`,
        name: "two.webp",
        alt: null,
        layout: "inline",
        host: "flow",
      },
    ]);
  });

  it("leaves a relative image unresolved without a base directory", () => {
    const target = block(container("p", image("shots/two.png"), text(" "), image("/abs/one.png")));

    expect(slots(target, null).map((slot) => slot.path)).toEqual(["/abs/one.png"]);
  });

  it("marks an image standalone when it is the only meaningful child of its host", () => {
    const paragraph = block(container("p", text("\n "), image("/a.png"), text(" ")));
    const emphasised = block(container("p", container("em", container("strong", image("/a.png")))));
    const tightItem = block({
      kind: "list",
      ordered: false,
      start: 1,
      children: [container("li", image("/a.png"))],
    });
    const looseItem = block({
      kind: "list",
      ordered: true,
      start: 1,
      children: [container("li", container("p", image("/a.png")))],
    });
    const cell = block(
      container(
        "table",
        container("tbody", {
          kind: "container",
          tag: "tr",
          children: [{ kind: "cell", header: false, align: null, children: [image("/a.png")] }],
        }),
      ),
    );
    const quoted = block(container("blockquote", container("p", image("/a.png"))));

    for (const target of [paragraph, emphasised, tightItem, looseItem, cell, quoted]) {
      expect(slots(target).map((slot) => slot.layout)).toEqual(["standalone"]);
    }
    expect(slots(cell).map((slot) => slot.host)).toEqual(["cell"]);
    expect(slots(quoted).map((slot) => slot.host)).toEqual(["flow"]);
  });

  it("keeps an image inline when it shares its host with text, a break or another image", () => {
    const sentence = block(container("p", text("See "), image("/a.png"), text(" here.")));
    const pair = block(container("p", image("/a.png"), text("\n"), image("/b.png")));
    const broken = block(container("p", image("/a.png"), { kind: "lineBreak" }));
    const emphasisedSentence = block(
      container("p", text("See "), container("em", image("/a.png"))),
    );
    const mixedEmphasis = block(container("p", container("em", image("/a.png"), text("caption"))));
    const heading = block(container("h2", image("/a.png")));
    const task = block({
      kind: "list",
      ordered: false,
      start: 1,
      children: [container("li", { kind: "checkbox", checked: false }, image("/a.png"))],
    });

    for (const target of [sentence, broken, emphasisedSentence, mixedEmphasis, heading, task]) {
      expect(slots(target).map((slot) => slot.layout)).toEqual(["inline"]);
    }
    expect(slots(pair).map((slot) => slot.layout)).toEqual(["inline", "inline"]);
  });

  it("gives no slot to an image nested in a link", () => {
    const linked = block(
      container("p", {
        kind: "link",
        target: { kind: "external", url: "https://example.com" },
        children: [image("/a.png", "Badge")],
      }),
    );

    expect(slots(linked)).toEqual([]);
  });

  it("bounds the slots of one block just past the per-message cap", () => {
    const many = block(
      container(
        "p",
        ...Array.from({ length: MAX_AGENT_INLINE_IMAGE_SLOTS_PER_BLOCK + 5 }, (_, index) =>
          image(`/shots/${index}.png`),
        ),
      ),
    );

    expect(slots(many)).toHaveLength(MAX_AGENT_INLINE_IMAGES_PER_MESSAGE + 1);
  });
});

describe("agentInlineImagePlan", () => {
  function paragraphOf(paths: ReadonlyArray<string>): AgentMarkdownBlock {
    return block(container("p", ...paths.map((path) => image(path, `alt ${path}`))));
  }

  it("offsets each block by the images before it and lists the gallery in document order", () => {
    const first = agentInlineImageBlockSlots(paragraphOf(["/a.png", "/b.png"]), BASE);
    const none = agentInlineImageBlockSlots(block(container("p", text("plain"))), BASE);
    const second = agentInlineImageBlockSlots(paragraphOf(["/a.png", "/c.png"]), BASE);

    const plan = agentInlineImagePlan([first, none, second]);

    expect(plan.blocks).toEqual([
      { slots: first, offset: 0 },
      { slots: null, offset: 0 },
      { slots: second, offset: 2 },
    ]);
    expect(plan.gallery).toEqual([
      { path: "/a.png", name: "alt /a.png" },
      { path: "/b.png", name: "alt /b.png" },
      { path: "/c.png", name: "alt /c.png" },
    ]);
    expect(plan.truncated).toBe(false);
  });

  it("shows exactly the first sixteen images and reports the rest as truncated", () => {
    const paths = (from: number, count: number): ReadonlyArray<string> =>
      Array.from({ length: count }, (_, index) => `/shots/${from + index}.png`);
    const first = agentInlineImageBlockSlots(paragraphOf(paths(0, 10)), BASE);
    const second = agentInlineImageBlockSlots(paragraphOf(paths(10, 7)), BASE);

    const exact = agentInlineImagePlan([
      first,
      agentInlineImageBlockSlots(paragraphOf(paths(10, 6)), BASE),
    ]);
    const over = agentInlineImagePlan([first, second]);

    expect(exact.truncated).toBe(false);
    expect(exact.gallery).toHaveLength(MAX_AGENT_INLINE_IMAGES_PER_MESSAGE);
    expect(over.truncated).toBe(true);
    expect(over.gallery.map((item) => item.path)).toEqual(paths(0, 16));
    const shown = [...second.values()].map((slot) =>
      isAgentInlineImageShown((over.blocks[1]?.offset ?? 0) + slot.index),
    );
    expect(shown).toEqual([true, true, true, true, true, true, false]);
  });
});
