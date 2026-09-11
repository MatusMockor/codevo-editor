import { useCallback, useEffect, useMemo } from "react";
import {
  agentAttachmentImageKey,
  type AgentAttachmentImageRequest,
  type AgentAttachmentImagesSurface,
} from "../../application/useAgentAttachmentImages";
import type { AgentImageMime } from "../../domain/agentAttachment";
import type { AgentTurnAttachmentImagePort } from "./AgentTurnAttachments";

export interface AgentTurnAttachmentImageOwner {
  readonly workspaceId: string;
  readonly threadId: string;
}

export function useAgentTurnAttachmentImagePort(
  images: AgentAttachmentImagesSurface | null,
  reveal: ((threadId: string, attachmentId: string) => void) | null,
  owner: AgentTurnAttachmentImageOwner,
): AgentTurnAttachmentImagePort | null {
  const { threadId, workspaceId } = owner;
  const states = images?.images ?? null;
  const ensureImage = images?.ensure ?? null;
  const holdThread = images?.holdThread ?? null;

  useEffect(() => {
    if (holdThread === null) return;
    return holdThread({ workspaceId, threadId });
  }, [holdThread, threadId, workspaceId]);

  const ensure = useCallback(
    (attachmentId: string, mime: AgentImageMime): void => {
      if (ensureImage === null) return;
      const request: AgentAttachmentImageRequest = { workspaceId, threadId, attachmentId, mime };
      ensureImage(request);
    },
    [ensureImage, threadId, workspaceId],
  );
  const revealAttachment = useCallback(
    (attachmentId: string): void => {
      reveal?.(threadId, attachmentId);
    },
    [reveal, threadId],
  );

  return useMemo<AgentTurnAttachmentImagePort | null>(() => {
    if (states === null || ensureImage === null) return null;
    return {
      stateOf: (attachmentId) =>
        states.get(agentAttachmentImageKey(workspaceId, threadId, attachmentId)),
      ensure,
      reveal: revealAttachment,
    };
  }, [ensure, ensureImage, revealAttachment, states, threadId, workspaceId]);
}
