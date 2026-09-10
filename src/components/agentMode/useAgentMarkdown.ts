import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createAgentMarkdownSession } from "../../application/agentMarkdownSession";
import type { AgentMarkdownRenderer } from "../../domain/agentMarkdown/agentMarkdownRenderer";
import {
  resolveAgentMarkdownPresentation,
  type AgentMarkdownPresentation,
} from "../../domain/agentMarkdown/agentMarkdownTree";
import {
  loadAgentMarkdownRenderer,
  peekAgentMarkdownRenderer,
  subscribeAgentMarkdownRenderer,
} from "../../infrastructure/markdown/agentMarkdownRendererAdapter";

function peekNothing(): null {
  return null;
}

export function useAgentMarkdownRenderer(
  override: AgentMarkdownRenderer | null | undefined,
): AgentMarkdownRenderer | null {
  const loaded = useSyncExternalStore(
    subscribeAgentMarkdownRenderer,
    peekAgentMarkdownRenderer,
    peekNothing,
  );
  const overridden = override !== undefined && override !== null;

  useEffect(() => {
    if (overridden) return;
    loadAgentMarkdownRenderer().catch(() => undefined);
  }, [overridden]);

  return override ?? loaded;
}

export function useAgentMarkdown(
  renderer: AgentMarkdownRenderer | null,
  text: string,
  live: boolean,
  query: string,
): AgentMarkdownPresentation {
  const session = useMemo(
    () => (renderer === null ? null : createAgentMarkdownSession(renderer)),
    [renderer],
  );
  const view = useMemo(() => session?.update(text, live) ?? null, [live, session, text]);
  return useMemo(() => resolveAgentMarkdownPresentation(view, text, query), [query, text, view]);
}
