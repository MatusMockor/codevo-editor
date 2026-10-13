export const MAX_AGENT_ATTACHMENT_DOWNLOADS = 4;

export interface AgentAttachmentDownloadLease {
  readonly threadId: string;
  readonly attachmentId: string;
}

export type AgentAttachmentDownloadAdmission =
  | { readonly kind: "started"; readonly lease: AgentAttachmentDownloadLease }
  | { readonly kind: "duplicate" }
  | { readonly kind: "full" };

export interface AgentAttachmentDownloadStore {
  subscribe(listener: () => void): () => void;
  has(threadId: string, attachmentId: string): boolean;
  begin(threadId: string, attachmentId: string): AgentAttachmentDownloadAdmission;
  settle(lease: AgentAttachmentDownloadLease): boolean;
  clear(): void;
}

export function createAgentAttachmentDownloadStore(): AgentAttachmentDownloadStore {
  const active = new Map<string, AgentAttachmentDownloadLease>();
  const listeners = new Set<() => void>();
  const publish = (): void => {
    for (const listener of [...listeners]) listener();
  };
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    has: (threadId, attachmentId) => active.has(downloadKey(threadId, attachmentId)),
    begin: (threadId, attachmentId) => {
      const key = downloadKey(threadId, attachmentId);
      if (active.has(key)) return { kind: "duplicate" };
      if (active.size >= MAX_AGENT_ATTACHMENT_DOWNLOADS) return { kind: "full" };
      const lease: AgentAttachmentDownloadLease = { threadId, attachmentId };
      active.set(key, lease);
      publish();
      return { kind: "started", lease };
    },
    settle: (lease) => {
      const key = downloadKey(lease.threadId, lease.attachmentId);
      if (active.get(key) !== lease) return false;
      active.delete(key);
      publish();
      return true;
    },
    clear: () => {
      if (active.size === 0) return;
      active.clear();
      publish();
    },
  };
}

function downloadKey(threadId: string, attachmentId: string): string {
  return JSON.stringify([threadId, attachmentId]);
}
