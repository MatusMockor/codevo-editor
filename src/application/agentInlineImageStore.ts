import { agentImageMimeFromBytes } from "../domain/agentImageSignature";
import { MAX_AGENT_INLINE_IMAGE_BYTES } from "../domain/agentMarkdown/agentInlineImage";
import {
  createAgentAttachmentReadLimiter,
  type AgentAttachmentReadLimiter,
} from "./agentAttachmentReadLimiter";
import {
  MAX_AGENT_INLINE_IMAGE_ENTRIES,
  agentInlineImageKey,
  agentInlineImageThreadPrefix,
  createAgentInlineImageCache,
  type AgentInlineImageCache,
  type AgentInlineImageIdentity,
  type AgentInlineImageLease,
  type AgentInlineImageState,
  type AgentInlineImageThreadOwner,
} from "./agentInlineImageCache";
import { isAgentInlineImageBusyError, type AgentInlineImageGateway } from "./agentInlineImagePorts";
import type { Attempt } from "./agentProjectAuthority";

export const MAX_AGENT_INLINE_IMAGE_UNAVAILABLE_REASON_CHARS = 160;
const MAX_AGENT_INLINE_IMAGE_REMEMBERED_SIZES = 256;
export const AGENT_INLINE_IMAGE_NO_GATEWAY_REASON = "Images cannot be read in this session.";
export const AGENT_INLINE_IMAGE_UNREADABLE_REASON = "The image could not be read.";
export const AGENT_INLINE_IMAGE_UNSUPPORTED_REASON = "The file is not a supported image.";
export const AGENT_INLINE_IMAGE_TOO_LARGE_REASON = "The image is too large to preview.";
export const AGENT_INLINE_IMAGE_DECODE_FAILED_REASON = "The image bytes could not be decoded.";
export const AGENT_INLINE_IMAGE_QUEUE_LIMIT_REASON = "Too many images are waiting for a preview.";
export const MAX_AGENT_INLINE_IMAGE_WAITING = 32;

const WAITING_STATE: AgentInlineImageState = Object.freeze({ kind: "waiting" });
const DECODE_FAILED_STATE: AgentInlineImageState = Object.freeze({
  kind: "unavailable",
  reason: AGENT_INLINE_IMAGE_DECODE_FAILED_REASON,
});

export interface AgentInlineImageSize {
  readonly width: number;
  readonly height: number;
}

export interface AgentInlineImagesSurface {
  subscribe(listener: () => void): () => void;
  revision(): number;
  stateOf(identity: AgentInlineImageIdentity): AgentInlineImageState | undefined;
  sizeOf(identity: AgentInlineImageIdentity): AgentInlineImageSize | null;
  ensure(identity: AgentInlineImageIdentity): void;
  retry(identity: AgentInlineImageIdentity): void;
  pin(identity: AgentInlineImageIdentity): () => void;
  markBroken(identity: AgentInlineImageIdentity, url: string): void;
  measure(identity: AgentInlineImageIdentity, url: string, size: AgentInlineImageSize): void;
  holdThread(owner: AgentInlineImageThreadOwner): () => void;
}

export interface AgentInlineImageStore extends AgentInlineImagesSurface {
  dispose(): void;
}

export interface AgentInlineImageStoreDependencies {
  gateway(): AgentInlineImageGateway | null;
  createObjectUrl(blob: Blob): string;
  revokeObjectUrl(url: string): void;
}

export function agentInlineImageUnavailableReason(error: unknown, path: string): string {
  const line = errorMessage(error).split("\n")[0]?.trim() ?? "";
  if (line === "" || line.includes(path)) return AGENT_INLINE_IMAGE_UNREADABLE_REASON;
  return [...line].slice(0, MAX_AGENT_INLINE_IMAGE_UNAVAILABLE_REASON_CHARS).join("");
}

