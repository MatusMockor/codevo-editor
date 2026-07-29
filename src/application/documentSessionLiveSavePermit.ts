import type {
  DocumentSessionLiveAttachmentLease,
  DocumentSessionLiveCheckpoint,
  DocumentSessionReceipt,
  DocumentSessionSavePermit,
  DocumentSessionSaveAcknowledgement,
} from "../domain/documentSession";
import { MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS } from "../domain/liveDocumentContentAuthority";
import type { WorkspaceFileRevision } from "../domain/workspace";

export const MAX_ISSUED_SAVES_PER_DOCUMENT = 8;

export interface DocumentSessionIssuedSaveRecord {
  readonly authority: object;
  readonly liveAttachment: DocumentSessionLiveAttachmentLease | null;
  readonly liveCheckpoint: DocumentSessionLiveCheckpoint | null;
  readonly liveSourceIncarnation: object | null;
  readonly permit: DocumentSessionSavePermit;
}

export interface DocumentSessionIssuedSaveLedger {
  readonly issuedSaves: Map<number, DocumentSessionIssuedSaveRecord>;
  issuedSaveEstimatedBytes: number;
}

export function issuedSaveBytes(issued: DocumentSessionIssuedSaveRecord): number {
  return issued.permit.writtenContent.length * 2;
}

export function issuedSaveBytesThrough(
  ledger: DocumentSessionIssuedSaveLedger,
  sequence: number,
): number {
  let bytes = 0;
  for (const [candidate, issued] of ledger.issuedSaves) {
    if (candidate <= sequence) bytes += issuedSaveBytes(issued);
  }
  return bytes;
}

export function removeIssuedSave(
  ledger: DocumentSessionIssuedSaveLedger,
  sequence: number,
): number {
  const issued = ledger.issuedSaves.get(sequence);
  if (!issued || !ledger.issuedSaves.delete(sequence)) return 0;
  const bytes = issuedSaveBytes(issued);
  ledger.issuedSaveEstimatedBytes -= bytes;
  return bytes;
}

export function removeIssuedSavesThrough(
  ledger: DocumentSessionIssuedSaveLedger,
  sequence: number,
): number {
  let bytes = 0;
  for (const candidate of [...ledger.issuedSaves.keys()]) {
    if (candidate <= sequence) bytes += removeIssuedSave(ledger, candidate);
  }
  return bytes;
}

export function replaceIssuedSaveRecord(
  ledger: DocumentSessionIssuedSaveLedger,
  sequence: number,
  expected: DocumentSessionIssuedSaveRecord,
  replacement: DocumentSessionIssuedSaveRecord,
  admitAdditionalBytes: (bytes: number) => boolean,
): number | null {
  const current = ledger.issuedSaves.get(sequence);
  if (current !== expected) return null;
  const delta = issuedSaveBytes(replacement) - issuedSaveBytes(current);
  if (delta > 0 && !admitAdditionalBytes(delta)) return null;
  if (ledger.issuedSaves.get(sequence) !== expected) return null;
  ledger.issuedSaves.set(sequence, replacement);
  ledger.issuedSaveEstimatedBytes += delta;
  return delta;
}

export function storeIssuedSaveRecord(
  ledger: DocumentSessionIssuedSaveLedger,
  sequence: number,
  issued: DocumentSessionIssuedSaveRecord,
  admitBytes: (bytes: number) => boolean,
): number | null {
  const bytes = issuedSaveBytes(issued);
  if (!admitBytes(bytes)) return null;
  ledger.issuedSaves.set(sequence, issued);
  ledger.issuedSaveEstimatedBytes += bytes;
  return bytes;
}

export function issueLegacySavePermit(
  document: {
    readonly document: { readonly content: string };
    readonly issuedSaves: Map<number, DocumentSessionIssuedSaveRecord>;
    issuedSaveEstimatedBytes: number;
    readonly liveAttachment: {
      readonly checkpoint: DocumentSessionLiveCheckpoint;
      readonly sourceIncarnation: object;
    } | null;
    readonly liveDirty: boolean;
    nextSaveSequence: number;
  },
  receipt: DocumentSessionReceipt,
  admitBytes: (bytes: number) => boolean,
): { readonly bytes: number; readonly permit: DocumentSessionSavePermit } | null {
  if (
    document.issuedSaves.size >= MAX_ISSUED_SAVES_PER_DOCUMENT ||
    !Number.isSafeInteger(document.nextSaveSequence) ||
    document.nextSaveSequence < 0 ||
    document.nextSaveSequence >= Number.MAX_SAFE_INTEGER
  ) {
    return null;
  }
  const bytes = document.document.content.length * 2;
  if (!admitBytes(bytes)) return null;
  const sequence = ++document.nextSaveSequence;
  const live = document.liveAttachment && !document.liveDirty ? document.liveAttachment : null;
  const prepared = prepareLegacySavePermit({
    liveCheckpoint: live?.checkpoint ?? null,
    liveSourceIncarnation: live?.sourceIncarnation ?? null,
    receipt,
    sequence,
    writtenContent: document.document.content,
  });
  document.issuedSaves.set(sequence, prepared.record);
  document.issuedSaveEstimatedBytes += bytes;
  return Object.freeze({ bytes, permit: prepared.permit });
}

