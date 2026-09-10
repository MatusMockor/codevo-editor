import type { AgentMarkdownRenderer } from "../domain/agentMarkdown/agentMarkdownRenderer";
import type { AgentMarkdownView } from "../domain/agentMarkdown/agentMarkdownTree";
import { normalizeAgentMarkdownText, renderAgentMarkdownDocument } from "./agentMarkdownDocument";

export const MAX_AGENT_MARKDOWN_CACHE_SOURCE_BYTES = 1_048_576;

const BYTES_PER_CHAR = 2;
const KEY_SEPARATOR = ":";

export interface AgentMarkdownDocumentCache {
  read(renderer: AgentMarkdownRenderer, text: string): AgentMarkdownView;
  sourceBytes(): number;
  clear(): void;
}

export function createAgentMarkdownDocumentCache(
  capacitySourceBytes = MAX_AGENT_MARKDOWN_CACHE_SOURCE_BYTES,
): AgentMarkdownDocumentCache {
  const entries = new Map<string, AgentMarkdownView>();
  const renderers = new WeakMap<AgentMarkdownRenderer, number>();
  let retained = 0;
  let nextRendererId = 0;

  const identify = (renderer: AgentMarkdownRenderer): number => {
    const known = renderers.get(renderer);
    if (known !== undefined) return known;
    nextRendererId += 1;
    renderers.set(renderer, nextRendererId);
    return nextRendererId;
  };

  const evict = (): void => {
    while (retained > capacitySourceBytes) {
      const oldest = entries.keys().next();
      if (oldest.done === true) return;
      entries.delete(oldest.value);
      retained -= oldest.value.length * BYTES_PER_CHAR;
    }
  };

  const store = (key: string, view: AgentMarkdownView): void => {
    const bytes = key.length * BYTES_PER_CHAR;
    if (bytes > capacitySourceBytes) return;
    entries.set(key, view);
    retained += bytes;
    evict();
  };

  return {
    read(renderer, text) {
      const normalized = normalizeAgentMarkdownText(text);
      const key = `${identify(renderer)}${KEY_SEPARATOR}${normalized}`;
      const hit = entries.get(key);
      if (hit !== undefined) {
        entries.delete(key);
        entries.set(key, hit);
        return hit;
      }
      const view = renderAgentMarkdownDocument(renderer, normalized);
      store(key, view);
      return view;
    },
    sourceBytes() {
      return retained;
    },
    clear() {
      entries.clear();
      retained = 0;
    },
  };
}

const shared = createAgentMarkdownDocumentCache();

export function sharedAgentMarkdownDocumentCache(): AgentMarkdownDocumentCache {
  return shared;
}
