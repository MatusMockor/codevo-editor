import { useEffect, useMemo } from "react";
import type {
  AgentInlineImageIdentity,
  AgentInlineImageThreadOwner,
  AgentInlineImagesSurface,
} from "../../application/useAgentInlineImages";
import type { AgentProseContext } from "./AgentAssistantText";
import type { AgentThreadInlineImageViewer, AgentThreadInlineImages } from "./agentInlineImagePort";

export function useAgentThreadInlineImages(
  images: AgentInlineImagesSurface | null,
  owner: AgentInlineImageThreadOwner,
): AgentThreadInlineImages | null {
  const { threadId, workspaceId } = owner;

  useEffect(() => {
    if (images === null) return;
    return images.holdThread({ workspaceId, threadId });
  }, [images, threadId, workspaceId]);

  return useMemo<AgentThreadInlineImages | null>(() => {
    if (images === null) return null;
    return {
      subscribe: images.subscribe,
      revision: images.revision,
      forScope: (scope) => {
        const identity = (path: string): AgentInlineImageIdentity => ({
          workspaceId,
          threadId,
          scope,
          path,
        });
        return {
          subscribe: images.subscribe,
          stateOf: (path) => images.stateOf(identity(path)),
          sizeOf: (path) => images.sizeOf(identity(path)),
          ensure: (path) => images.ensure(identity(path)),
          retry: (path) => images.retry(identity(path)),
          pin: (path) => images.pin(identity(path)),
          markBroken: (path, url) => images.markBroken(identity(path), url),
          measure: (path, url, size) => images.measure(identity(path), url, size),
        };
      },
    };
  }, [images, threadId, workspaceId]);
}

export function useAgentTurnProse(
  prose: AgentProseContext,
  viewer: AgentThreadInlineImageViewer | null,
  turnId: string,
): AgentProseContext {
  return useMemo(() => {
    if (viewer === null) return prose;
    return { ...prose, inlineImages: viewer.forScope(turnId) };
  }, [prose, turnId, viewer]);
}
