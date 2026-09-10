import type { AgentMarkdownNode, AgentMarkdownPlainReason } from "./agentMarkdownTree";
import type { AgentMarkdownTokenShape } from "./agentMarkdownStreaming";

declare const opaqueToken: unique symbol;

export type AgentMarkdownOpaqueToken = { readonly [opaqueToken]: true };

export interface AgentMarkdownSourceBlock extends AgentMarkdownTokenShape {
  readonly token: AgentMarkdownOpaqueToken;
}

export type AgentMarkdownBlockRender =
  | { readonly kind: "nodes"; readonly nodes: ReadonlyArray<AgentMarkdownNode> }
  | {
      readonly kind: "unsupported";
      readonly reason: Extract<AgentMarkdownPlainReason, "too-complex" | "unsupported">;
    };

export interface AgentMarkdownRenderer {
  lexBlocks(markdown: string): ReadonlyArray<AgentMarkdownSourceBlock>;
  renderBlock(block: AgentMarkdownSourceBlock): AgentMarkdownBlockRender;
  renderDocument(markdown: string): AgentMarkdownBlockRender;
}
