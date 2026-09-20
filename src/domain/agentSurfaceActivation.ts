import type { AgentSurfaceKind } from "./agentWorkbenchLayout";
import type { RemoteSurfaceCapabilities } from "./remoteRunnerSurfaces";

export type AgentRemoteSurfaceKind = Exclude<AgentSurfaceKind, "diff">;

export interface AgentSurfaceActivation {
  readonly remote: boolean;
  readonly threadPresent: boolean;
  readonly remoteCapabilities: RemoteSurfaceCapabilities | null;
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

export function agentSurfaceServes(
  activation: AgentSurfaceActivation,
  kind: AgentSurfaceKind,
): boolean {
  if (!activation.remote) return true;
  if (kind === "diff") return activation.threadPresent;
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
  if (effectiveAgentSurface(activation, activeSurface) !== "files") return "none";
  return "open";
}
