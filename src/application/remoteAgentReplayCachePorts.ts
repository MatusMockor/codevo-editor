export const MAX_REMOTE_REPLAY_CACHE_RECORD_BYTES = 4 * 1024 * 1024;
export const MAX_REMOTE_REPLAY_CACHE_THREAD_BYTES = 8 * 1024 * 1024;
export const MAX_REMOTE_REPLAY_CACHE_TASKS = 64;
export const MAX_REMOTE_REPLAY_CACHE_IDENTIFIER_BYTES = 512;

export interface RemoteAgentReplayCacheKey {
  readonly serverId: string;
  readonly endpoint: string;
  readonly runnerId: string;
  readonly threadKey: string;
}

export interface RemoteAgentReplayCacheRecord {
  readonly taskId: string;
  readonly record: string;
}

export type RemoteAgentReplayCacheRejectionReason =
  "invalidIdentifier" | "recordTooLarge" | "invalidRecord" | "threadTooLarge" | "tooManyTasks";

export type RemoteAgentReplayCacheLoadResult =
  | { readonly kind: "hit"; readonly records: ReadonlyArray<RemoteAgentReplayCacheRecord> }
  | { readonly kind: "miss" };

export type RemoteAgentReplayCachePutResult =
  | { readonly kind: "stored" }
  | { readonly kind: "rejected"; readonly reason: RemoteAgentReplayCacheRejectionReason }
  | { readonly kind: "unavailable" };

export type RemoteAgentReplayCacheRemoveResult =
  { readonly kind: "removed" } | { readonly kind: "unavailable" };

export interface RemoteAgentReplayCacheGateway {
  loadThread(key: RemoteAgentReplayCacheKey): Promise<RemoteAgentReplayCacheLoadResult>;
  putTask(
    key: RemoteAgentReplayCacheKey,
    taskId: string,
    record: string,
  ): Promise<RemoteAgentReplayCachePutResult>;
  removeThread(key: RemoteAgentReplayCacheKey): Promise<RemoteAgentReplayCacheRemoveResult>;
  removeServer(serverId: string): Promise<RemoteAgentReplayCacheRemoveResult>;
  clear(): Promise<RemoteAgentReplayCacheRemoveResult>;
}