export function prepareLegacySavePermit(input: {
  readonly liveCheckpoint: DocumentSessionLiveCheckpoint | null;
  readonly liveSourceIncarnation: object | null;
  readonly receipt: DocumentSessionReceipt;
  readonly sequence: number;
  readonly writtenContent: string;
}): {
  readonly permit: DocumentSessionSavePermit;
  readonly record: DocumentSessionIssuedSaveRecord;
} {
  const authority = Object.freeze({});
  const receipt = freezeReceipt(input.receipt);
  const permit = Object.freeze({
    authority,
    receipt,
    sequence: input.sequence,
    writtenContent: input.writtenContent,
  });
  return Object.freeze({
    permit,
    record: Object.freeze({
      authority,
      liveAttachment: null,
      liveCheckpoint: input.liveCheckpoint,
      liveSourceIncarnation: input.liveSourceIncarnation,
      permit,
    }),
  });
}

export function prepareLiveSavePermit(input: {
  readonly attachment: DocumentSessionLiveAttachmentLease;
  readonly checkpoint: DocumentSessionLiveCheckpoint;
  readonly content: string;
  readonly receipt: DocumentSessionReceipt;
  readonly sequence: number;
}): {
  readonly permit: DocumentSessionSavePermit;
  readonly record: DocumentSessionIssuedSaveRecord;
} | null {
  const checkpoint = snapshotLiveSaveCheckpoint(input.checkpoint);
  if (
    !checkpoint ||
    typeof input.content !== "string" ||
    !Number.isSafeInteger(input.sequence) ||
    input.sequence <= 0 ||
    input.content.length > MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS ||
    checkpoint.utf16Length !== input.content.length
  ) {
    return null;
  }
  const authority = Object.freeze({});
  const receipt = freezeReceipt(input.receipt);
  const permit = Object.freeze({
    authority,
    receipt,
    sequence: input.sequence,
    writtenContent: input.content,
  });
  return Object.freeze({
    permit,
    record: Object.freeze({
      authority,
      liveAttachment: input.attachment,
      liveCheckpoint: checkpoint,
      liveSourceIncarnation: input.attachment.sourceIncarnation,
      permit,
    }),
  });
}

export function snapshotDocumentSessionReceipt(
  receipt: DocumentSessionReceipt,
): DocumentSessionReceipt | null {
  try {
    const snapshot = freezeReceipt(receipt);
    return exactKeys(receipt, [
      "contentVersion",
      "documentIncarnation",
      "identityKey",
      "ownerGeneration",
      "ownerIncarnation",
      "ownerKey",
      "version",
    ]) &&
      Number.isSafeInteger(snapshot.contentVersion) &&
      snapshot.contentVersion >= 0 &&
      typeof snapshot.documentIncarnation === "object" &&
      snapshot.documentIncarnation !== null &&
      typeof snapshot.identityKey === "string" &&
      Number.isSafeInteger(snapshot.ownerGeneration) &&
      snapshot.ownerGeneration > 0 &&
      typeof snapshot.ownerIncarnation === "object" &&
      snapshot.ownerIncarnation !== null &&
      typeof snapshot.ownerKey === "string" &&
      Number.isSafeInteger(snapshot.version) &&
      snapshot.version >= 0
      ? snapshot
      : null;
  } catch {
    return null;
  }
}

export function prepareAdvancedLiveSavePermit(input: {
  readonly checkpoint: DocumentSessionLiveCheckpoint;
  readonly content: string;
  readonly current: {
    readonly checkpoint: DocumentSessionLiveCheckpoint;
    readonly holders: ReadonlyMap<object, { readonly lease: DocumentSessionLiveAttachmentLease }>;
    readonly sourceIncarnation: object;
  } | null;
  readonly issued: DocumentSessionIssuedSaveRecord;
}): ReturnType<typeof prepareLiveSavePermit> {
  const checkpoint = snapshotLiveSaveCheckpoint(input.checkpoint);
  const attachment = input.issued.liveAttachment;
  if (
    !checkpoint ||
    !attachment ||
    !issuedLiveSaveAttachmentIsCurrent(input.current, input.issued) ||
    !liveSaveCheckpointMatches(input.current, attachment, checkpoint)
  ) {
    return null;
  }
  return prepareLiveSavePermit({
    attachment,
    checkpoint,
    content: input.content,
    receipt: input.issued.permit.receipt,
    sequence: input.issued.permit.sequence,
  });
}

