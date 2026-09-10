import type { MouseEvent } from "react";
import { isSafeExternalMarkdownUrl } from "../../domain/markdownPreview";

export type AgentExternalLinkOpener = (url: string) => Promise<void>;

export function handleAgentMarkdownLinkClick(
  event: MouseEvent<HTMLElement>,
  openExternal: AgentExternalLinkOpener,
): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const link = target.closest<HTMLAnchorElement>("a[href]");
  if (link === null) return;
  event.preventDefault();
  const href = link.getAttribute("href");
  if (href === null || !isSafeExternalMarkdownUrl(href)) return;
  void openExternal(href).catch(() => undefined);
}

export async function openAgentMarkdownLink(url: string): Promise<void> {
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}
