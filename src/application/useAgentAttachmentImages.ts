import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgentImageMime } from "../domain/agentAttachment";
import type { AgentAttachmentGateway } from "./agentAttachmentPorts";
import { AGENT_TASKS_SOURCE, attempt } from "./agentProjectAuthority";

export const MAX_AGENT_ATTACHMENT_IMAGE_ENTRIES = 24;
export const MAX_AGENT_ATTACHMENT_IMAGE_CACHE_BYTES = 64 * 1_024 * 1_024;
export const MAX_AGENT_ATTACHMENT_UNAVAILABLE_REASON_CHARS = 160;
export const AGENT_ATTACHMENT_NO_GATEWAY_REASON = "Attachments cannot be read in this session.";
export const AGENT_ATTACHMENT_CACHE_LIMIT_REASON =
  "Image preview limit reached. Open another thread to free preview capacity.";
export const AGENT_ATTACHMENT_UNREADABLE_REASON = "The image could not be read.";

const KEY_SEPARATOR = "\u0000";

export type AgentAttachmentImageState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly url: string }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface AgentAttachmentImageRequest {
  readonly workspaceId: string;
  readonly threadId: string;
  readonly attachmentId: string;
  readonly mime: AgentImageMime;
}

export interface AgentAttachmentImageThreadOwner {
  readonly workspaceId: string;
  readonly threadId: string;
}

export interface AgentAttachmentImagesSurface {
  readonly images: ReadonlyMap<string, AgentAttachmentImageState>;
  readonly capacityReached?: boolean;
  ensure(request: AgentAttachmentImageRequest): void;
  holdThread(owner: AgentAttachmentImageThreadOwner): () => void;
  releaseWorkspace(workspaceId: string): void;
}

export interface AgentAttachmentImagesDependencies {
  readonly gateway: AgentAttachmentGateway | null;
  readonly reportError: (source: string, error: unknown) => void;
  readonly createObjectUrl?: (blob: Blob) => string;
  readonly revokeObjectUrl?: (url: string) => void;
}

interface CacheEntry {
  readonly state: AgentAttachmentImageState;
  readonly bytes: number;
}

interface ImageCache {
  readonly entries: Map<string, CacheEntry>;
  readonly holds: Map<string, number>;
  readonly queued: Map<string, AgentAttachmentImageRequest>;
}

export function agentAttachmentImageKey(
  workspaceId: string,
  threadId: string,
  attachmentId: string,
): string {
  return `${workspaceId}${KEY_SEPARATOR}${threadId}${KEY_SEPARATOR}${attachmentId}`;
}

function agentAttachmentThreadPrefix(workspaceId: string, threadId: string): string {
  return `${workspaceId}${KEY_SEPARATOR}${threadId}${KEY_SEPARATOR}`;
}

export function agentAttachmentUnavailableReason(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const line = message.split("\n")[0]?.trim() ?? "";
  if (line === "") return AGENT_ATTACHMENT_UNREADABLE_REASON;
  return [...line].slice(0, MAX_AGENT_ATTACHMENT_UNAVAILABLE_REASON_CHARS).join("");
}

