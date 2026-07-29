import type { LargeSmartDocumentPolicy } from "../domain/largeDocumentPolicy";
import type { EditorDocument } from "../domain/workspace";
import type { EditorChangeHunk } from "../domain/editorChangeMarkers";
import type { EditorGroupDocumentSessionAuthority } from "./useEditorSessionState";
import { createEditorGroupChangeHunksBaseline } from "./editorSessionDocumentAuthority";
import {
  useOwnedEditorChangeHunks,
  type OwnedEditorChangeHunksInput,
  type OwnedEditorChangeHunksState,
} from "./useOwnedEditorChangeHunks";
import type { EditorChangeHunksComputationGateway } from "./editorChangeHunksComputation";
import type {
  EditorChangeHunksSnapshotPort,
  EditorLiveDocumentContentAccessPort,
} from "./editorChangeHunksSnapshotPort";
import type { LiveModelSourceHandle } from "./liveModelIngressCoordinator";
import type { LiveModelRevision } from "./liveModelIngressCoordinator";
import type {
  CaptureLiveDocumentSnapshotReceipt,
  LiveDocumentSnapshot,
} from "./liveDocumentSnapshotBroker";

interface RetryableLiveDocumentBindingOwner {
  dispose(): boolean;
}

interface EditorActiveLiveDocumentCapabilities {
  readonly handle: LiveModelSourceHandle;
  readonly liveContent: EditorLiveDocumentContentAccessPort;
  readonly sessionAuthority: EditorGroupDocumentSessionAuthority;
  readonly snapshots: EditorChangeHunksSnapshotPort;
}

export interface EditorActiveLiveDocumentBinding {
  readonly groupId: string;
  readonly path: string;
  isCurrent(): boolean;
}

export type EditorActiveLiveDocumentContentPurpose = "dirty-search" | "save";

export interface EditorActiveLiveDocumentContentCapture {
  readonly alternativeVersionId: number;
  readonly content: string;
  readonly contentVersion: number;
  readonly kind: "editor-active-live-document-content-capture";
  readonly modelVersionId: number;
  readonly purpose: EditorActiveLiveDocumentContentPurpose;
  readonly utf16Length: number;
  readonly utf8BytesUpperBound: number;
}

export type CaptureEditorActiveLiveDocumentContentReceipt =
  | {
      readonly capture: EditorActiveLiveDocumentContentCapture;
      readonly status: "captured";
    }
  | Exclude<CaptureLiveDocumentSnapshotReceipt, { readonly status: "captured" }>;

interface EditorActiveLiveDocumentCaptureCapabilities {
  readonly binding: EditorActiveLiveDocumentBinding;
  readonly bindingCapabilities: EditorActiveLiveDocumentCapabilities;
  settlement: "active" | "release-required" | "settled" | "settling";
  readonly snapshot: LiveDocumentSnapshot;
}

export interface EditorActiveLiveDocumentLegacyHunksInput {
  readonly baselineContent: string | null;
  readonly content: string | null;
  readonly ownerKey: string | null;
  readonly path: string | null;
}

export interface EditorActiveLiveDocumentChangeHunksInput {
  readonly activeGroupId: string;
  readonly activePath: string | null;
  readonly binding: EditorActiveLiveDocumentBinding | null;
  readonly coalesceMs?: number;
  readonly exactBindingRequired: boolean;
  readonly gateway: EditorChangeHunksComputationGateway;
  readonly legacy: EditorActiveLiveDocumentLegacyHunksInput | null;
  readonly policy: LargeSmartDocumentPolicy;
  readonly savedContent: string | null;
}

export interface EditorActiveLiveDocumentChangeHunksControllerInput {
  readonly activeDocument: Pick<EditorDocument, "content" | "path" | "savedContent"> | null;
  readonly activeGroupId: string;
  readonly coalesceMs?: number;
  readonly exactBindingRequired: boolean;
  readonly gateway: EditorChangeHunksComputationGateway;
  readonly legacyBaselineContent: string | null;
  readonly legacyOwnerKey: string | null;
  readonly policy: LargeSmartDocumentPolicy;
}

