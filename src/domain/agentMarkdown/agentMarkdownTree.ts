import { highlightNeedle, highlightOccurrences } from "../agentThreadHighlight";

export const MAX_AGENT_MARKDOWN_CHARS = 32_768;
export const MAX_AGENT_MARKDOWN_BLOCKS = 1_024;
export const MAX_AGENT_MARKDOWN_NODES_PER_BLOCK = 8_192;
export const MAX_AGENT_MARKDOWN_NODES_PER_DOCUMENT = 65_536;
export const MAX_AGENT_MARKDOWN_DEPTH = 24;
export const MAX_AGENT_MARKDOWN_LANGUAGE_CHARS = 32;

export type AgentMarkdownContainerTag =
  | "p"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "li"
  | "blockquote"
  | "table"
  | "thead"
  | "tbody"
  | "tr"
  | "strong"
  | "em"
  | "del"
  | "code";

export type AgentMarkdownAlign = "left" | "center" | "right";

export type AgentMarkdownNode =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "container";
      readonly tag: AgentMarkdownContainerTag;
      readonly children: ReadonlyArray<AgentMarkdownNode>;
    }
  | {
      readonly kind: "link";
      readonly href: string | null;
      readonly children: ReadonlyArray<AgentMarkdownNode>;
    }
  | {
      readonly kind: "list";
      readonly ordered: boolean;
      readonly start: number;
      readonly children: ReadonlyArray<AgentMarkdownNode>;
    }
  | {
      readonly kind: "cell";
      readonly header: boolean;
      readonly align: AgentMarkdownAlign | null;
      readonly children: ReadonlyArray<AgentMarkdownNode>;
    }
  | { readonly kind: "codeBlock"; readonly language: string | null; readonly code: string }
  | { readonly kind: "image"; readonly alt: string; readonly src: string | null }
  | { readonly kind: "checkbox"; readonly checked: boolean }
  | { readonly kind: "lineBreak" }
  | { readonly kind: "rule" };

export interface AgentMarkdownBlock {
  readonly key: string;
  readonly nodes: ReadonlyArray<AgentMarkdownNode>;
}

export type AgentMarkdownPlainReason =
  | "too-long"
  | "too-complex"
  | "unsupported"
  | "parse-failed"
  | "find-syntax"
  | "renderer-unavailable";

export type AgentMarkdownView =
  | { readonly kind: "rendered"; readonly blocks: ReadonlyArray<AgentMarkdownBlock> }
  | { readonly kind: "plain"; readonly reason: AgentMarkdownPlainReason };

export type AgentMarkdownPresentation =
  | {
      readonly kind: "rendered";
      readonly blocks: ReadonlyArray<AgentMarkdownBlock>;
      readonly hitOffsets: ReadonlyArray<number>;
      readonly hitCount: number;
    }
  | { readonly kind: "plain"; readonly reason: AgentMarkdownPlainReason }
  | { readonly kind: "pending" }
  | { readonly kind: "deferred" };

export function appendAgentMarkdownBlock(
  blocks: AgentMarkdownBlock[],
  nodes: ReadonlyArray<AgentMarkdownNode>,
): void {
  if (nodes.length === 0) return;
  blocks.push({ key: `b${blocks.length}`, nodes });
}

export function agentMarkdownPlainReasonLabel(reason: AgentMarkdownPlainReason): string {
  switch (reason) {
    case "too-long":
      return `Shown as plain text: the response is longer than ${MAX_AGENT_MARKDOWN_CHARS.toLocaleString("en-US")} characters, the limit for formatting.`;
    case "too-complex":
      return "Shown as plain text: the response is too large or too deeply nested to format.";
    case "unsupported":
      return "Shown as plain text: the response contains formatting that cannot be displayed safely.";
    case "parse-failed":
      return "Shown as plain text: the response could not be formatted.";
    case "find-syntax":
      return "Shown as plain text while searching: some matches sit inside Markdown formatting.";
    case "renderer-unavailable":
      return "Shown as plain text: formatting could not be loaded.";
    default:
      return unsupportedReason(reason);
  }
}

export function agentMarkdownCodeText(
  node: Extract<AgentMarkdownNode, { kind: "codeBlock" }>,
): string {
  return node.code.endsWith("\n") ? node.code.slice(0, -1) : node.code;
}

export const AGENT_MARKDOWN_IMAGE_PLACEHOLDER = "image";

export function agentMarkdownImageLabel(alt: string): string | null {
  const trimmed = alt.trim();
  return trimmed === "" ? null : trimmed;
}

export function agentMarkdownNodeHighlights(node: AgentMarkdownNode, query: string): number {
  switch (node.kind) {
    case "text":
      return highlightOccurrences(node.text, query);
    case "codeBlock":
      return highlightOccurrences(agentMarkdownCodeText(node), query);
    case "image":
      return highlightOccurrences(agentMarkdownImageLabel(node.alt) ?? "", query);
    case "container":
    case "link":
    case "list":
    case "cell":
      return childHighlights(node.children, query);
    case "checkbox":
    case "lineBreak":
    case "rule":
      return 0;
    default:
      return unsupportedNode(node);
  }
}

export function agentMarkdownBlockHighlights(block: AgentMarkdownBlock, query: string): number {
  return childHighlights(block.nodes, query);
}

export function resolveAgentMarkdownPresentation(
  view: AgentMarkdownView | null,
  text: string,
  query: string,
): AgentMarkdownPresentation {
  if (view === null) return { kind: "pending" };
  if (view.kind === "plain") return view;
  const needle = highlightNeedle(query);
  if (needle === null) {
    return {
      kind: "rendered",
      blocks: view.blocks,
      hitOffsets: view.blocks.map(() => 0),
      hitCount: 0,
    };
  }

  const hitOffsets: number[] = [];
  let hitCount = 0;
  for (const block of view.blocks) {
    hitOffsets.push(hitCount);
    hitCount += agentMarkdownBlockHighlights(block, query);
  }
  if (hitCount !== highlightOccurrences(text, query)) {
    return { kind: "plain", reason: "find-syntax" };
  }
  return { kind: "rendered", blocks: view.blocks, hitOffsets, hitCount };
}

function childHighlights(children: ReadonlyArray<AgentMarkdownNode>, query: string): number {
  let total = 0;
  for (const child of children) total += agentMarkdownNodeHighlights(child, query);
  return total;
}

function unsupportedReason(reason: never): never {
  throw new Error(`Unsupported markdown plain reason: ${String(reason)}`);
}

function unsupportedNode(node: never): never {
  throw new Error(`Unsupported markdown node: ${String(node)}`);
}
