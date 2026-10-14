import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentTasksNotice, AgentThreadsSurface } from "../../application/agentThreadPorts";
import { remoteAgentNotice } from "../../application/remoteAgentSurface";
import { REMOTE_ATTACHMENT_DOWNLOAD_FAILED } from "../../application/remoteAttachmentDownload";
import { remoteRunnerErrorMessage } from "../../domain/remoteRunnerErrors";
import { createAgentAttachmentDownloadStore } from "./agentAttachmentDownloadStore";

export const AGENT_ATTACHMENT_DOWNLOADS_FULL_MESSAGE =
  "Too many downloads are in progress. Wait for one to finish.";

export interface AgentAttachmentDownloadsSurface {
  subscribe(listener: () => void): () => void;
  isDownloading(threadId: string, attachmentId: string): boolean;
  download(threadId: string, attachmentId: string): void;
}

export interface AgentAttachmentDownloadsOptions {
  readonly download: AgentThreadsSurface["downloadAttachment"];
  readonly reportNotice: (notice: AgentTasksNotice) => void;
}

export function agentAttachmentDownloadFailureNotice(error: unknown): AgentTasksNotice {
  return remoteAgentNotice(remoteRunnerErrorMessage(error, REMOTE_ATTACHMENT_DOWNLOAD_FAILED));
}

export function useAgentAttachmentDownloads(
  options: AgentAttachmentDownloadsOptions,
): AgentAttachmentDownloadsSurface {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  const [store] = useState(createAgentAttachmentDownloadStore);
  useEffect(() => () => store.clear(), [store]);

  return useMemo<AgentAttachmentDownloadsSurface>(
    () => ({
      subscribe: store.subscribe,
      isDownloading: store.has,
      download: (threadId, attachmentId) => {
        const { download, reportNotice } = latest.current;
        const admission = store.begin(threadId, attachmentId);
        if (admission.kind === "duplicate") return;
        if (admission.kind === "full") {
          reportNotice(remoteAgentNotice(AGENT_ATTACHMENT_DOWNLOADS_FULL_MESSAGE));
          return;
        }
        const lease = admission.lease;
        const started = (async () => download(lease.threadId, lease.attachmentId))();
        void started.then(
          () => {
            store.settle(lease);
          },
          (error: unknown) => {
            if (!store.settle(lease)) return;
            reportNotice(agentAttachmentDownloadFailureNotice(error));
          },
        );
      },
    }),
    [store],
  );
}