export interface EditorActiveLiveDocumentChangeHunksController {
  readonly changeHunksState: OwnedEditorChangeHunksState;
  readonly onActiveLiveDocumentBindingChange: (
    binding: EditorActiveLiveDocumentBinding | null,
  ) => void;
}

const capabilitiesByBinding = new WeakMap<
  EditorActiveLiveDocumentBinding,
  EditorActiveLiveDocumentCapabilities
>();
const capabilitiesByCapture = new WeakMap<
  EditorActiveLiveDocumentContentCapture,
  EditorActiveLiveDocumentCaptureCapabilities
>();
const detachedCleanupOwners = new Set<RetryableLiveDocumentBindingOwner>();
let detachedCleanupDrainScheduled = false;

export const EMPTY_EDITOR_CHANGE_HUNKS: readonly EditorChangeHunk[] = Object.freeze([]);

export function createEditorActiveLiveDocumentBinding(input: {
  readonly handle: LiveModelSourceHandle;
  readonly isCurrent: () => boolean;
  readonly liveContent: EditorLiveDocumentContentAccessPort;
  readonly sessionAuthority: EditorGroupDocumentSessionAuthority;
  readonly snapshots: EditorChangeHunksSnapshotPort;
}): EditorActiveLiveDocumentBinding {
  const binding = Object.freeze({
    groupId: input.sessionAuthority.groupId,
    path: input.sessionAuthority.path,
    isCurrent: () => input.isCurrent(),
  });
  const bindingSnapshots: EditorChangeHunksSnapshotPort = Object.freeze({
    capture: (handle: LiveModelSourceHandle, signal: AbortSignal) =>
      input.snapshots.capture(handle, signal),
    consumeCurrent: (handle: LiveModelSourceHandle, snapshot: LiveDocumentSnapshot) => {
      try {
        return input.snapshots.consumeCurrent(handle, snapshot);
      } finally {
        wakeEditorLiveDocumentBindingCleanup();
      }
    },
    release: (handle: LiveModelSourceHandle, snapshot: LiveDocumentSnapshot) => {
      try {
        return input.snapshots.release(handle, snapshot);
      } finally {
        wakeEditorLiveDocumentBindingCleanup();
      }
    },
    subscribe: (handle: LiveModelSourceHandle, listener: (revision: LiveModelRevision) => void) =>
      input.snapshots.subscribe(handle, listener),
  });
  capabilitiesByBinding.set(
    binding,
    Object.freeze({
      handle: input.handle,
      liveContent: input.liveContent,
      sessionAuthority: input.sessionAuthority,
      snapshots: bindingSnapshots,
    }),
  );
  return binding;
}

export function captureEditorActiveLiveDocumentForDirtySearch(
  binding: EditorActiveLiveDocumentBinding,
  signal?: AbortSignal,
): CaptureEditorActiveLiveDocumentContentReceipt {
  return captureEditorActiveLiveDocumentContent(binding, "dirty-search", signal);
}

export function captureEditorActiveLiveDocumentForSave(
  binding: EditorActiveLiveDocumentBinding,
  signal?: AbortSignal,
): CaptureEditorActiveLiveDocumentContentReceipt {
  return captureEditorActiveLiveDocumentContent(binding, "save", signal);
}

export function consumeCurrentEditorActiveLiveDocumentContent(
  binding: EditorActiveLiveDocumentBinding,
  capture: EditorActiveLiveDocumentContentCapture,
): boolean {
  return settleEditorActiveLiveDocumentContent(binding, capture, "consume");
}

/**
 * Exact save-issuance bridge. It proves the opaque React-safe binding and
 * capture belong to the same private document-session authority, then consumes
 * the hidden broker snapshot without exposing any raw capability.
 */
