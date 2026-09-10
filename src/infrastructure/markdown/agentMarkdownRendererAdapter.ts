import type { Token } from "marked";
import type {
  AgentMarkdownBlockRender,
  AgentMarkdownOpaqueToken,
  AgentMarkdownRenderer,
  AgentMarkdownSourceBlock,
} from "../../domain/agentMarkdown/agentMarkdownRenderer";
import {
  MAX_AGENT_MARKDOWN_BLOCKS,
  MAX_AGENT_MARKDOWN_DEPTH,
  MAX_AGENT_MARKDOWN_LANGUAGE_CHARS,
  MAX_AGENT_MARKDOWN_NODES_PER_BLOCK,
  MAX_AGENT_MARKDOWN_NODES_PER_DOCUMENT,
  type AgentMarkdownAlign,
  type AgentMarkdownContainerTag,
  type AgentMarkdownNode,
} from "../../domain/agentMarkdown/agentMarkdownTree";
import {
  isSafeExternalMarkdownUrl,
  loadHardenedMarkdown,
  type HardenedMarkdown,
} from "../../domain/markdownPreview";

type ProjectionFailure = "too-complex" | "unsupported";

class ProjectionError extends Error {
  constructor(readonly reason: ProjectionFailure) {
    super(reason);
  }
}

interface ProjectionBudget {
  nodes: number;
  readonly limit: number;
}

