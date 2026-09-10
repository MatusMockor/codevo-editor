import type {
  AgentMarkdownRenderer,
  AgentMarkdownSourceBlock,
} from "../domain/agentMarkdown/agentMarkdownRenderer";
import {
  committableBlockCount,
  stabilizeStreamingMarkdownTail,
} from "../domain/agentMarkdown/agentMarkdownStreaming";
import {
  MAX_AGENT_MARKDOWN_BLOCKS,
  MAX_AGENT_MARKDOWN_CHARS,
  appendAgentMarkdownBlock,
  type AgentMarkdownBlock,
  type AgentMarkdownNode,
  type AgentMarkdownPlainReason,
  type AgentMarkdownView,
} from "../domain/agentMarkdown/agentMarkdownTree";
import { normalizeAgentMarkdownText } from "./agentMarkdownDocument";
import {
  sharedAgentMarkdownDocumentCache,
  type AgentMarkdownDocumentCache,
} from "./agentMarkdownDocumentCache";

export interface AgentMarkdownSession {
  update(text: string, live: boolean): AgentMarkdownView;
}

interface Committed {
  readonly blocks: ReadonlyArray<AgentMarkdownBlock>;
  readonly raw: string;
}

interface Degraded {
  readonly text: string;
  readonly reason: AgentMarkdownPlainReason;
}

interface LastUpdate {
  readonly text: string;
  readonly live: boolean;
  readonly view: AgentMarkdownView;
}

type BlockOutcome =
  | { readonly kind: "nodes"; readonly nodes: ReadonlyArray<AgentMarkdownNode> }
  | { readonly kind: "plain"; readonly reason: AgentMarkdownPlainReason };

const NO_COMMIT: Committed = { blocks: [], raw: "" };
const CACHE_KEY_SEPARATOR = " ";
const CACHE_CAPACITY_CHARS = MAX_AGENT_MARKDOWN_CHARS * 4;
const PARAGRAPH_TOKEN_TYPE = "paragraph";
const DEFINITION_TOKEN_TYPE = "def";

class CommittedBlockCache {
  private readonly entries = new Map<string, ReadonlyArray<AgentMarkdownNode>>();
  private chars = 0;

  get(key: string): ReadonlyArray<AgentMarkdownNode> | undefined {
    return this.entries.get(key);
  }

  set(key: string, nodes: ReadonlyArray<AgentMarkdownNode>): void {
    if (key.length > CACHE_CAPACITY_CHARS) return;
    while (this.chars + key.length > CACHE_CAPACITY_CHARS) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
      this.chars -= oldest.value.length;
    }
    this.entries.set(key, nodes);
    this.chars += key.length;
  }
}

export function createAgentMarkdownSession(
  renderer: AgentMarkdownRenderer,
  documents: AgentMarkdownDocumentCache = sharedAgentMarkdownDocumentCache(),
): AgentMarkdownSession {
  const cache = new CommittedBlockCache();
  let committed: Committed = NO_COMMIT;
  let degraded: Degraded | null = null;
  let last: LastUpdate | null = null;

  const plain = (text: string, reason: AgentMarkdownPlainReason): AgentMarkdownView => {
    committed = NO_COMMIT;
    degraded = { text, reason };
    return { kind: "plain", reason };
  };

  const renderFresh = (block: AgentMarkdownSourceBlock): BlockOutcome => {
    const rendered = renderer.renderBlock(block);
    if (rendered.kind === "unsupported") return { kind: "plain", reason: rendered.reason };
    return { kind: "nodes", nodes: rendered.nodes };
  };

  const renderCommitted = (block: AgentMarkdownSourceBlock): BlockOutcome => {
    const key = `${block.type}${CACHE_KEY_SEPARATOR}${block.raw}`;
    const hit = cache.get(key);
    if (hit !== undefined) return { kind: "nodes", nodes: hit };
    const outcome = renderFresh(block);
    if (outcome.kind === "nodes") cache.set(key, outcome.nodes);
    return outcome;
  };

  const renderSettled = (text: string): AgentMarkdownView => {
    const view = documents.read(renderer, text);
    if (view.kind === "plain") return plain(text, view.reason);
    committed = { blocks: view.blocks, raw: text };
    return view;
  };

  const renderLiveTokens = (
    text: string,
    blocks: AgentMarkdownBlock[],
    live: ReadonlyArray<AgentMarkdownSourceBlock>,
  ): AgentMarkdownView => {
    for (const token of stabilizedLiveTokens(renderer, live)) {
      const outcome = renderFresh(token);
      if (outcome.kind === "plain") return plain(text, outcome.reason);
      appendAgentMarkdownBlock(blocks, outcome.nodes);
    }
    return { kind: "rendered", blocks };
  };

  const renderLive = (text: string): AgentMarkdownView => {
    if (!text.startsWith(committed.raw)) committed = NO_COMMIT;
    const tail = text.slice(committed.raw.length);
    const tokens = renderer.lexBlocks(tail);
    if (committed.blocks.length + tokens.length > MAX_AGENT_MARKDOWN_BLOCKS) {
      return plain(text, "too-complex");
    }
    if (tokens.some((token) => token.type === DEFINITION_TOKEN_TYPE)) {
      committed = NO_COMMIT;
      const whole = tail === text ? tokens : renderer.lexBlocks(text);
      return renderLiveTokens(text, [], whole);
    }

    const blocks: AgentMarkdownBlock[] = [...committed.blocks];
    const commitCount = committableBlockCount(tokens);
    let consumed = 0;
    for (let index = 0; index < commitCount; index += 1) {
      const token = tokens[index];
      if (token === undefined) break;
      const outcome = renderCommitted(token);
      if (outcome.kind === "plain") return plain(text, outcome.reason);
      appendAgentMarkdownBlock(blocks, outcome.nodes);
      consumed += token.raw.length;
    }
    committed = { blocks: blocks.slice(), raw: committed.raw + tail.slice(0, consumed) };
    return renderLiveTokens(text, blocks, tokens.slice(commitCount));
  };

  const compute = (text: string, live: boolean): AgentMarkdownView => {
    if (text.length > MAX_AGENT_MARKDOWN_CHARS) return plain(text, "too-long");
    if (degraded !== null && live && text.startsWith(degraded.text)) {
      return { kind: "plain", reason: degraded.reason };
    }
    degraded = null;
    try {
      return live ? renderLive(text) : renderSettled(text);
    } catch {
      return plain(text, "parse-failed");
    }
  };

  return {
    update(text, live) {
      if (last !== null && last.text === text && last.live === live) return last.view;
      const view = compute(normalizeAgentMarkdownText(text), live);
      last = { text, live, view };
      return view;
    },
  };
}

function stabilizedLiveTokens(
  renderer: AgentMarkdownRenderer,
  live: ReadonlyArray<AgentMarkdownSourceBlock>,
): ReadonlyArray<AgentMarkdownSourceBlock> {
  const last = live.length - 1;
  const paragraph = live[last];
  if (paragraph === undefined || paragraph.type !== PARAGRAPH_TOKEN_TYPE) return live;
  const stabilized = stabilizeStreamingMarkdownTail(paragraph.raw);
  if (stabilized === paragraph.raw) return live;
  return [...live.slice(0, last), ...renderer.lexBlocks(stabilized)];
}
