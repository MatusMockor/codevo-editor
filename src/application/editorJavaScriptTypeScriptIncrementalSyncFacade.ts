import type { IncrementalDocumentContentEvent } from "../domain/incrementalDocumentSync";
import {
  AUTHORITATIVE_EDITOR_LIVE_EDIT,
  LEGACY_REQUIRED_EDITOR_LIVE_EDIT,
  editorLiveEditIsAuthoritative,
  type EditorLiveEditArbitrationReceipt,
} from "./editorLiveEditArbitration";
import type { EditorGroupDocumentSessionAuthority } from "./editorSessionDocumentAuthority";
import type {
  EditorJavaScriptTypeScriptIncrementalSyncAttachment,
  EditorJavaScriptTypeScriptIncrementalSyncPort,
  EditorJavaScriptTypeScriptIncrementalSyncSource,
} from "./javaScriptTypeScriptIncrementalSyncProduction";

export interface EditorJavaScriptTypeScriptIncrementalSyncFacade {
  readonly kind: "editor-javascript-typescript-incremental-sync-facade";
}

export interface EditorJavaScriptTypeScriptIncrementalSyncAttachmentOwner {
  readonly kind: "editor-javascript-typescript-incremental-sync-attachment-owner";
}

export interface EditorJavaScriptTypeScriptIncrementalSyncRegistration {
  readonly id: string;
  readonly isCurrent: () => boolean;
  readonly sessionAuthority: EditorGroupDocumentSessionAuthority;
  readonly source: EditorJavaScriptTypeScriptIncrementalSyncSource;
}

interface OwnedAttachment {
  readonly attachment: EditorJavaScriptTypeScriptIncrementalSyncAttachment | null;
  readonly isCurrent: () => boolean;
  readonly port: EditorJavaScriptTypeScriptIncrementalSyncPort;
  readonly reconciliationIdentity: object | null;
  readonly sessionAuthority: EditorGroupDocumentSessionAuthority;
  readonly source: EditorJavaScriptTypeScriptIncrementalSyncSource;
  readonly token: object;
}

interface AttachmentOwnerCapabilities {
  readonly entries: Map<string, OwnedAttachment>;
}

const facadeCapabilities = new WeakMap<
  EditorJavaScriptTypeScriptIncrementalSyncFacade,
  EditorJavaScriptTypeScriptIncrementalSyncPort
>();
const facadesByPort = new WeakMap<
  EditorJavaScriptTypeScriptIncrementalSyncPort,
  EditorJavaScriptTypeScriptIncrementalSyncFacade
>();
const ownerCapabilities = new WeakMap<
  EditorJavaScriptTypeScriptIncrementalSyncAttachmentOwner,
  AttachmentOwnerCapabilities
>();

export function editorJavaScriptTypeScriptIncrementalSyncFacade(
  port: EditorJavaScriptTypeScriptIncrementalSyncPort,
): EditorJavaScriptTypeScriptIncrementalSyncFacade {
  const existing = facadesByPort.get(port);
  if (existing) return existing;
  const facade = Object.freeze({
    kind: "editor-javascript-typescript-incremental-sync-facade" as const,
  });
  facadesByPort.set(port, facade);
  facadeCapabilities.set(facade, port);
  return facade;
}

export function optionalEditorJavaScriptTypeScriptIncrementalSyncFacade(
  port: EditorJavaScriptTypeScriptIncrementalSyncPort | null,
): EditorJavaScriptTypeScriptIncrementalSyncFacade | null {
  return port ? editorJavaScriptTypeScriptIncrementalSyncFacade(port) : null;
}

export function createEditorJavaScriptTypeScriptIncrementalSyncAttachmentOwner(): EditorJavaScriptTypeScriptIncrementalSyncAttachmentOwner {
  const owner = Object.freeze({
    kind: "editor-javascript-typescript-incremental-sync-attachment-owner" as const,
  });
  ownerCapabilities.set(owner, { entries: new Map() });
  return owner;
}

