import type {
  RemoteRunnerDescriptor,
  RemoteRunnerGateway,
  RemoteRunnerTask,
} from "../domain/remoteRunner";
import type { RemoteThreadMetadata } from "../domain/remoteThreadMetadata";

type ThreadMetadataIndex = ReadonlyMap<string, RemoteThreadMetadata>;
interface ThreadMetadataOwner {
  readonly descriptor: RemoteRunnerDescriptor | null;
  readonly tasks: readonly RemoteRunnerTask[];
  readonly threadMetadata?: ThreadMetadataIndex;
}

export type PublishedThreadMetadata =
  | {
      readonly kind: "applied";
      readonly threadMetadata: ThreadMetadataIndex;
      readonly unconfirmed: ThreadMetadataIndex;
    }
  | { readonly kind: "current" }
  | { readonly kind: "unknown" }
  | { readonly kind: "full" };
export const MAX_UNCONFIRMED_THREAD_METADATA = 256;
const NONE_UNCONFIRMED: ThreadMetadataIndex = new Map();

export function publishedRemoteThreadMetadata(
  snapshot: ThreadMetadataOwner,
  unconfirmed: ThreadMetadataIndex | undefined,
  metadata: RemoteThreadMetadata,
): PublishedThreadMetadata {
  if (snapshot.descriptor === null) return { kind: "unknown" };
  if (!snapshot.tasks.some((task) => (task.conversationId ?? task.id) === metadata.taskId))
    return { kind: "unknown" };
  const cached = snapshot.threadMetadata?.get(metadata.taskId);
  if (cached !== undefined && cached.revision >= metadata.revision) return { kind: "current" };
  if (
    unconfirmed !== undefined &&
    unconfirmed.size >= MAX_UNCONFIRMED_THREAD_METADATA &&
    !unconfirmed.has(metadata.taskId)
  )
    return { kind: "full" };
  return {
    kind: "applied",
    threadMetadata: new Map(snapshot.threadMetadata).set(metadata.taskId, metadata),
    unconfirmed: new Map(unconfirmed).set(metadata.taskId, metadata),
  };
}

export function mergeLoadedThreadMetadata(
  loaded: ThreadMetadataIndex | undefined,
  unconfirmed: ThreadMetadataIndex | undefined,
): {
  readonly threadMetadata: ThreadMetadataIndex | undefined;
  readonly unconfirmed: ThreadMetadataIndex;
} {
  const remaining = new Map<string, RemoteThreadMetadata>();
  for (const [taskId, published] of unconfirmed ?? NONE_UNCONFIRMED) {
    if ((loaded?.get(taskId)?.revision ?? -1) >= published.revision) continue;
    remaining.set(taskId, published);
  }
  if (remaining.size === 0) return { threadMetadata: loaded, unconfirmed: NONE_UNCONFIRMED };
  const threadMetadata = new Map(loaded);
  for (const [taskId, published] of remaining) threadMetadata.set(taskId, published);
  return { threadMetadata, unconfirmed: remaining };
}

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