export function consumeEditorActiveLiveDocumentSaveCapture(
  binding: EditorActiveLiveDocumentBinding,
  sessionAuthority: EditorGroupDocumentSessionAuthority,
  capture: EditorActiveLiveDocumentContentCapture,
  expectedModelAuthority: object,
): boolean {
  const bindingCapabilities = exactCurrentCapabilities(binding, binding.groupId, binding.path);
  const captured = capabilitiesByCapture.get(capture);
  if (
    !bindingCapabilities ||
    bindingCapabilities.sessionAuthority !== sessionAuthority ||
    !captured ||
    captured.binding !== binding ||
    captured.bindingCapabilities !== bindingCapabilities ||
    bindingCapabilities.handle.modelAuthority !== expectedModelAuthority ||
    capture.purpose !== "save"
  ) {
    return false;
  }
  return (
    settleEditorActiveLiveDocumentContent(binding, capture, "consume") &&
    exactCurrentCapabilities(binding, binding.groupId, binding.path) === bindingCapabilities &&
    bindingCapabilities.sessionAuthority === sessionAuthority &&
    bindingCapabilities.handle.modelAuthority === expectedModelAuthority
  );
}

export function releaseEditorActiveLiveDocumentContent(
  binding: EditorActiveLiveDocumentBinding,
  capture: EditorActiveLiveDocumentContentCapture,
): boolean {
  return settleEditorActiveLiveDocumentContent(binding, capture, "release");
}

function captureEditorActiveLiveDocumentContent(
  binding: EditorActiveLiveDocumentBinding,
  purpose: EditorActiveLiveDocumentContentPurpose,
  signal?: AbortSignal,
): CaptureEditorActiveLiveDocumentContentReceipt {
  const capabilities = exactCurrentCapabilities(binding, binding.groupId, binding.path);
  if (!capabilities) return STALE_CONTENT_CAPTURE;
  let captured: CaptureLiveDocumentSnapshotReceipt;
  try {
    captured =
      purpose === "save"
        ? capabilities.liveContent.captureForSave(capabilities.handle, signal)
        : capabilities.liveContent.captureForDirtySearch(capabilities.handle, signal);
  } catch {
    return SOURCE_FAILED_CONTENT_CAPTURE;
  }
  if (exactCurrentCapabilities(binding, binding.groupId, binding.path) !== capabilities) {
    if (captured.status === "captured") {
      releaseCapturedSnapshot(capabilities, captured.snapshot);
    }
    return STALE_CONTENT_CAPTURE;
  }
  if (captured.status !== "captured") return captured;
  const snapshot = captured.snapshot;
  if (!validContentSnapshot(snapshot, purpose)) {
    releaseCapturedSnapshot(capabilities, snapshot);
    return STALE_CONTENT_CAPTURE;
  }
  const capture = Object.freeze({
    alternativeVersionId: snapshot.alternativeVersionId,
    content: snapshot.content,
    contentVersion: snapshot.contentVersion,
    kind: "editor-active-live-document-content-capture" as const,
    modelVersionId: snapshot.modelVersionId,
    purpose,
    utf16Length: snapshot.utf16Length,
    utf8BytesUpperBound: snapshot.utf8BytesUpperBound,
  });
  capabilitiesByCapture.set(capture, {
    binding,
    bindingCapabilities: capabilities,
    settlement: "active",
    snapshot,
  });
  return Object.freeze({ capture, status: "captured" as const });
}

