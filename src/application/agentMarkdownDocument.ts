import type { AgentMarkdownRenderer } from "../domain/agentMarkdown/agentMarkdownRenderer";
import {
  MAX_AGENT_MARKDOWN_CHARS,
  appendAgentMarkdownBlock,
  type AgentMarkdownBlock,
  type AgentMarkdownView,
} from "../domain/agentMarkdown/agentMarkdownTree";

const LINE_BREAKS = /\r\n?/g;

export function normalizeAgentMarkdownText(text: string): string {
  return text.replace(LINE_BREAKS, "\n");
}

export function renderAgentMarkdownDocument(
  renderer: AgentMarkdownRenderer,
  text: string,
): AgentMarkdownView {
  if (text.length > MAX_AGENT_MARKDOWN_CHARS) return { kind: "plain", reason: "too-long" };
  try {
    const rendered = renderer.renderDocument(text);
    if (rendered.kind === "unsupported") return { kind: "plain", reason: rendered.reason };
    const blocks: AgentMarkdownBlock[] = [];
    for (const node of rendered.nodes) appendAgentMarkdownBlock(blocks, [node]);
    return { kind: "rendered", blocks };
  } catch {
    return { kind: "plain", reason: "parse-failed" };
  }
}
