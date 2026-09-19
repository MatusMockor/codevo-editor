import type { MouseEvent } from "react";
import { parseAgentArtifactPath } from "../../domain/agentArtifact";
import { isSafeExternalMarkdownUrl } from "../../domain/markdownPreview";

export type AgentExternalLinkOpener = (url: string) => Promise<void>;

export function handleAgentMarkdownLinkClick(
  event: MouseEvent<HTMLElement>,
  openExternal: AgentExternalLinkOpener,
): void {
  if (event.button !== 0 && event.button !== 1) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const link = target.closest<HTMLAnchorElement>("a[href]");
  if (link === null) return;
  event.preventDefault();
  const href = link.getAttribute("href");
  if (href === null) return;
  if (isSafeExternalMarkdownUrl(href)) {
    void openExternal(href).catch(() => undefined);
    return;
  }
  revealAgentArtifactForLink(link, href);
}

/** Workspace-relative prose links stay inert except for jumping to this turn's own artifact. */
export function agentArtifactDisclosureForLink(link: Element, href: string): HTMLElement | null {
  const path = parseAgentArtifactPath(href);
  if (path === null) return null;
  const turn = link.closest("[data-agent-turn]");
  if (turn === null) return null;
  const matches = turn.querySelectorAll<HTMLElement>("[data-agent-artifact-path]");
  for (const candidate of matches) {
    if (candidate.dataset.agentArtifactPath === path) return candidate;
  }
  return null;
}

export function revealAgentArtifactForLink(link: Element, href: string): void {
  const disclosure = agentArtifactDisclosureForLink(link, href);
  if (disclosure === null) return;
  if (disclosure.getAttribute("aria-expanded") !== "true") disclosure.click();
  disclosure.scrollIntoView?.({ block: "nearest" });
  disclosure.focus();
}

export async function openAgentMarkdownLink(url: string): Promise<void> {
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}
