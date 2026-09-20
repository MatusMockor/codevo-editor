import {
  remoteSurfaceCapabilityOpen,
  type AgentRemoteSurfaceKind,
} from "../../domain/agentSurfaceActivation";
import type {
  RemoteRunnerSurfacesGateway,
  RemoteSurfaceCapabilities,
  RemoteSurfaceScope,
} from "../../domain/remoteRunnerSurfaces";

/** Display authority stays separate from local workspace chrome. */
export interface AgentRemoteSurface {
  readonly paneKey: string;
  readonly scope: RemoteSurfaceScope;
  readonly gateway: RemoteRunnerSurfacesGateway | null;
  readonly capabilities: RemoteSurfaceCapabilities;
  readonly message?: string | null;
}

export function remoteSurfaceCapabilities(
  surface: AgentRemoteSurface | null | undefined,
): RemoteSurfaceCapabilities | null {
  if (surface === null || surface === undefined) return null;
  if (surface.gateway === null) return null;
  return surface.capabilities;
}

export function remoteSurfaceSupports(
  surface: AgentRemoteSurface | null | undefined,
  kind: AgentRemoteSurfaceKind,
): boolean {
  return remoteSurfaceCapabilityOpen(remoteSurfaceCapabilities(surface), kind);
}