export function useAgentAttachmentImages(
  dependencies: AgentAttachmentImagesDependencies,
): AgentAttachmentImagesSurface {
  const [images, setImages] = useState<ReadonlyMap<string, AgentAttachmentImageState>>(
    () => new Map(),
  );
  const cacheRef = useRef<ImageCache>({ entries: new Map(), holds: new Map(), queued: new Map() });
  const dependenciesRef = useRef(dependencies);
  const mountedRef = useRef(true);

  useLayoutEffect(() => {
    dependenciesRef.current = dependencies;
  });

  useEffect(() => {
    mountedRef.current = true;
    const entries = cacheRef.current.entries;
    return () => {
      mountedRef.current = false;
      for (const key of [...entries.keys()]) revokeEntry(dependenciesRef.current, entries, key);
    };
  }, []);

  const publish = useCallback((): void => {
    if (!mountedRef.current) return;
    const next = new Map<string, AgentAttachmentImageState>();
    for (const [key, entry] of cacheRef.current.entries) next.set(key, entry.state);
    setImages(next);
  }, []);

  const ensure = useCallback(
    function ensureRequest(request: AgentAttachmentImageRequest): void {
      const key = agentAttachmentImageKey(
        request.workspaceId,
        request.threadId,
        request.attachmentId,
      );
      const cache = cacheRef.current;
      const existing = cache.entries.get(key);
      if (existing !== undefined) {
        cache.entries.delete(key);
        cache.entries.set(key, existing);
        return;
      }
      makeRoom(dependenciesRef.current, cache);
      if (cache.entries.size >= MAX_AGENT_ATTACHMENT_IMAGE_ENTRIES) {
        if (
          cache.queued.size < MAX_AGENT_ATTACHMENT_IMAGE_ENTRIES &&
          [...cache.entries.values()].some((entry) => entry.state.kind === "loading")
        ) {
          cache.queued.set(key, request);
        }
        return;
      }
      cache.queued.delete(key);
      const gateway = dependenciesRef.current.gateway;
      if (gateway === null) {
        cache.entries.set(key, {
          state: { kind: "unavailable", reason: AGENT_ATTACHMENT_NO_GATEWAY_REASON },
          bytes: 0,
        });
        publish();
        return;
      }
      const pending: CacheEntry = { state: { kind: "loading" }, bytes: 0 };
      cache.entries.set(key, pending);
      publish();
      const settle = (): void => {
        for (const [queuedKey, queuedRequest] of cache.queued) {
          makeRoom(dependenciesRef.current, cache);
          if (cache.entries.size >= MAX_AGENT_ATTACHMENT_IMAGE_ENTRIES) break;
          cache.queued.delete(queuedKey);
          ensureRequest(queuedRequest);
        }
        publish();
      };
      void loadImage(gateway, request, key, pending, cache, settle, mountedRef, dependenciesRef);
    },
    [publish],
  );

  const holdThread = useCallback(
    (owner: AgentAttachmentImageThreadOwner): (() => void) => {
      const holds = cacheRef.current.holds;
      const prefix = agentAttachmentThreadPrefix(owner.workspaceId, owner.threadId);
      holds.set(prefix, (holds.get(prefix) ?? 0) + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const remaining = (holds.get(prefix) ?? 1) - 1;
        if (remaining > 0) {
          holds.set(prefix, remaining);
          return;
        }
        holds.delete(prefix);
        for (const key of cacheRef.current.queued.keys()) {
          if (key.startsWith(prefix)) cacheRef.current.queued.delete(key);
        }
        for (const [key, entry] of cacheRef.current.entries) {
          if (key.startsWith(prefix) && entry.state.kind !== "loading") {
            revokeEntry(dependenciesRef.current, cacheRef.current.entries, key);
          }
        }
        publish();
      };
    },
    [publish],
  );

  const releaseWorkspace = useCallback(
    (workspaceId: string): void => {
      const entries = cacheRef.current.entries;
      const prefix = `${workspaceId}${KEY_SEPARATOR}`;
      let released = false;
      for (const key of cacheRef.current.queued.keys()) {
        if (key.startsWith(prefix)) cacheRef.current.queued.delete(key);
      }
      for (const key of [...entries.keys()]) {
        if (!key.startsWith(prefix)) continue;
        revokeEntry(dependenciesRef.current, entries, key);
        released = true;
      }
      if (released) publish();
    },
    [publish],
  );

  return {
    images,
    capacityReached: images.size >= MAX_AGENT_ATTACHMENT_IMAGE_ENTRIES,
    ensure,
    holdThread,
    releaseWorkspace,
  };
}

async function loadImage(
  gateway: AgentAttachmentGateway,
  request: AgentAttachmentImageRequest,
  key: string,
  pending: CacheEntry,
  cache: ImageCache,
  publish: () => void,
  mountedRef: { readonly current: boolean },
  dependenciesRef: { readonly current: AgentAttachmentImagesDependencies },
): Promise<void> {
  const read = await attempt(() =>
    gateway.readAgentAttachment({
      workspaceId: request.workspaceId,
      threadId: request.threadId,
      attachmentId: request.attachmentId,
    }),
  );
  if (!mountedRef.current) return;
  const entries = cache.entries;
  if (entries.get(key) !== pending) return;
  if (!read.ok) {
    dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, read.error);
    entries.set(key, {
      state: { kind: "unavailable", reason: agentAttachmentUnavailableReason(read.error) },
      bytes: 0,
    });
    publish();
    return;
  }
  let bytes = 0;
  for (const entry of entries.values()) bytes += entry.bytes;
  if (read.value.byteLength > MAX_AGENT_ATTACHMENT_IMAGE_CACHE_BYTES - bytes) {
    entries.set(key, {
      state: { kind: "unavailable", reason: AGENT_ATTACHMENT_CACHE_LIMIT_REASON },
      bytes: 0,
    });
    publish();
    return;
  }
  const createObjectUrl = dependenciesRef.current.createObjectUrl ?? defaultCreateObjectUrl;
  const url = createObjectUrl(new Blob([read.value], { type: request.mime }));
  entries.set(key, { state: { kind: "ready", url }, bytes: read.value.byteLength });
  publish();
}

function makeRoom(dependencies: AgentAttachmentImagesDependencies, cache: ImageCache): void {
  for (const key of cache.entries.keys()) {
    if (cache.entries.size < MAX_AGENT_ATTACHMENT_IMAGE_ENTRIES) return;
    if (evictable(cache, key)) revokeEntry(dependencies, cache.entries, key);
  }
}

function evictable(cache: ImageCache, key: string): boolean {
  if (cache.entries.get(key)?.state.kind === "loading") return false;
  for (const prefix of cache.holds.keys()) {
    if (key.startsWith(prefix)) return false;
  }
  return true;
}

function revokeEntry(
  dependencies: AgentAttachmentImagesDependencies,
  entries: Map<string, CacheEntry>,
  key: string,
): void {
  const entry = entries.get(key);
  entries.delete(key);
  if (entry === undefined || entry.state.kind !== "ready") return;
  const revokeObjectUrl = dependencies.revokeObjectUrl ?? defaultRevokeObjectUrl;
  revokeObjectUrl(entry.state.url);
}

function defaultCreateObjectUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

function defaultRevokeObjectUrl(url: string): void {
  URL.revokeObjectURL(url);
}
