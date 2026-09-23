import type { KeyboardEvent, MouseEvent } from "react";
import type { AgentTasksNotice } from "../../application/agentThreadPorts";
import { parseAgentArtifactPath } from "../../domain/agentArtifact";
import {
  resolveAgentLocalFilePath,
  type AgentLocalFileLink,
  type AgentLocalFileLocation,
  type AgentMarkdownLink,
} from "../../domain/agentMarkdown/agentMarkdownLink";
import {
  AGENT_REVEAL_BLOCKED_REASON,
  agentRevealRootForPath,
} from "./agentThreadHeaderPresentation";

export type AgentMarkdownLinkEvent =
  MouseEvent<HTMLAnchorElement> | KeyboardEvent<HTMLAnchorElement>;

export type AgentExternalLinkOpener = (url: string) => Promise<void>;

export type AgentLocalFileLinkRejection = "outsideRoots" | "remoteThread";

export interface AgentLocalFileLinkPort {
  open(location: AgentLocalFileLocation): void;
  reject(reason: AgentLocalFileLinkRejection): void;
}

export type AgentLocalFileLinkScope =
  | {
      readonly kind: "local";
      readonly port: AgentLocalFileLinkPort;
      readonly base: string | null;
      readonly roots: ReadonlyArray<string>;
    }
  | { readonly kind: "remote"; readonly port: AgentLocalFileLinkPort };

export interface AgentMarkdownLinkPorts {
  readonly openExternal: AgentExternalLinkOpener;
  readonly localFiles: AgentLocalFileLinkScope | null;
}

export interface AgentLocalFileLinkThread {
  readonly remote: boolean;
  readonly repositoryRoot: string;
  readonly worktreePath: string | null;
}

export const AGENT_LOCAL_FILE_LINK_BLOCKED_NOTICE: AgentTasksNotice = Object.freeze({
  kind: "warning",
  message: AGENT_REVEAL_BLOCKED_REASON,
  action: null,
});

export const AGENT_LOCAL_FILE_LINK_REMOTE_NOTICE: AgentTasksNotice = Object.freeze({
  kind: "warning",
  message: "File links are not available for remote threads.",
  action: null,
});

export const AGENT_LOCAL_FILE_LINK_FAILED_NOTICE: AgentTasksNotice = Object.freeze({
  kind: "error",
  message: "The linked file could not be opened.",
  action: null,
});

export function agentLocalFileLinkScope(
  port: AgentLocalFileLinkPort | null,
  thread: AgentLocalFileLinkThread,
): AgentLocalFileLinkScope | null {
  if (port === null) return null;
  if (thread.remote) return { kind: "remote", port };
  const roots = [thread.worktreePath, thread.repositoryRoot].filter(
    (root): root is string => root !== null && root !== "",
  );
  return { kind: "local", port, base: roots[0] ?? null, roots };
}

export function activateAgentMarkdownLink(
  event: AgentMarkdownLinkEvent,
  link: AgentMarkdownLink,
  ports: AgentMarkdownLinkPorts,
): void {
  if ("button" in event && event.button !== 0 && event.button !== 1) return;
  switch (link.kind) {
    case "none":
      return;
    case "external":
      event.preventDefault();
      void ports.openExternal(link.url).catch(() => undefined);
      return;
    case "localFile":
      event.preventDefault();
      openLocalFileLink(event.currentTarget, link, ports.localFiles);
      return;
    default:
      unsupportedLink(link);
  }
}

function openLocalFileLink(
  anchor: Element,
  link: AgentLocalFileLink,
  scope: AgentLocalFileLinkScope | null,
): void {
  if (link.anchor === "relative" && revealAgentArtifactForLink(anchor, link.location.path)) return;
  if (scope === null) return;
  if (scope.kind === "remote") {
    scope.port.reject("remoteThread");
    return;
  }
  const path = resolveAgentLocalFilePath(link, scope.base);
  if (path === null || agentRevealRootForPath(path, scope.roots) === null) {
    scope.port.reject("outsideRoots");
    return;
  }
  scope.port.open({ ...link.location, path });
}

function agentArtifactDisclosureForLink(link: Element, path: string): HTMLElement | null {
  const artifactPath = parseAgentArtifactPath(path);
  if (artifactPath === null) return null;
  const turn = link.closest("[data-agent-turn]");
  if (turn === null) return null;
  const matches = turn.querySelectorAll<HTMLElement>("[data-agent-artifact-path]");
  for (const candidate of matches) {
    if (candidate.dataset.agentArtifactPath === artifactPath) return candidate;
  }
  return null;
}

function revealAgentArtifactForLink(link: Element, path: string): boolean {
  const disclosure = agentArtifactDisclosureForLink(link, path);
  if (disclosure === null) return false;
  if (disclosure.getAttribute("aria-expanded") !== "true") disclosure.click();
  disclosure.scrollIntoView?.({ block: "nearest" });
  disclosure.focus();
  return true;
}

function unsupportedLink(link: never): never {
  throw new Error(`Unsupported agent markdown link: ${String(link)}`);
}

export async function openAgentMarkdownLink(url: string): Promise<void> {
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}