export function snapshotLiveSaveCheckpoint(
  checkpoint: DocumentSessionLiveCheckpoint,
): DocumentSessionLiveCheckpoint | null {
  try {
    const snapshot = freezeCheckpoint(checkpoint);
    return validCheckpoint(snapshot) ? snapshot : null;
  } catch {
    return null;
  }
}

/**
 * Rebinds an already-issued exact live save to content produced by trusted
 * save participants. The retained checkpoint continues to identify the source
 * snapshot; its length intentionally need not match the transformed output.
 */
export function replaceLiveSavePermitContent(input: {
  readonly issued: DocumentSessionIssuedSaveRecord;
  readonly content: string;
}): {
  readonly permit: DocumentSessionSavePermit;
  readonly record: DocumentSessionIssuedSaveRecord;
} | null {
  const { issued, content } = input;
  if (
    !issued.liveAttachment ||
    !issued.liveCheckpoint ||
    typeof content !== "string" ||
    content.length > MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS ||
    !validIssuedSavePermitShape(issued.permit)
  ) {
    return null;
  }
  const authority = Object.freeze({});
  const permit = Object.freeze({
    authority,
    receipt: issued.permit.receipt,
    sequence: issued.permit.sequence,
    writtenContent: content,
  });
  return Object.freeze({
    permit,
    record: Object.freeze({
      authority,
      liveAttachment: issued.liveAttachment,
      liveCheckpoint: issued.liveCheckpoint,
      liveSourceIncarnation: issued.liveSourceIncarnation,
      permit,
    }),
  });
}

export function issuedLiveSaveAttachmentIsCurrent(
  current: {
    readonly holders: ReadonlyMap<object, { readonly lease: DocumentSessionLiveAttachmentLease }>;
    readonly sourceIncarnation: object;
  } | null,
  issued: DocumentSessionIssuedSaveRecord | undefined,
): boolean {
  const attachment = issued?.liveAttachment;
  return (
    !attachment ||
    (current?.sourceIncarnation === attachment.sourceIncarnation &&
      current.holders.get(attachment.holderIncarnation)?.lease === attachment)
  );
}

export function issuedLiveSaveIsCurrent(
  current: {
    readonly checkpoint: DocumentSessionLiveCheckpoint;
    readonly holders: ReadonlyMap<object, { readonly lease: DocumentSessionLiveAttachmentLease }>;
    readonly sourceIncarnation: object;
  } | null,
  issued: DocumentSessionIssuedSaveRecord | undefined,
): boolean {
  return (
    !!issued &&
    issuedLiveSaveAttachmentIsCurrent(current, issued) &&
    (!issued.liveAttachment ||
      (!!issued.liveCheckpoint &&
        liveSaveCheckpointMatches(current, issued.liveAttachment, issued.liveCheckpoint)))
  );
}

export function prepareReplacementLiveSavePermit(
  current: Parameters<typeof issuedLiveSaveIsCurrent>[0],
  issued: DocumentSessionIssuedSaveRecord | undefined,
  content: string,
): ReturnType<typeof replaceLiveSavePermitContent> {
  if (!issued?.liveAttachment || !issuedLiveSaveIsCurrent(current, issued)) return null;
  return replaceLiveSavePermitContent({ content, issued });
}

export function liveSaveCheckpointMatches(
  current: {
    readonly checkpoint: DocumentSessionLiveCheckpoint;
    readonly sourceIncarnation: object;
  } | null,
  attachment: DocumentSessionLiveAttachmentLease,
  checkpoint: DocumentSessionLiveCheckpoint,
): boolean {
  return (
    current?.sourceIncarnation === attachment.sourceIncarnation &&
    current.checkpoint.alternativeVersionId === checkpoint.alternativeVersionId &&
    current.checkpoint.contentVersion === checkpoint.contentVersion &&
    current.checkpoint.modelVersionId === checkpoint.modelVersionId &&
    current.checkpoint.utf16Length === checkpoint.utf16Length
  );
}

export function validIssuedSavePermitShape(permit: DocumentSessionSavePermit): boolean {
  try {
    const permitKeys = ["authority", "receipt", "sequence", "writtenContent"];
    const receiptKeys = [
      "contentVersion",
      "documentIncarnation",
      "identityKey",
      "ownerGeneration",
      "ownerIncarnation",
      "ownerKey",
      "version",
    ];
    return (
      exactKeys(permit, permitKeys) &&
      exactKeys(permit.receipt, receiptKeys) &&
      typeof permit.authority === "object" &&
      permit.authority !== null &&
      Number.isSafeInteger(permit.sequence) &&
      permit.sequence > 0 &&
      typeof permit.writtenContent === "string"
    );
  } catch {
    return false;
  }
}

