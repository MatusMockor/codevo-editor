import type { AgentSurfaceKind } from "./agentWorkbenchLayout";
import { isRemoteFolderProject, type RemoteProjectKind } from "./remoteProjectKind";
import type { RemoteSurfaceCapabilities } from "./remoteRunnerSurfaces";

export const AGENT_REMOTE_SURFACE_KINDS = ["files", "history", "terminal"] as const;
export type AgentRemoteSurfaceKind = (typeof AGENT_REMOTE_SURFACE_KINDS)[number];

export function isAgentRemoteSurfaceKind(
  kind: AgentSurfaceKind | null,
): kind is AgentRemoteSurfaceKind {
  return kind !== null && (AGENT_REMOTE_SURFACE_KINDS as ReadonlyArray<string>).includes(kind);
}

export interface AgentSurfaceActivation {
  readonly remote: boolean;
  readonly threadPresent: boolean;
  readonly remoteCapabilities: RemoteSurfaceCapabilities | null;
  readonly remoteGit?: boolean;
  readonly remoteProjectKind?: RemoteProjectKind;
  readonly unavailable: boolean;
  readonly hidden: boolean;
}

export type AgentSurfaceEditorSlot = "open" | "none";

export const LOCAL_AGENT_SURFACE_ACTIVATION: AgentSurfaceActivation = {
  remote: false,
  threadPresent: true,
  remoteCapabilities: null,
  unavailable: false,
  hidden: false,
};

export function remoteSurfaceCapabilityOpen(
  capabilities: RemoteSurfaceCapabilities | null,
  kind: AgentRemoteSurfaceKind,
): boolean {
  if (capabilities === null) return false;
  return capabilities[kind];
}

export const AGENT_REMOTE_REPOSITORY_SURFACE_KINDS = ["diff", "git"] as const;
export type AgentRemoteRepositorySurfaceKind =
  (typeof AGENT_REMOTE_REPOSITORY_SURFACE_KINDS)[number];
export type AgentSurfaceUnavailability = "remoteProjectNotRepository";

export function isAgentRemoteRepositorySurfaceKind(
  kind: AgentSurfaceKind | null,
): kind is AgentRemoteRepositorySurfaceKind {
  return (
    kind !== null && (AGENT_REMOTE_REPOSITORY_SURFACE_KINDS as ReadonlyArray<string>).includes(kind)
  );
}

export function agentSurfaceUnavailability(
  activation: Pick<AgentSurfaceActivation, "remote" | "remoteProjectKind">,
  kind: AgentSurfaceKind | null,
): AgentSurfaceUnavailability | null {
  if (!activation.remote) return null;
  if (!isAgentRemoteRepositorySurfaceKind(kind)) return null;
  if (!isRemoteFolderProject({ kind: activation.remoteProjectKind })) return null;
  return "remoteProjectNotRepository";
}

export function agentSurfaceServes(
  activation: AgentSurfaceActivation,
  kind: AgentSurfaceKind,
): boolean {
  if (kind === "editor") return !activation.remote;
  if (!activation.remote) return true;
  if (agentSurfaceUnavailability(activation, kind) !== null) return false;
  if (kind === "diff" || kind === "agents") return activation.threadPresent;
  if (kind === "git") return activation.threadPresent && activation.remoteGit === true;
  if (!isAgentRemoteSurfaceKind(kind)) return false;
  return remoteSurfaceCapabilityOpen(activation.remoteCapabilities, kind);
}

export function servedAgentSurfaces(
  activation: AgentSurfaceActivation,
  openSurfaces: ReadonlyArray<AgentSurfaceKind>,
): ReadonlyArray<AgentSurfaceKind> {
  if (!activation.remote) return openSurfaces;
  return openSurfaces.filter((kind) => agentSurfaceServes(activation, kind));
}

export function effectiveAgentSurface(
  activation: AgentSurfaceActivation,
  activeSurface: AgentSurfaceKind | null,
): AgentSurfaceKind | null {
  if (activeSurface === null) return null;
  if (!agentSurfaceServes(activation, activeSurface)) return null;
  return activeSurface;
}

export function agentSurfaceEditorSlot(
  activation: AgentSurfaceActivation,
  activeSurface: AgentSurfaceKind | null,
): AgentSurfaceEditorSlot {
  if (activation.hidden) return "none";
  if (activation.unavailable) return "none";
  if (activation.remote) return "none";
  if (effectiveAgentSurface(activation, activeSurface) !== "editor") return "none";
  return "open";
}

export interface AgentSurfaceSelection {
  readonly openSurfaces: ReadonlyArray<AgentSurfaceKind>;
  readonly activeSurface: AgentSurfaceKind | null;
}

export function withoutEmptyEditorSurface(
  openSurfaces: ReadonlyArray<AgentSurfaceKind>,
  activeSurface: AgentSurfaceKind | null,
  editorHasDocuments: boolean,
): AgentSurfaceSelection {
  const editorIndex = openSurfaces.indexOf("editor");
  if (editorHasDocuments || editorIndex < 0) return { openSurfaces, activeSurface };
  const remaining = openSurfaces.filter((kind) => kind !== "editor");
  if (activeSurface !== "editor") return { openSurfaces: remaining, activeSurface };
  return {
    openSurfaces: remaining,
    activeSurface: remaining[editorIndex] ?? remaining[editorIndex - 1] ?? null,
  };
}
