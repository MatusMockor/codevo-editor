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

export function remoteSurfaceSupports(
  surface: AgentRemoteSurface | null,
  kind: "files" | "history" | "terminal",
): boolean {
  return surface?.gateway !== null && surface?.gateway !== undefined && surface.capabilities[kind];
}
