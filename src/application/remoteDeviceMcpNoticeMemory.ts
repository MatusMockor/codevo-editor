export const REMOTE_DEVICE_MCP_NOTICE_MEMORY_LIMIT = 64;

export type RemoteDeviceMcpNoticeOwner = Readonly<{
  serverId: string;
  runnerId: string;
  projectId: string;
}>;

export type RemoteDeviceMcpNoticeMemory = Readonly<{
  shown(owner: RemoteDeviceMcpNoticeOwner, fingerprint: string): boolean;
  remember(owner: RemoteDeviceMcpNoticeOwner, fingerprint: string | null): void;
}>;

function keyOf(owner: RemoteDeviceMcpNoticeOwner): string {
  return JSON.stringify([owner.serverId, owner.runnerId, owner.projectId]);
}

export function createRemoteDeviceMcpNoticeMemory(
  limit: number = REMOTE_DEVICE_MCP_NOTICE_MEMORY_LIMIT,
): RemoteDeviceMcpNoticeMemory {
  const fingerprints = new Map<string, string>();
  return {
    shown(owner, fingerprint) {
      return fingerprints.get(keyOf(owner)) === fingerprint;
    },
    remember(owner, fingerprint) {
      const key = keyOf(owner);
      fingerprints.delete(key);
      if (fingerprint === null) return;
      fingerprints.set(key, fingerprint);
      while (fingerprints.size > limit) {
        const oldest = fingerprints.keys().next();
        if (oldest.done === true) return;
        fingerprints.delete(oldest.value);
      }
    },
  };
}
