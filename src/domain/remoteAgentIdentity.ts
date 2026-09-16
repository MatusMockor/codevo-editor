/** Parses the canonical persisted identity; it grants no runner authority. */
export function parseRemoteAgentThreadIdentity(value: string | null): {
  readonly serverId: string;
  readonly runnerId: string;
  readonly conversationId: string;
} | null {
  if (value === null || value.length > 4096) return null;
  const parts = value.split(":");
  if (parts.length !== 4 || parts[0] !== "remote-thread") return null;
  try {
    const decoded = parts.slice(1).map(decodeURIComponent);
    if (decoded.some((part, index) => !part || encodeURIComponent(part) !== parts[index + 1]))
      return null;
    return { serverId: decoded[0]!, runnerId: decoded[1]!, conversationId: decoded[2]! };
  } catch {
    return null;
  }
}
