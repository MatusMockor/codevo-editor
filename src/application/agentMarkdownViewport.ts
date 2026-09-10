export const AGENT_MARKDOWN_VIEWPORT_MARGIN_PX = 1_200;

export const AGENT_MARKDOWN_VIEWPORT_ROOT_MARGIN = `${AGENT_MARKDOWN_VIEWPORT_MARGIN_PX}px 0px`;

export interface AgentMarkdownViewportBand {
  readonly top: number;
  readonly bottom: number;
}

export interface AgentMarkdownViewport {
  contains(element: Element): boolean;
  observe(element: Element, onEnter: () => void): () => void;
  remeasure(): void;
  dispose(): void;
}

export function isWithinAgentMarkdownViewport(
  element: AgentMarkdownViewportBand,
  root: AgentMarkdownViewportBand,
): boolean {
  if (element.bottom < root.top - AGENT_MARKDOWN_VIEWPORT_MARGIN_PX) return false;
  if (element.top > root.bottom + AGENT_MARKDOWN_VIEWPORT_MARGIN_PX) return false;
  return true;
}