export function snapshotSaveAcknowledgement(
  acknowledgement: DocumentSessionSaveAcknowledgement,
): { readonly revision: WorkspaceFileRevision | null | undefined } | null {
  try {
    if (!exactKeys(acknowledgement, ["revision"])) return null;
    const revision = acknowledgement.revision;
    if (revision === null || revision === undefined) {
      return Object.freeze({ revision });
    }
    const keys = [
      "contentHash",
      "device",
      "inode",
      "modifiedNanoseconds",
      "modifiedSeconds",
      "size",
    ];
    if (!exactKeys(revision, keys)) return null;
    const snapshot = {
      contentHash: revision.contentHash,
      device: revision.device,
      inode: revision.inode,
      modifiedNanoseconds: revision.modifiedNanoseconds,
      modifiedSeconds: revision.modifiedSeconds,
      size: revision.size,
    };
    if (
      ![snapshot.contentHash, snapshot.device, snapshot.inode].every(
        (value) => typeof value === "string" && value.length <= 4_096,
      ) ||
      !Number.isSafeInteger(snapshot.modifiedNanoseconds) ||
      snapshot.modifiedNanoseconds < 0 ||
      snapshot.modifiedNanoseconds > 999_999_999 ||
      !Number.isSafeInteger(snapshot.modifiedSeconds) ||
      !Number.isSafeInteger(snapshot.size) ||
      snapshot.size < 0
    ) {
      return null;
    }
    return Object.freeze({ revision: Object.freeze(snapshot) });
  } catch {
    return null;
  }
}

export function acknowledgeLiveSaveCheckpoint(
  current: {
    readonly checkpoint: DocumentSessionLiveCheckpoint;
    savedAlternativeVersionId: number | null;
    savedUtf16Length: number | null;
    readonly sourceIncarnation: object;
  } | null,
  issued: DocumentSessionIssuedSaveRecord,
  writtenUtf16Length: number,
): boolean | null {
  const checkpoint = issued.liveCheckpoint;
  if (!current || !checkpoint || current.sourceIncarnation !== issued.liveSourceIncarnation) {
    return null;
  }
  current.savedAlternativeVersionId = checkpoint.alternativeVersionId;
  current.savedUtf16Length = writtenUtf16Length;
  return (
    current.checkpoint.alternativeVersionId !== checkpoint.alternativeVersionId ||
    current.checkpoint.utf16Length !== writtenUtf16Length
  );
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => typeof key === "string" && expected.includes(key))
  );
}

function freezeCheckpoint(
  checkpoint: DocumentSessionLiveCheckpoint,
): DocumentSessionLiveCheckpoint {
  return Object.freeze({
    alternativeVersionId: checkpoint.alternativeVersionId,
    contentVersion: checkpoint.contentVersion,
    modelVersionId: checkpoint.modelVersionId,
    utf16Length: checkpoint.utf16Length,
  });
}

function freezeReceipt(receipt: DocumentSessionReceipt): DocumentSessionReceipt {
  return Object.freeze({
    contentVersion: receipt.contentVersion,
    documentIncarnation: receipt.documentIncarnation,
    identityKey: receipt.identityKey,
    ownerGeneration: receipt.ownerGeneration,
    ownerIncarnation: receipt.ownerIncarnation,
    ownerKey: receipt.ownerKey,
    version: receipt.version,
  });
}

function validCheckpoint(checkpoint: DocumentSessionLiveCheckpoint): boolean {
  try {
    const expectedKeys = [
      "alternativeVersionId",
      "contentVersion",
      "modelVersionId",
      "utf16Length",
    ];
    const keys = Reflect.ownKeys(checkpoint);
    return (
      keys.length === expectedKeys.length &&
      keys.every((key) => typeof key === "string" && expectedKeys.includes(key)) &&
      Number.isSafeInteger(checkpoint.alternativeVersionId) &&
      checkpoint.alternativeVersionId > 0 &&
      Number.isSafeInteger(checkpoint.contentVersion) &&
      checkpoint.contentVersion > 0 &&
      Number.isSafeInteger(checkpoint.modelVersionId) &&
      checkpoint.modelVersionId > 0 &&
      (checkpoint.utf16Length === null ||
        (Number.isSafeInteger(checkpoint.utf16Length) && checkpoint.utf16Length >= 0))
    );
  } catch {
    return false;
  }
}
