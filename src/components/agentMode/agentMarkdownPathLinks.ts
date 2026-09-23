import {
  resolveAgentLocalFilePath,
  type AgentLocalFileLink,
} from "../../domain/agentMarkdown/agentMarkdownLink";
import type { AgentLocalFileLinkScope } from "./agentMarkdownLinks";
import { agentRevealRootForPath } from "./agentThreadHeaderPresentation";

export const MAX_AGENT_PATH_LINKS_PER_BLOCK = 24;
export const MAX_AGENT_PATH_SCAN_CHARS_PER_BLOCK = 16_384;

export interface AgentMarkdownPathLinks {
  accepts(link: AgentLocalFileLink): boolean;
}

export function agentMarkdownPathLinks(
  scope: AgentLocalFileLinkScope | null,
): AgentMarkdownPathLinks | null {
  if (scope === null || scope.kind !== "local" || scope.base === null) return null;
  const { base, roots } = scope;
  return {
    accepts(link) {
      const path = resolveAgentLocalFilePath(link, base);
      return path !== null && agentRevealRootForPath(path, roots) !== null;
    },
  };
}