export function createAgentInlineImageStore(
  dependencies: AgentInlineImageStoreDependencies,
): AgentInlineImageStore {
  const cache = createAgentInlineImageCache(dependencies.revokeObjectUrl);
  const listeners = new Set<() => void>();
  const waiting = new Map<string, AgentInlineImageIdentity>();
  const broken = new Map<string, string>();
  const sizes = new Map<string, AgentInlineImageSize>();
  let limiter: AgentAttachmentReadLimiter<ArrayBuffer> | null = null;
  let revision = 0;
  let published = cache.version();
  let dirty = false;

  const shows = (key: string, url: string): boolean => {
    const state = cache.stateOf(key);
    return state?.kind === "ready" && state.url === url;
  };

  const publish = (): void => {
    if (!dirty && cache.version() === published) return;
    dirty = false;
    published = cache.version();
    for (const [key, url] of [...broken]) {
      if (!shows(key, url)) broken.delete(key);
    }
    revision += 1;
    for (const listener of [...listeners]) listener();
  };

  const stopWaiting = (key: string): void => {
    if (waiting.delete(key)) dirty = true;
  };

  const load = (identity: AgentInlineImageIdentity, lease: AgentInlineImageLease): void => {
    const gateway = dependencies.gateway();
    if (gateway === null) {
      cache.fail(lease, AGENT_INLINE_IMAGE_NO_GATEWAY_REASON);
      return;
    }
    const { path, threadId, workspaceId } = identity;
    limiter ??= createAgentAttachmentReadLimiter(
      MAX_AGENT_INLINE_IMAGE_ENTRIES,
      isAgentInlineImageBusyError,
    );
    limiter.schedule({
      read: () => gateway.readAgentInlineImage({ workspaceId, threadId, path }),
      isCurrent: () => cache.isCurrent(lease),
      settle: (read) => {
        if (!cache.isCurrent(lease)) return;
        settleImage(read, path, lease, cache, dependencies);
        admitWaiting();
        publish();
      },
    });
  };

  const admit = (identity: AgentInlineImageIdentity): boolean => {
    const admission = cache.begin(agentInlineImageKey(identity));
    switch (admission.kind) {
      case "present":
        return true;
      case "refused":
        return false;
      case "admitted":
        load(identity, admission.lease);
        return true;
      default:
        return unsupportedAdmission(admission);
    }
  };

  const request = (identity: AgentInlineImageIdentity): void => {
    const key = agentInlineImageKey(identity);
    if (admit(identity)) {
      stopWaiting(key);
      return;
    }
    if (waiting.has(key)) return;
    if (!cache.isPinned(key)) {
      cache.refuse(key, AGENT_INLINE_IMAGE_QUEUE_LIMIT_REASON);
      return;
    }
    waiting.set(key, identity);
    dirty = true;
    for (const oldest of waiting.keys()) {
      if (waiting.size <= MAX_AGENT_INLINE_IMAGE_WAITING) return;
      waiting.delete(oldest);
      cache.refuse(oldest, AGENT_INLINE_IMAGE_QUEUE_LIMIT_REASON);
    }
  };

  function admitWaiting(): void {
    for (const [key, identity] of [...waiting]) {
      if (!waiting.has(key)) continue;
      if (!cache.isPinned(key)) {
        stopWaiting(key);
        continue;
      }
      if (!admit(identity)) return;
      stopWaiting(key);
    }
  }

  const forgetThread = (owner: AgentInlineImageThreadOwner): void => {
    const prefix = agentInlineImageThreadPrefix(owner);
    for (const owned of [waiting, broken, sizes]) {
      for (const key of [...owned.keys()]) {
        if (key.startsWith(prefix)) owned.delete(key);
      }
    }
    dirty = true;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    revision: () => revision,
    stateOf(identity) {
      const key = agentInlineImageKey(identity);
      const state = cache.stateOf(key);
      if (state === undefined) return waiting.has(key) ? WAITING_STATE : undefined;
      if (state.kind === "ready" && broken.get(key) === state.url) return DECODE_FAILED_STATE;
      return state;
    },
    sizeOf(identity) {
      return sizes.get(agentInlineImageKey(identity)) ?? null;
    },
    ensure(identity) {
      if (cache.touch(agentInlineImageKey(identity))) return;
      request(identity);
      publish();
    },
    retry(identity) {
      cache.forget(agentInlineImageKey(identity));
      request(identity);
      publish();
    },
    pin(identity) {
      const key = agentInlineImageKey(identity);
      if (cache.pin(key) === "refused") return ignore;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        cache.unpin(key);
        if (!cache.isPinned(key)) stopWaiting(key);
        admitWaiting();
        publish();
      };
    },
    markBroken(identity, url) {
      const key = agentInlineImageKey(identity);
      if (!shows(key, url) || broken.get(key) === url) return;
      broken.set(key, url);
      dirty = true;
      publish();
    },
    measure(identity, url, size) {
      const key = agentInlineImageKey(identity);
      if (!shows(key, url)) return;
      if (!isPixelCount(size.width) || !isPixelCount(size.height)) return;
      sizes.delete(key);
      sizes.set(key, { width: size.width, height: size.height });
      for (const oldest of sizes.keys()) {
        if (sizes.size <= MAX_AGENT_INLINE_IMAGE_REMEMBERED_SIZES) return;
        sizes.delete(oldest);
      }
    },
    holdThread(owner) {
      cache.holdThread(owner);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (cache.releaseThread(owner) === "held") return;
        forgetThread(owner);
        limiter?.prune();
        admitWaiting();
        publish();
      };
    },
    dispose() {
      limiter?.dispose();
      limiter = null;
      cache.clear();
      waiting.clear();
      broken.clear();
      sizes.clear();
      dirty = true;
      publish();
    },
  };
}

function settleImage(
  read: Attempt<ArrayBuffer>,
  path: string,
  lease: AgentInlineImageLease,
  cache: AgentInlineImageCache,
  dependencies: AgentInlineImageStoreDependencies,
): void {
  if (!read.ok) {
    cache.fail(lease, agentInlineImageUnavailableReason(read.error, path));
    return;
  }
  const bytes = read.value;
  if (bytes.byteLength > MAX_AGENT_INLINE_IMAGE_BYTES) {
    cache.fail(lease, AGENT_INLINE_IMAGE_TOO_LARGE_REASON);
    return;
  }
  const mime = agentImageMimeFromBytes(new Uint8Array(bytes));
  if (mime === null) {
    cache.fail(lease, AGENT_INLINE_IMAGE_UNSUPPORTED_REASON);
    return;
  }
  cache.resolve(lease, bytes.byteLength, () =>
    dependencies.createObjectUrl(new Blob([bytes], { type: mime })),
  );
}

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "";
}

function ignore(): void {}

function isPixelCount(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function unsupportedAdmission(admission: never): never {
  throw new Error(`Unsupported inline image admission: ${String(admission)}`);
}