export function reconcileEditorJavaScriptTypeScriptIncrementalSyncAttachments(
  owner: EditorJavaScriptTypeScriptIncrementalSyncAttachmentOwner,
  facade: EditorJavaScriptTypeScriptIncrementalSyncFacade | null,
  registrations: readonly EditorJavaScriptTypeScriptIncrementalSyncRegistration[],
): void {
  const owned = ownerCapabilities.get(owner);
  if (!owned) return;
  const port = facade ? (facadeCapabilities.get(facade) ?? null) : null;
  const reconciliationIdentity = safeReconciliationIdentity(port);
  const desired = new Map(registrations.map((registration) => [registration.id, registration]));
  for (const [id, entry] of [...owned.entries]) {
    const next = desired.get(id);
    if (
      next &&
      port === entry.port &&
      reconciliationIdentity === entry.reconciliationIdentity &&
      next.sessionAuthority === entry.sessionAuthority &&
      next.source.model === entry.source.model &&
      next.source.languageId === entry.source.languageId &&
      safelyCurrent(next.isCurrent)
    ) {
      owned.entries.set(id, { ...entry, isCurrent: next.isCurrent, source: next.source });
      desired.delete(id);
      continue;
    }
    owned.entries.delete(id);
    if (entry.attachment) void entry.port.release(entry.attachment);
  }
  if (!port) return;
  for (const [id, registration] of desired) {
    if (!safelyCurrent(registration.isCurrent)) continue;
    const token = Object.freeze({});
    const pending: OwnedAttachment = {
      attachment: null,
      isCurrent: registration.isCurrent,
      port,
      reconciliationIdentity,
      sessionAuthority: registration.sessionAuthority,
      source: registration.source,
      token,
    };
    owned.entries.set(id, pending);
    let attachment: EditorJavaScriptTypeScriptIncrementalSyncAttachment | null = null;
    try {
      attachment = port.attach(
        registration.sessionAuthority,
        registration.source,
        registration.isCurrent,
      );
    } catch {
      // Admission failures leave the legacy lifecycle in application control.
    }
    const current = owned.entries.get(id);
    if (!attachment || current?.token !== token || !safelyCurrent(registration.isCurrent)) {
      if (attachment) void port.release(attachment);
      if (owned.entries.get(id)?.token === token) owned.entries.delete(id);
      continue;
    }
    owned.entries.set(id, { ...current, attachment });
  }
}

export function observeEditorJavaScriptTypeScriptIncrementalSyncAttachment(
  owner: EditorJavaScriptTypeScriptIncrementalSyncAttachmentOwner,
  id: string,
  event: IncrementalDocumentContentEvent,
): EditorLiveEditArbitrationReceipt {
  const entry = ownerCapabilities.get(owner)?.entries.get(id);
  if (!entry?.attachment || !safelyCurrent(entry.isCurrent)) {
    return LEGACY_REQUIRED_EDITOR_LIVE_EDIT;
  }
  try {
    const receipt = entry.port.observe(entry.attachment, event);
    const accepted = editorLiveEditIsAuthoritative(receipt);
    return ownerCapabilities.get(owner)?.entries.get(id) === entry &&
      safelyCurrent(entry.isCurrent) &&
      accepted
      ? AUTHORITATIVE_EDITOR_LIVE_EDIT
      : LEGACY_REQUIRED_EDITOR_LIVE_EDIT;
  } catch {
    // Application arbitration fails closed; the legacy subscriber remains available.
    return LEGACY_REQUIRED_EDITOR_LIVE_EDIT;
  }
}

export function isEditorJavaScriptTypeScriptIncrementalSyncAttachmentCurrent(
  owner: EditorJavaScriptTypeScriptIncrementalSyncAttachmentOwner,
  id: string,
): boolean {
  const entry = ownerCapabilities.get(owner)?.entries.get(id);
  return Boolean(
    entry?.attachment &&
    safelyCurrent(entry.isCurrent) &&
    ownerCapabilities.get(owner)?.entries.get(id) === entry,
  );
}

export function currentEditorJavaScriptTypeScriptIncrementalSyncSemanticMode(
  owner: EditorJavaScriptTypeScriptIncrementalSyncAttachmentOwner,
  id: string,
): EditorJavaScriptTypeScriptIncrementalSyncAttachment["semanticMode"] | null {
  const entry = ownerCapabilities.get(owner)?.entries.get(id);
  return entry?.attachment &&
    safelyCurrent(entry.isCurrent) &&
    ownerCapabilities.get(owner)?.entries.get(id) === entry
    ? entry.attachment.semanticMode
    : null;
}

export function disposeEditorJavaScriptTypeScriptIncrementalSyncAttachments(
  owner: EditorJavaScriptTypeScriptIncrementalSyncAttachmentOwner,
): void {
  const owned = ownerCapabilities.get(owner);
  if (!owned) return;
  for (const entry of owned.entries.values()) {
    if (entry.attachment) void entry.port.release(entry.attachment);
  }
  owned.entries.clear();
}

function safeReconciliationIdentity(
  port: EditorJavaScriptTypeScriptIncrementalSyncPort | null,
): object | null {
  if (!port) return null;
  try {
    return port.reconciliationIdentity();
  } catch {
    return null;
  }
}

function safelyCurrent(isCurrent: () => boolean): boolean {
  try {
    return isCurrent();
  } catch {
    return false;
  }
}
