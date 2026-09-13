import { useMemo } from "react";
import type { AgentAttachmentImagesSurface } from "./useAgentAttachmentImages";
import { isRemoteAgentIdentity } from "./remoteAgentSurface";

/** Hold/release identity must not change when an image read publishes its result. */
export function useRemoteAgentImages(
  local: AgentAttachmentImagesSurface,
  remote: AgentAttachmentImagesSurface,
): AgentAttachmentImagesSurface {
  const { ensure: localEnsure, holdThread: localHold, releaseWorkspace: localRelease } = local;
  const { ensure: remoteEnsure, holdThread: remoteHold, releaseWorkspace: remoteRelease } = remote;
  const methods = useMemo(
    () => ({
      ensure: (request: Parameters<AgentAttachmentImagesSurface["ensure"]>[0]) =>
        isRemoteAgentIdentity(request.workspaceId) ? remoteEnsure(request) : localEnsure(request),
      holdThread: (request: Parameters<AgentAttachmentImagesSurface["holdThread"]>[0]) =>
        isRemoteAgentIdentity(request.workspaceId) ? remoteHold(request) : localHold(request),
      releaseWorkspace: (id: string) => {
        if (isRemoteAgentIdentity(id)) remoteRelease(id);
        else localRelease(id);
      },
    }),
    [localEnsure, localHold, localRelease, remoteEnsure, remoteHold, remoteRelease],
  );
  return useMemo(
    () => ({
      ...methods,
      images: new Map([...local.images, ...remote.images]),
      capacityReached: local.capacityReached || remote.capacityReached,
    }),
    [methods, local.images, remote.images, local.capacityReached, remote.capacityReached],
  );
}
