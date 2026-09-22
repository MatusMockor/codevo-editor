import type { RemoteRunnerGateway } from "../domain/remoteRunner";
import type { RemoteThreadMetadata } from "../domain/remoteThreadMetadata";

/** Refresh the bounded authoritative metadata snapshot, including inactive conversations. */
export async function loadRemoteThreadMetadata(
  gateway: RemoteRunnerGateway,
  serverId: string,
  check: () => void,
): Promise<ReadonlyMap<string, RemoteThreadMetadata>> {
  const result = new Map<string, RemoteThreadMetadata>();
  if (!gateway.listThreadMetadata) return result;
  let after: string | undefined;
  const cursors = new Set<string>();
  for (let pageNumber = 0; pageNumber < 41; pageNumber++) {
    check();
    const page = await gateway.listThreadMetadata({ serverId, ...(after ? { after } : {}) });
    check();
    if (page.items.length > 100)
      throw new Error("The server returned an oversized thread metadata page.");
    for (const item of page.items) {
      if (result.has(item.taskId))
        throw new Error("The server returned duplicate thread metadata.");
      result.set(item.taskId, item);
      if (result.size > 4096)
        throw new Error("Server thread metadata exceeds the supported inventory limit.");
    }
    if (page.nextAfter === null) return result;
    if (
      page.items.length === 0 ||
      cursors.has(page.nextAfter) ||
      page.nextAfter !== page.items[page.items.length - 1]?.taskId
    )
      throw new Error("The server returned an invalid thread metadata cursor.");
    cursors.add(page.nextAfter);
    after = page.nextAfter;
  }
  throw new Error("Server thread metadata exceeds the supported page limit.");
}
