import type { AgentRegion } from "./agentRegionFailurePresentation";

export function regionFallback(host: ParentNode, region: AgentRegion): HTMLElement | null {
  return host.querySelector<HTMLElement>(`.agent-region-fallback[data-region="${region}"]`);
}

export function regionFallbackAction(
  host: ParentNode,
  region: AgentRegion,
  action: "retry" | "copy-details",
): HTMLButtonElement | null {
  return (
    regionFallback(host, region)?.querySelector<HTMLButtonElement>(
      `button[data-action="${action}"]`,
    ) ?? null
  );
}