const CONTAINER_TAGS: ReadonlySet<string> = new Set<AgentMarkdownContainerTag>([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "blockquote",
  "table",
  "thead",
  "tbody",
  "tr",
  "strong",
  "em",
  "del",
  "code",
]);
const STRUCTURAL_TAGS: ReadonlySet<string> = new Set([
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tr",
  "blockquote",
]);
const INLINE_KINDS: ReadonlySet<AgentMarkdownNode["kind"]> = new Set([
  "text",
  "link",
  "image",
  "checkbox",
  "lineBreak",
]);
const INLINE_CONTAINER_TAGS: ReadonlySet<string> = new Set(["strong", "em", "del", "code"]);
const LANGUAGE_CLASS = /^language-([A-Za-z0-9_+#.-]+)$/;
const MAX_LIST_START = 1_000_000_000;

let loading: Promise<AgentMarkdownRenderer> | null = null;
let loaded: AgentMarkdownRenderer | null = null;
const listeners = new Set<() => void>();

export function createAgentMarkdownRenderer(pipeline: HardenedMarkdown): AgentMarkdownRenderer {
  return {
    lexBlocks(markdown) {
      return pipeline.lexBlocks(markdown).map(sourceBlock);
    },
    renderBlock(block) {
      const html = pipeline.renderTokens([block.token as unknown as Token]);
      if (html === "") return { kind: "nodes", nodes: [] };
      return projectFragment(pipeline.sanitizeToFragment(html), MAX_AGENT_MARKDOWN_NODES_PER_BLOCK);
    },
    renderDocument(markdown) {
      const tokens = pipeline.lexBlocks(markdown);
      if (tokens.length > MAX_AGENT_MARKDOWN_BLOCKS) {
        return { kind: "unsupported", reason: "too-complex" };
      }
      const html = pipeline.renderTokens(tokens);
      if (html === "") return { kind: "nodes", nodes: [] };
      return projectFragment(
        pipeline.sanitizeToFragment(html),
        MAX_AGENT_MARKDOWN_NODES_PER_DOCUMENT,
      );
    },
  };
}

export function loadAgentMarkdownRenderer(): Promise<AgentMarkdownRenderer> {
  if (loading !== null) return loading;
  loading = loadHardenedMarkdown().then((pipeline) => {
    const renderer = createAgentMarkdownRenderer(pipeline);
    loaded = renderer;
    listeners.forEach((listener) => listener());
    return renderer;
  });
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

export function peekAgentMarkdownRenderer(): AgentMarkdownRenderer | null {
  return loaded;
}

export function subscribeAgentMarkdownRenderer(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function sourceBlock(token: Token): AgentMarkdownSourceBlock {
  return { type: token.type, raw: token.raw, token: token as unknown as AgentMarkdownOpaqueToken };
}

function projectFragment(fragment: DocumentFragment, limit: number): AgentMarkdownBlockRender {
  const budget: ProjectionBudget = { nodes: 0, limit };
  try {
    return { kind: "nodes", nodes: wrapLooseInline(projectChildren(fragment, 0, budget, true)) };
  } catch (error) {
    if (error instanceof ProjectionError) return { kind: "unsupported", reason: error.reason };
    throw error;
  }
}

function projectChildren(
  parent: ParentNode,
  depth: number,
  budget: ProjectionBudget,
  structural: boolean,
): ReadonlyArray<AgentMarkdownNode> {
  if (depth > MAX_AGENT_MARKDOWN_DEPTH) throw new ProjectionError("too-complex");
  const nodes: AgentMarkdownNode[] = [];
  parent.childNodes.forEach((child) => {
    const projected = projectNode(child, depth, budget, structural);
    if (projected !== null) nodes.push(projected);
  });
  return nodes;
}

function projectNode(
  node: Node,
  depth: number,
  budget: ProjectionBudget,
  structural: boolean,
): AgentMarkdownNode | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.nodeValue ?? "";
    if (structural && text.trim() === "") return null;
    return spend(budget, { kind: "text", text });
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  if (!(node instanceof Element)) return null;
  return spend(budget, projectElement(node, depth, budget));
}

function projectElement(
  element: Element,
  depth: number,
  budget: ProjectionBudget,
): AgentMarkdownNode {
  const tag = element.tagName.toLowerCase();
  const children = () => projectChildren(element, depth + 1, budget, STRUCTURAL_TAGS.has(tag));

  if (CONTAINER_TAGS.has(tag)) {
    return { kind: "container", tag: tag as AgentMarkdownContainerTag, children: children() };
  }
  switch (tag) {
    case "a":
      return { kind: "link", href: safeUrl(element.getAttribute("href")), children: children() };
    case "ul":
      return { kind: "list", ordered: false, start: 1, children: children() };
    case "ol":
      return { kind: "list", ordered: true, start: listStart(element), children: children() };
    case "th":
    case "td":
      return {
        kind: "cell",
        header: tag === "th",
        align: cellAlign(element),
        children: children(),
      };
    case "pre":
      return codeBlock(element);
    case "img":
      return {
        kind: "image",
        alt: element.getAttribute("alt") ?? "",
        src: safeUrl(element.getAttribute("src")),
      };
    case "input":
      if (element.getAttribute("type") !== "checkbox") throw new ProjectionError("unsupported");
      return { kind: "checkbox", checked: element.hasAttribute("checked") };
    case "br":
      return { kind: "lineBreak" };
    case "hr":
      return { kind: "rule" };
    default:
      throw new ProjectionError("unsupported");
  }
}

function codeBlock(pre: Element): AgentMarkdownNode {
  const code = pre.firstElementChild;
  const source = code !== null && code.tagName.toLowerCase() === "code" ? code : pre;
  return { kind: "codeBlock", language: codeLanguage(source), code: source.textContent ?? "" };
}

function codeLanguage(code: Element): string | null {
  for (const className of Array.from(code.classList)) {
    const match = LANGUAGE_CLASS.exec(className);
    if (match === null) continue;
    const language = match[1] ?? "";
    if (language === "" || language.length > MAX_AGENT_MARKDOWN_LANGUAGE_CHARS) return null;
    return language;
  }
  return null;
}

function listStart(list: Element): number {
  const raw = list.getAttribute("start");
  if (raw === null) return 1;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 1;
  return Math.min(parsed, MAX_LIST_START);
}

function cellAlign(cell: Element): AgentMarkdownAlign | null {
  const align = cell.getAttribute("align");
  if (align === "left" || align === "center" || align === "right") return align;
  return null;
}

function safeUrl(value: string | null): string | null {
  if (value === null || !isSafeExternalMarkdownUrl(value)) return null;
  return value;
}

function spend<T extends AgentMarkdownNode>(budget: ProjectionBudget, node: T): T {
  budget.nodes += 1;
  if (budget.nodes > budget.limit) throw new ProjectionError("too-complex");
  return node;
}

function wrapLooseInline(
  nodes: ReadonlyArray<AgentMarkdownNode>,
): ReadonlyArray<AgentMarkdownNode> {
  const wrapped: AgentMarkdownNode[] = [];
  let loose: AgentMarkdownNode[] = [];
  const flush = (): void => {
    const children = trimLooseRun(loose);
    loose = [];
    if (children.length === 0) return;
    wrapped.push({ kind: "container", tag: "p", children });
  };
  for (const node of nodes) {
    if (isInline(node)) {
      loose.push(node);
      continue;
    }
    flush();
    wrapped.push(node);
  }
  flush();
  return wrapped;
}

function trimLooseRun(nodes: ReadonlyArray<AgentMarkdownNode>): ReadonlyArray<AgentMarkdownNode> {
  const last = nodes[nodes.length - 1];
  if (last === undefined || last.kind !== "text") return nodes;
  const text = last.text.replace(/\n+$/, "");
  const head = nodes.slice(0, -1);
  if (text === "") return head;
  return [...head, { kind: "text", text }];
}

function isInline(node: AgentMarkdownNode): boolean {
  if (INLINE_KINDS.has(node.kind)) return true;
  return node.kind === "container" && INLINE_CONTAINER_TAGS.has(node.tag);
}
