import { useEffect, useMemo } from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentAttachmentImagesSurface } from "../../application/useAgentAttachmentImages";
import {
  queuedEditImageRequests,
  withQueuedEditImagePreviews,
  type AgentComposerQueuedEdit,
  type AgentQueuedEditImageRequest,
} from "./agentComposerQueuedEdit";
import { useAgentTurnAttachmentImagePort } from "./useAgentTurnAttachmentImages";

export interface AgentQueuedEditImageOwner {
  readonly workspaceId: string;
  readonly threadId: string;
}

const NO_OWNER: AgentQueuedEditImageOwner = { workspaceId: "", threadId: "" };
const NO_REQUESTS: ReadonlyArray<AgentQueuedEditImageRequest> = [];

export function queuedEditImageOwner(
  view: Pick<AgentThreadView, "thread" | "execution"> | null,
): AgentQueuedEditImageOwner | null {
  if (view === null || view.execution?.kind === "remote") return null;
  return { workspaceId: view.thread.owner.ownerId, threadId: view.thread.threadId };
}

export function useAgentQueuedEditImagePreviews(
  edit: AgentComposerQueuedEdit | null,
  images: AgentAttachmentImagesSurface | null,
  owner: AgentQueuedEditImageOwner | null,
): AgentComposerQueuedEdit | null {
  const workspaceId = owner?.workspaceId ?? "";
  const threadId = owner?.threadId ?? "";
  const owned = edit !== null && owner !== null && edit.threadId === threadId;
  const imageOwner = useMemo(
    () => (owned ? { workspaceId, threadId } : NO_OWNER),
    [owned, threadId, workspaceId],
  );
  const port = useAgentTurnAttachmentImagePort(owned ? images : null, null, imageOwner);
  const requests = useMemo(
    () => (edit === null ? NO_REQUESTS : queuedEditImageRequests(edit.attachments)),
    [edit],
  );
  const ensure = port?.ensure ?? null;
  useEffect(() => {
    if (ensure === null) return;
    for (const request of requests) ensure(request.attachmentId, request.mime);
  }, [ensure, requests]);
  const stateOf = port?.stateOf ?? null;
  return useMemo(
    () => (edit === null || stateOf === null ? edit : withQueuedEditImagePreviews(edit, stateOf)),
    [edit, stateOf],
  );
}