function settleEditorActiveLiveDocumentContent(
  binding: EditorActiveLiveDocumentBinding,
  capture: EditorActiveLiveDocumentContentCapture,
  mode: "consume" | "release",
): boolean {
  const captured = capabilitiesByCapture.get(capture);
  const bindingCapabilities = capabilitiesByBinding.get(binding);
  if (
    !captured ||
    captured.binding !== binding ||
    captured.bindingCapabilities !== bindingCapabilities ||
    captured.settlement === "settled" ||
    captured.settlement === "settling" ||
    (mode === "consume" && captured.settlement !== "active")
  ) {
    return false;
  }
  if (mode === "release") {
    if (captured.settlement === "active") {
      captured.settlement = "release-required";
    }
    return settleEditorActiveLiveDocumentRelease(captured, bindingCapabilities);
  }

  if (exactCurrentCapabilities(binding, binding.groupId, binding.path) !== bindingCapabilities) {
    captured.settlement = "release-required";
    settleEditorActiveLiveDocumentRelease(captured, bindingCapabilities);
    return false;
  }
  captured.settlement = "settling";
  try {
    const consumed = bindingCapabilities.liveContent.consumeCurrent(
      bindingCapabilities.handle,
      captured.snapshot,
    );
    if (consumed) {
      captured.settlement = "settled";
      return (
        exactCurrentCapabilities(binding, binding.groupId, binding.path) === bindingCapabilities
      );
    }
    captured.settlement = "release-required";
    settleEditorActiveLiveDocumentRelease(captured, bindingCapabilities);
    return false;
  } catch {
    captured.settlement = "release-required";
    settleEditorActiveLiveDocumentRelease(captured, bindingCapabilities);
    return false;
  } finally {
    wakeEditorLiveDocumentBindingCleanup();
  }
}

function settleEditorActiveLiveDocumentRelease(
  captured: EditorActiveLiveDocumentCaptureCapabilities,
  bindingCapabilities: EditorActiveLiveDocumentCapabilities,
): boolean {
  const retryState = captured.settlement;
  captured.settlement = "settling";
  try {
    const released = bindingCapabilities.liveContent.release(
      bindingCapabilities.handle,
      captured.snapshot,
    );
    captured.settlement = released ? "settled" : retryState;
    return released;
  } catch {
    captured.settlement = retryState;
    return false;
  } finally {
    wakeEditorLiveDocumentBindingCleanup();
  }
}

function releaseCapturedSnapshot(
  capabilities: EditorActiveLiveDocumentCapabilities,
  snapshot: LiveDocumentSnapshot,
): void {
  try {
    capabilities.liveContent.release(capabilities.handle, snapshot);
  } catch {
    // The scoped coordinator retains uncertain releases for deterministic retry.
  } finally {
    wakeEditorLiveDocumentBindingCleanup();
  }
}

function validContentSnapshot(
  snapshot: LiveDocumentSnapshot,
  purpose: EditorActiveLiveDocumentContentPurpose,
): boolean {
  try {
    return (
      snapshot.purpose === purpose &&
      typeof snapshot.content === "string" &&
      snapshot.content.length === snapshot.utf16Length &&
      Number.isSafeInteger(snapshot.alternativeVersionId) &&
      snapshot.alternativeVersionId > 0 &&
      Number.isSafeInteger(snapshot.contentVersion) &&
      snapshot.contentVersion > 0 &&
      Number.isSafeInteger(snapshot.modelVersionId) &&
      snapshot.modelVersionId > 0 &&
      Number.isSafeInteger(snapshot.utf8BytesUpperBound) &&
      snapshot.utf8BytesUpperBound >= snapshot.utf16Length
    );
  } catch {
    return false;
  }
}

export function useEditorActiveLiveDocumentChangeHunks(
  input: EditorActiveLiveDocumentChangeHunksInput,
): OwnedEditorChangeHunksState {
  const capabilities = exactCurrentCapabilities(
    input.binding,
    input.activeGroupId,
    input.activePath,
  );
  const baseline =
    capabilities && input.savedContent !== null
      ? createEditorGroupChangeHunksBaseline(capabilities.sessionAuthority, input.savedContent)
      : null;
  const selected: OwnedEditorChangeHunksInput =
    capabilities && baseline
      ? {
          baseline,
          coalesceMs: input.coalesceMs,
          gateway: input.gateway,
          liveDocument: { handle: capabilities.handle },
          mode: "snapshot",
          policy: input.policy,
          snapshots: capabilities.snapshots,
        }
      : !input.exactBindingRequired && input.legacy
        ? {
            ...input.legacy,
            coalesceMs: input.coalesceMs,
            gateway: input.gateway,
            mode: "legacy",
            policy: input.policy,
          }
        : {
            baseline: null,
            coalesceMs: input.coalesceMs,
            gateway: input.gateway,
            liveDocument: null,
            mode: "snapshot",
            policy: input.policy,
            snapshots: INACTIVE_SNAPSHOTS,
          };
  return useOwnedEditorChangeHunks(selected);
}

