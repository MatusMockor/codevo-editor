import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { AgentAttachmentDownloadsSurface } from "./useAgentAttachmentDownloads";

export interface AgentTurnAttachmentFilePort {
  subscribe(listener: () => void): () => void;
  isDownloading(attachmentId: string): boolean;
  download(attachmentId: string): void;
}

export interface AgentTurnAttachmentDownload {
  readonly downloading: boolean;
  start(): void;
}

export const AgentTurnAttachmentFilesContext = createContext<AgentTurnAttachmentFilePort | null>(
  null,
);

export function useAgentTurnAttachmentFilePort(
  downloads: AgentAttachmentDownloadsSurface | null,
  threadId: string,
): AgentTurnAttachmentFilePort | null {
  return useMemo<AgentTurnAttachmentFilePort | null>(() => {
    if (downloads === null) return null;
    return {
      subscribe: downloads.subscribe,
      isDownloading: (attachmentId) => downloads.isDownloading(threadId, attachmentId),
      download: (attachmentId) => downloads.download(threadId, attachmentId),
    };
  }, [downloads, threadId]);
}

export function useAgentTurnAttachmentDownload(
  attachmentId: string,
): AgentTurnAttachmentDownload | null {
  const files = useContext(AgentTurnAttachmentFilesContext);
  const downloading = useSyncExternalStore(files?.subscribe ?? subscribeToNothing, () =>
    files === null ? false : files.isDownloading(attachmentId),
  );
  return useMemo<AgentTurnAttachmentDownload | null>(() => {
    if (files === null) return null;
    return { downloading, start: () => files.download(attachmentId) };
  }, [attachmentId, downloading, files]);
}

function subscribeToNothing(): () => void {
  return ignore;
}

function ignore(): void {}
