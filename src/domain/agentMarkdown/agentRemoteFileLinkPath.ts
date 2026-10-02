import type { RemoteFileRevealTarget } from "../remoteFileReveal";
import { isRemoteSurfacePath } from "../remoteRunnerSurfaceValidation";
import type { AgentLocalFileLink } from "./agentMarkdownLink";

export const MAX_AGENT_REMOTE_ANCHOR_SEGMENTS = 256;

export type AgentRemoteFileLinkAnchors =
  | { readonly kind: "worktree"; readonly workspaceDirectory: string }
  | { readonly kind: "project"; readonly projectDirectory: string | null };

export type AgentRemoteFileLinkResolution =
  | { readonly kind: "server"; readonly target: RemoteFileRevealTarget }
  | { readonly kind: "checkoutRoot" }
  | { readonly kind: "absolute" }
  | { readonly kind: "unsupported" };

export const NO_AGENT_REMOTE_FILE_LINK_ANCHORS: AgentRemoteFileLinkAnchors = Object.freeze({
  kind: "project",
  projectDirectory: null,
});

const CHECKOUT_ROOT: AgentRemoteFileLinkResolution = Object.freeze({ kind: "checkoutRoot" });
const ABSOLUTE: AgentRemoteFileLinkResolution = Object.freeze({ kind: "absolute" });
const UNSUPPORTED: AgentRemoteFileLinkResolution = Object.freeze({ kind: "unsupported" });

export function resolveAgentRemoteFileLink(
  link: AgentLocalFileLink,
  anchors: AgentRemoteFileLinkAnchors,
): AgentRemoteFileLinkResolution {
  const { path, line, column } = link.location;
  if (link.anchor === "relative") return serverResolution(path, line, column);
  const remainder = anchoredRemainder(path, anchors);
  if (remainder === null) return ABSOLUTE;
  if (remainder.length === 0) return CHECKOUT_ROOT;
  const normalized = normalizedRemainder(remainder);
  if (normalized === null) return UNSUPPORTED;
  if (normalized === "") return CHECKOUT_ROOT;
  return serverResolution(normalized, line, column);
}

function serverResolution(
  path: string,
  line: number | null,
  column: number | null,
): AgentRemoteFileLinkResolution {
  if (!isRemoteSurfacePath(path)) return UNSUPPORTED;
  return { kind: "server", target: { path, line, column } };
}

function anchoredRemainder(
  path: string,
  anchors: AgentRemoteFileLinkAnchors,
): ReadonlyArray<string> | null {
  const anchor = anchorDirectory(anchors);
  if (anchor === null || anchor === "") return null;
  const segments = path.split("/").filter((segment) => segment !== "");
  if (segments.length > MAX_AGENT_REMOTE_ANCHOR_SEGMENTS) return null;
  const index = segments.indexOf(anchor);
  if (index < 0) return null;
  return segments.slice(index + 1);
}

function anchorDirectory(anchors: AgentRemoteFileLinkAnchors): string | null {
  switch (anchors.kind) {
    case "worktree":
      return anchors.workspaceDirectory;
    case "project":
      return anchors.projectDirectory;
    default:
      return unsupportedAnchors(anchors);
  }
}

function unsupportedAnchors(anchors: never): never {
  throw new Error(`Unsupported remote file link anchors: ${String(anchors)}`);
}

function normalizedRemainder(segments: ReadonlyArray<string>): string | null {
  const kept: string[] = [];
  for (const segment of segments) {
    if (segment === ".") continue;
    if (segment !== "..") {
      kept.push(segment);
      continue;
    }
    if (kept.length === 0) return null;
    kept.pop();
  }
  return kept.join("/");
}