export function useEditorActiveLiveDocumentChangeHunksController(
  input: EditorActiveLiveDocumentChangeHunksControllerInput,
): EditorActiveLiveDocumentChangeHunksController {
  const [binding, setBinding] = useState<EditorActiveLiveDocumentBinding | null>(null);
  const onActiveLiveDocumentBindingChange = useCallback(
    (next: EditorActiveLiveDocumentBinding | null) => {
      setBinding((current) => (current === next ? current : next));
    },
    [],
  );
  const changeHunksState = useEditorActiveLiveDocumentChangeHunks({
    activeGroupId: input.activeGroupId,
    activePath: input.activeDocument?.path ?? null,
    binding,
    coalesceMs: input.coalesceMs,
    exactBindingRequired: input.exactBindingRequired,
    gateway: input.gateway,
    legacy: input.exactBindingRequired
      ? null
      : {
          baselineContent: input.legacyBaselineContent,
          content: input.activeDocument?.content ?? null,
          ownerKey: input.legacyOwnerKey,
          path: input.activeDocument?.path ?? null,
        },
    policy: input.policy,
    savedContent: input.activeDocument?.savedContent ?? null,
  });
  return useMemo(
    () => ({
      changeHunksState,
      onActiveLiveDocumentBindingChange,
    }),
    [changeHunksState, onActiveLiveDocumentBindingChange],
  );
}

export function retireEditorLiveDocumentBindingOwner(
  owner: RetryableLiveDocumentBindingOwner,
): void {
  if (detachedCleanupOwners.has(owner)) {
    scheduleDetachedCleanupDrain();
    return;
  }
  try {
    if (owner.dispose()) return;
  } catch {
    // Retain the exact owner for an explicit snapshot-settlement wake-up.
  }
  detachedCleanupOwners.add(owner);
  scheduleDetachedCleanupDrain();
}

export function wakeEditorLiveDocumentBindingCleanup(): void {
  scheduleDetachedCleanupDrain();
}

function exactCurrentCapabilities(
  binding: EditorActiveLiveDocumentBinding | null,
  activeGroupId: string,
  activePath: string | null,
): EditorActiveLiveDocumentCapabilities | null {
  if (!binding || binding.groupId !== activeGroupId || binding.path !== activePath) {
    return null;
  }
  const capabilities = capabilitiesByBinding.get(binding);
  if (!capabilities) return null;
  try {
    return binding.isCurrent() && binding.isCurrent() ? capabilities : null;
  } catch {
    return null;
  }
}

function scheduleDetachedCleanupDrain(): void {
  if (detachedCleanupDrainScheduled || detachedCleanupOwners.size === 0) return;
  detachedCleanupDrainScheduled = true;
  queueMicrotask(() => {
    detachedCleanupDrainScheduled = false;
    for (const owner of [...detachedCleanupOwners]) {
      try {
        if (owner.dispose()) detachedCleanupOwners.delete(owner);
      } catch {
        // A later explicit settlement signal re-checks this exact owner.
      }
    }
  });
}

const INACTIVE_SNAPSHOTS: EditorChangeHunksSnapshotPort = Object.freeze({
  capture: () => ({ reason: "aborted" as const, status: "rejected" as const }),
  consumeCurrent: () => false,
  release: () => false,
  subscribe: () => () => undefined,
});
const STALE_CONTENT_CAPTURE = Object.freeze({
  reason: "stale" as const,
  status: "rejected" as const,
});
const SOURCE_FAILED_CONTENT_CAPTURE = Object.freeze({
  reason: "source-failed" as const,
  status: "rejected" as const,
});
import { useCallback, useMemo, useState } from "react";
