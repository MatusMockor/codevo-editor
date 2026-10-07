import {
  MAX_AGENT_INLINE_IMAGES_PER_MESSAGE,
  resolveAgentInlineImageTarget,
} from "./agentInlineImage";
import {
  agentMarkdownImageLabel,
  type AgentMarkdownBlock,
  type AgentMarkdownContainerTag,
  type AgentMarkdownNode,
} from "./agentMarkdownTree";

export const MAX_AGENT_INLINE_IMAGE_SLOTS_PER_BLOCK = MAX_AGENT_INLINE_IMAGES_PER_MESSAGE + 1;

export type AgentInlineImageLayout = "standalone" | "inline";

export type AgentInlineImageHost = "flow" | "cell";

export type AgentInlineImageNode = Extract<AgentMarkdownNode, { kind: "image" }>;

export interface AgentInlineImageItem {
  readonly path: string;
  readonly name: string;
}

export interface AgentInlineImageSlot extends AgentInlineImageItem {
  readonly index: number;
  readonly alt: string | null;
  readonly layout: AgentInlineImageLayout;
  readonly host: AgentInlineImageHost;
}

export type AgentInlineImageBlockSlots = ReadonlyMap<AgentInlineImageNode, AgentInlineImageSlot>;

export interface AgentInlineImageBlockPlan {
  readonly slots: AgentInlineImageBlockSlots | null;
  readonly offset: number;
}

export interface AgentInlineImagePlan {
  readonly blocks: ReadonlyArray<AgentInlineImageBlockPlan>;
  readonly gallery: ReadonlyArray<AgentInlineImageItem>;
  readonly truncated: boolean;
}

interface Walk {
  readonly base: string | null;
  readonly slots: Map<AgentInlineImageNode, AgentInlineImageSlot>;
}

interface Position {
  readonly layout: AgentInlineImageLayout;
  readonly host: AgentInlineImageHost;
  readonly nesting: "plain" | "linked";
}

const ROOT_POSITION: Position = Object.freeze({ layout: "inline", host: "flow", nesting: "plain" });

const NO_BLOCK_PLAN: AgentInlineImageBlockPlan = Object.freeze({ slots: null, offset: 0 });

export function agentInlineImageBlockSlots(
  block: AgentMarkdownBlock,
  base: string | null,
): AgentInlineImageBlockSlots {
  const walk: Walk = { base, slots: new Map() };
  visitAll(block.nodes, walk, ROOT_POSITION);
  return walk.slots;
}

export function agentInlineImagePlan(
  blockSlots: ReadonlyArray<AgentInlineImageBlockSlots>,
): AgentInlineImagePlan {
  const blocks: AgentInlineImageBlockPlan[] = [];
  const gallery = new Map<string, AgentInlineImageItem>();
  let total = 0;
  for (const slots of blockSlots) {
    if (slots.size === 0) {
      blocks.push(NO_BLOCK_PLAN);
      continue;
    }
    blocks.push({ slots, offset: total });
    for (const slot of slots.values()) {
      if (!isAgentInlineImageShown(total + slot.index)) break;
      if (!gallery.has(slot.path)) gallery.set(slot.path, { path: slot.path, name: slot.name });
    }
    total += slots.size;
  }
  return {
    blocks,
    gallery: [...gallery.values()],
    truncated: total > MAX_AGENT_INLINE_IMAGES_PER_MESSAGE,
  };
}

export function isAgentInlineImageShown(ordinal: number): boolean {
  return ordinal < MAX_AGENT_INLINE_IMAGES_PER_MESSAGE;
}

function visitAll(nodes: ReadonlyArray<AgentMarkdownNode>, walk: Walk, position: Position): void {
  for (const node of nodes) visit(node, walk, position);
}

function visit(node: AgentMarkdownNode, walk: Walk, position: Position): void {
  switch (node.kind) {
    case "image":
      addImage(node, walk, position);
      return;
    case "container":
      visitAll(node.children, walk, {
        ...position,
        layout: containerLayout(node.tag, node.children, position.layout),
      });
      return;
    case "cell":
      visitAll(node.children, walk, {
        ...position,
        layout: hostLayout(node.children),
        host: "cell",
      });
      return;
    case "link":
      visitAll(node.children, walk, { ...position, layout: "inline", nesting: "linked" });
      return;
    case "list":
      visitAll(node.children, walk, { ...position, layout: "inline" });
      return;
    case "text":
    case "codeBlock":
    case "checkbox":
    case "lineBreak":
    case "rule":
      return;
    default:
      unsupportedNode(node);
  }
}

function addImage(node: AgentInlineImageNode, walk: Walk, position: Position): void {
  if (position.nesting === "linked") return;
  if (walk.slots.size >= MAX_AGENT_INLINE_IMAGE_SLOTS_PER_BLOCK) return;
  const target = resolveAgentInlineImageTarget(node.source, walk.base);
  if (target.kind !== "local") return;
  const alt = agentMarkdownImageLabel(node.alt);
  walk.slots.set(node, {
    index: walk.slots.size,
    path: target.path,
    name: alt ?? fileName(target.path),
    alt,
    layout: position.layout,
    host: position.host,
  });
}

function containerLayout(
  tag: AgentMarkdownContainerTag,
  children: ReadonlyArray<AgentMarkdownNode>,
  inherited: AgentInlineImageLayout,
): AgentInlineImageLayout {
  switch (tag) {
    case "p":
    case "li":
      return hostLayout(children);
    case "strong":
    case "em":
    case "del":
      return inherited === "standalone" ? hostLayout(children) : "inline";
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
    case "blockquote":
    case "table":
    case "thead":
    case "tbody":
    case "tr":
    case "code":
      return "inline";
    default:
      return unsupportedTag(tag);
  }
}

function hostLayout(children: ReadonlyArray<AgentMarkdownNode>): AgentInlineImageLayout {
  let meaningful = 0;
  for (const child of children) {
    if (child.kind === "text" && child.text.trim() === "") continue;
    meaningful += 1;
    if (meaningful > 1) return "inline";
  }
  return meaningful === 1 ? "standalone" : "inline";
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function unsupportedNode(node: never): never {
  throw new Error(`Unsupported markdown node: ${String(node)}`);
}

function unsupportedTag(tag: never): never {
  throw new Error(`Unsupported markdown container: ${String(tag)}`);
}
