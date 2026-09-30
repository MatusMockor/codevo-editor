import type { KeyboardEvent, MouseEvent } from "react";
import type { AgentTasksNotice } from "../../application/agentThreadPorts";
import { parseAgentArtifactPath } from "../../domain/agentArtifact";
import {
  agentLocalFileLinkDisplayPath,
  agentLocalFileLinkFailure,
  agentLocalFileLinkFailureMessage,
  agentLocalFileLinkPlace,
  type AgentLocalFileLinkFailure,
  type AgentLocalFileLinkPlace,
  type AgentLocalFileOpenOutcome,
} from "../../domain/agentMarkdown/agentLocalFileLinkFailure";
import {
  resolveAgentLocalFilePath,
  type AgentLocalFileLink,
  type AgentLocalFileLocation,
  type AgentMarkdownLink,
} from "../../domain/agentMarkdown/agentMarkdownLink";
import { agentRevealRootForPath } from "./agentThreadHeaderPresentation";

export type AgentMarkdownLinkEvent =
  MouseEvent<HTMLAnchorElement> | KeyboardEvent<HTMLAnchorElement>;

export type AgentExternalLinkOpener = (url: string) => Promise<void>;

export interface AgentLocalFileOpenRequest {
  readonly location: AgentLocalFileLocation;
  readonly root: string;
}

export interface AgentLocalFileLinkPort {
  open(request: AgentLocalFileOpenRequest): Promise<AgentLocalFileOpenOutcome>;
  report(failure: AgentLocalFileLinkFailure): void;
}

export type AgentLocalFileLinkScope =
  | {
      readonly kind: "local";
      readonly port: AgentLocalFileLinkPort;
      readonly base: string | null;
      readonly roots: ReadonlyArray<string>;
      readonly repositoryRoot: string;
    }
  | { readonly kind: "remote"; readonly port: AgentLocalFileLinkPort };

export interface AgentLocalFileLinkMemory {
  failureFor(link: AgentLocalFileLink): AgentLocalFileLinkFailure | null;
  remember(link: AgentLocalFileLink, failure: AgentLocalFileLinkFailure | null): void;
}

export type AgentUnavailableLinks = ReadonlyMap<string, AgentLocalFileLinkFailure>;

export interface AgentMarkdownLinkPorts {
  readonly openExternal: AgentExternalLinkOpener;
  readonly localFiles: AgentLocalFileLinkScope | null;
  readonly memory?: AgentLocalFileLinkMemory | null;
}

export interface AgentLocalFileLinkThread {
  readonly remote: boolean;
  readonly repositoryRoot: string;
  readonly worktreePath: string | null;
}

export function agentLocalFileLinkNotice(failure: AgentLocalFileLinkFailure): AgentTasksNotice {
  return { kind: "info", message: agentLocalFileLinkFailureMessage(failure), action: null };
}

export function agentLocalFileLinkKey(link: AgentLocalFileLink): string {
  return `${link.anchor}:${link.location.path}`;
}

export function agentLocalFileLinkScope(
  port: AgentLocalFileLinkPort | null,
  thread: AgentLocalFileLinkThread,
): AgentLocalFileLinkScope | null {
  if (port === null) return null;
  if (thread.remote) return { kind: "remote", port };
  const roots = [thread.worktreePath, thread.repositoryRoot].filter(
    (root): root is string => root !== null && root !== "",
  );
  return {
    kind: "local",
    port,
    base: roots[0] ?? null,
    roots,
    repositoryRoot: thread.repositoryRoot,
  };
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
      openLocalFileLink(event.currentTarget, link, ports.localFiles, ports.memory ?? null);
      return;
    default:
      unsupportedLink(link);
  }
}

function openLocalFileLink(
  anchor: Element,
  link: AgentLocalFileLink,
  scope: AgentLocalFileLinkScope | null,
  memory: AgentLocalFileLinkMemory | null,
): void {
  if (link.anchor === "relative" && revealAgentArtifactForLink(anchor, link.location.path)) return;
  if (scope === null) return;
  const known = memory?.failureFor(link) ?? null;
  void attemptLocalFileLink(link, scope).then((failure) => {
    memory?.remember(link, failure);
    if (failure === null || known?.kind === failure.kind) return;
    scope.port.report(failure);
  });
}

async function attemptLocalFileLink(
  link: AgentLocalFileLink,
  scope: AgentLocalFileLinkScope,
): Promise<AgentLocalFileLinkFailure | null> {
  const written = link.location.path;
  if (scope.kind === "remote") return agentLocalFileLinkFailure("remoteThread", written, null);
  const path = resolveAgentLocalFilePath(link, scope.base);
  const root = path === null ? null : agentRevealRootForPath(path, scope.roots);
  if (path === null || root === null) {
    const project = agentLocalFileLinkPlace("project", scope.repositoryRoot);
    return agentLocalFileLinkFailure("outsideProject", written, project);
  }
  const outcome = await scope.port
    .open({ location: { ...link.location, path }, root })
    .catch((): AgentLocalFileOpenOutcome => "failed");
  if (outcome === "opened") return null;
  const display = agentLocalFileLinkDisplayPath(written, path, root);
  return agentLocalFileLinkFailure(outcome, display, placeOfRoot(root, scope.repositoryRoot));
}

function placeOfRoot(root: string, repositoryRoot: string): AgentLocalFileLinkPlace {
  const kind = root === repositoryRoot.replace(/\/+$/, "") ? "project" : "worktree";
  return agentLocalFileLinkPlace(kind, root);
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
