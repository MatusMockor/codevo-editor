import { describe, expect, it, vi } from "vitest";
import { createWorkspaceEditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import type {
  DocumentSessionDocumentLease,
  DocumentSessionLiveAttachmentLease,
  DocumentSessionLiveCheckpoint,
  DocumentSessionOwnerLease,
  DocumentSessionSavePermit,
  DocumentSessionStoreLimits,
} from "../domain/documentSession";
import { MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS } from "../domain/liveDocumentContentAuthority";
import type { EditorDocument } from "../domain/workspace";
import {
  createDocumentSaveIdentity,
  createRegisteredDocumentSaveIdentity,
  type DocumentSaveIdentity,
} from "./documentSaveIdentity";
import { issueLegacySavePermit, prepareLiveSavePermit } from "./documentSessionLiveSavePermit";
import { DocumentSessionStore } from "./documentSessionStore";

const ROOT_A = "/workspace/a";
const ROOT_B = "/workspace/b";
const WORKSPACE_A = "workspace-a";
const WORKSPACE_B = "workspace-b";
const OWNER_A = createWorkspaceEditorSessionOwnerKey(ROOT_A);
const OWNER_B = createWorkspaceEditorSessionOwnerKey(ROOT_B);

describe("DocumentSessionStore", () => {
  it("rejects throwing receipt accessors and exhausted save sequences before admission", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const document = open(store, owner, "src/a.ts", "base");
    const receipt = store.capture(document)!;
    const throwingReceipt = Object.create(null) as typeof receipt;
    for (const key of Object.keys(receipt) as Array<keyof typeof receipt>) {
      Object.defineProperty(throwingReceipt, key, {
        enumerable: true,
        get: () => {
          if (key === "ownerKey") throw new Error("hostile receipt");
          return receipt[key];
        },
      });
    }
    expect(() => store.issueSave(throwingReceipt)).not.toThrow();
    expect(store.issueSave(throwingReceipt)).toBeNull();
    const retry = store.issueSave(receipt);
    expect(retry).not.toBeNull();
    expect(store.cancelSave(retry!)).toBe(true);

    const admitBytes = vi.fn(() => true);
    expect(
      issueLegacySavePermit(
        {
          document: { content: "base" },
          issuedSaveEstimatedBytes: 0,
          issuedSaves: new Map(),
          liveAttachment: null,
          liveDirty: false,
          nextSaveSequence: Number.MAX_SAFE_INTEGER,
        },
        receipt,
        admitBytes,
      ),
    ).toBeNull();
    expect(admitBytes).not.toHaveBeenCalled();

    const attachment = attach(store, document, checkpoint(1, 1, 1, 4));
    expect(
      prepareLiveSavePermit({
        attachment,
        checkpoint: checkpoint(1, 1, 1, 4),
        content: "base",
        receipt,
        sequence: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toBeNull();
  });

  it("tracks one hundred compact checkpoints without replacing retained document content", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const document = open(store, owner, "src/large.ts", "x".repeat(1024 * 1024));
    const documentListener = vi.fn();
    const ownerListener = vi.fn();
    store.subscribeDocument(document, documentListener);
    store.subscribeOwner(owner, ownerListener);
    const initialSnapshot = available(store, document);
    const retainedDocument = initialSnapshot.document;
    const retainedBytes = initialSnapshot.estimatedRetainedBytes;
    const attachment = attach(
      store,
      document,
      checkpoint(1, 1, 1, retainedDocument.content.length),
    );

    let dirtySnapshot = initialSnapshot;
    for (let index = 1; index <= 100; index += 1) {
      const result = store.checkpointLiveDocument(
        attachment,
        checkpoint(
          index === 100 ? 1 : index + 1,
          index + 1,
          index + 1,
          index === 100 ? retainedDocument.content.length : retainedDocument.content.length + index,
        ),
      );
      expect(result.status).toBe("applied");
      const current = available(store, document);
      expect(current.document).toBe(retainedDocument);
      expect(current.estimatedRetainedBytes).toBe(retainedBytes);
      expect(current.contentVersion).toBe(0);
      expect(current.version).toBe(0);
      if (index === 1) {
        dirtySnapshot = current;
        expect(current.dirty).toBe(true);
      } else if (index < 100) {
        expect(current).toBe(dirtySnapshot);
      }
    }

    expect(available(store, document)).toMatchObject({ dirty: false });
    expect(documentListener).toHaveBeenCalledTimes(2);
    expect(ownerListener).toHaveBeenCalledTimes(2);
    expect(store.getOwnerSnapshot(owner)).toMatchObject({ dirtyCount: 0 });
  });

  it("joins bounded holders for one source and rotates all holders for a replacement source", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const document = open(store, owner, "src/a.ts", "base");
    const source = Object.freeze({});
    const base = checkpoint(1, 1, 1, 4);
    const holders = Array.from({ length: 16 }, () =>
      attach(store, document, base, source, Object.freeze({})),
    );

    expect(
      store.attachLiveDocument(store.capture(document)!, {
        checkpoint: base,
        holderIncarnation: holders[0].holderIncarnation,
        sourceIncarnation: source,
        synchronization: null,
      }),
    ).toEqual({ reason: "duplicate-holder", status: "rejected" });
    expect(
      store.attachLiveDocument(store.capture(document)!, {
        checkpoint: base,
        holderIncarnation: Object.freeze({}),
        sourceIncarnation: source,
        synchronization: null,
      }),
    ).toEqual({ reason: "attachment-limit", status: "rejected" });

    const changed = checkpoint(2, 2, 2, 5);
    expect(store.checkpointLiveDocument(holders[0], changed)).toEqual({
      dirty: true,
      status: "applied",
    });
    expect(store.checkpointLiveDocument(holders[0], changed)).toEqual({
      reason: "stale-attachment",
      status: "rejected",
    });
    expect(store.checkpointLiveDocument(holders[1], changed)).toEqual({
      dirty: true,
      status: "applied",
    });
    expect(store.checkpointLiveDocument(holders[1], changed)).toEqual({
      reason: "stale-attachment",
      status: "rejected",
    });
    expect(store.detachLiveDocument(holders[0])).toBe(true);
    expect(store.checkpointLiveDocument(holders[0], checkpoint(3, 3, 3, 6))).toEqual({
      reason: "stale-attachment",
      status: "rejected",
    });
    expect(store.checkpointLiveDocument(holders[1], checkpoint(3, 3, 3, 6)).status).toBe("applied");

    const replacement = attach(
      store,
      document,
      checkpoint(3, 3, 3, 6),
      Object.freeze({}),
      Object.freeze({}),
    );
    expect(store.checkpointLiveDocument(holders[1], checkpoint(4, 4, 4, 7))).toEqual({
      reason: "stale-attachment",
      status: "rejected",
    });
    expect(store.checkpointLiveDocument(replacement, checkpoint(4, 4, 4, 7))).toEqual({
      dirty: true,
      status: "applied",
    });
    expect(available(store, document).dirty).toBe(true);
  });

  it("fails stale, foreign, malformed, reordered, and reentrant live checkpoints closed", () => {
    const store = new DocumentSessionStore();
    const ownerA = activate(store, OWNER_A, ROOT_A);
    const documentA = open(store, ownerA, "src/a.ts", "a");
    const attachment = attach(store, documentA, checkpoint(1, 1, 1, 1));
    expect(
      store.attachLiveDocument(store.capture(documentA)!, {
        checkpoint: { ...checkpoint(1, 1, 1, 1), extra: true } as DocumentSessionLiveCheckpoint,
        holderIncarnation: Object.freeze({}),
        sourceIncarnation: Object.freeze({}),
        synchronization: null,
      }),
    ).toEqual({ reason: "invalid-checkpoint", status: "rejected" });

    for (const malformed of [
      checkpoint(0, 1, 1, 1),
      checkpoint(1, 0, 1, 1),
      checkpoint(1, 1, Number.MAX_SAFE_INTEGER + 1, 1),
      checkpoint(1, 1, 1, -1),
      { ...checkpoint(1, 1, 1, 1), extra: true },
    ]) {
      expect(
        store.checkpointLiveDocument(attachment, malformed as DocumentSessionLiveCheckpoint),
      ).toEqual({ reason: "invalid-checkpoint", status: "rejected" });
    }
    expect(store.checkpointLiveDocument(attachment, checkpoint(2, 2, 2, 2)).status).toBe("applied");
    expect(store.checkpointLiveDocument(attachment, checkpoint(3, 2, 3, 3))).toEqual({
      reason: "stale-attachment",
      status: "rejected",
    });

    const nested = vi.fn();
    store.subscribeDocument(documentA, () => {
      nested(store.checkpointLiveDocument(attachment, checkpoint(3, 3, 3, 3)));
    });
    expect(store.checkpointLiveDocument(attachment, checkpoint(1, 3, 3, 1)).status).toBe("applied");
    expect(nested).toHaveBeenCalledWith({
      reason: "reentrant-operation",
      status: "rejected",
    });

    activate(store, OWNER_B, ROOT_B);
    expect(store.checkpointLiveDocument(attachment, checkpoint(4, 4, 4, 4))).toEqual({
      reason: "stale-attachment",
      status: "rejected",
    });
    const nextA = activate(store, OWNER_A, ROOT_A);
    const restored = store.resolve(nextA, identity(ROOT_A, "src/a.ts"))!;
    expect(store.checkpointLiveDocument(attachment, checkpoint(4, 4, 4, 4))).toEqual({
      reason: "stale-attachment",
      status: "rejected",
    });
    const resumed = attach(
      store,
      restored,
      checkpoint(1, 3, 3, 1),
      attachment.sourceIncarnation,
      attachment.holderIncarnation,
    );
    expect(store.checkpointLiveDocument(resumed, checkpoint(2, 4, 4, 2)).status).toBe("applied");
    expect(store.checkpointLiveDocument(resumed, checkpoint(1, 5, 5, 1))).toEqual({
      dirty: false,
      status: "applied",
    });
    const foreign = open(store, nextA, "src/foreign.ts", "foreign");
    const foreignAttachment = attach(store, foreign, checkpoint(1, 1, 1, 7));
    expect(store.checkpointLiveDocument(foreignAttachment, checkpoint(2, 2, 2, 8)).status).toBe(
      "applied",
    );
    expect(available(store, restored).dirty).toBe(false);
  });

  it("retains the saved checkpoint after the final holder detaches", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const document = open(store, owner, "src/a.ts", "base");
    const source = Object.freeze({});
    const holder = Object.freeze({});
    const attachment = attach(store, document, checkpoint(1, 1, 1, 4), source, holder);
    expect(store.checkpointLiveDocument(attachment, checkpoint(2, 2, 2, 5)).status).toBe("applied");
    expect(store.detachLiveDocument(attachment)).toBe(true);

    const resumed = attach(store, document, checkpoint(2, 2, 2, 5), source, holder);
    expect(store.checkpointLiveDocument(resumed, checkpoint(1, 3, 3, 4))).toEqual({
      dirty: false,
      status: "applied",
    });
    expect(available(store, document).dirty).toBe(false);
  });

  it("fails a length-mismatched initial or replacement source dirty", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const initialMismatch = open(store, owner, "src/initial.ts", "base");
    attach(store, initialMismatch, checkpoint(1, 1, 1, 5));
    expect(available(store, initialMismatch).dirty).toBe(true);
    expect(store.close(store.capture(initialMismatch)!)).toEqual({
      reason: "dirty-document",
      status: "rejected",
    });

    const replacementMismatch = open(store, owner, "src/replacement.ts", "base");
    attach(store, replacementMismatch, checkpoint(1, 1, 1, 4));
    expect(available(store, replacementMismatch).dirty).toBe(false);
    attach(
      store,
      replacementMismatch,
      checkpoint(1, 1, 1, null),
      Object.freeze({}),
      Object.freeze({}),
    );
    expect(available(store, replacementMismatch).dirty).toBe(true);
  });

  it("requires a single-use exact synchronization permit to seed a source clean", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const divergent = open(store, owner, "src/divergent.ts", "base");
    attach(store, divergent, checkpoint(1, 1, 1, 4), Object.freeze({}), Object.freeze({}), "evil");
    expect(available(store, divergent).dirty).toBe(true);

    const document = open(store, owner, "src/a.ts", "base");
    const receipt = store.capture(document)!;
    const base = checkpoint(1, 1, 1, 4);
    const source = Object.freeze({});
    expect(store.issueLiveDocumentSynchronization(receipt, source, base, "evil")).toBeNull();
    const transferable = store.issueLiveDocumentSynchronization(receipt, source, base, "base");
    expect(
      store.attachLiveDocument(receipt, {
        checkpoint: base,
        holderIncarnation: Object.freeze({}),
        sourceIncarnation: Object.freeze({}),
        synchronization: transferable,
      }),
    ).toEqual({ reason: "stale-synchronization", status: "rejected" });
    const permit = store.issueLiveDocumentSynchronization(receipt, source, base, "base");
    expect(permit).not.toBeNull();
    expect(store.issueLiveDocumentSynchronization(receipt, source, base, "base")).toBeNull();

    const holder = Object.freeze({});
    const attached = store.attachLiveDocument(receipt, {
      checkpoint: base,
      holderIncarnation: holder,
      sourceIncarnation: source,
      synchronization: permit,
    });
    expect(attached.status).toBe("attached");
    expect(available(store, document).dirty).toBe(false);
    expect(
      store.attachLiveDocument(receipt, {
        checkpoint: base,
        holderIncarnation: Object.freeze({}),
        sourceIncarnation: Object.freeze({}),
        synchronization: permit,
      }),
    ).toEqual({ reason: "stale-synchronization", status: "rejected" });

    const cancelled = store.issueLiveDocumentSynchronization(receipt, source, base, "base")!;
    expect(store.cancelLiveDocumentSynchronization(cancelled)).toBe(true);
    expect(store.cancelLiveDocumentSynchronization(cancelled)).toBe(true);
    expect(
      store.attachLiveDocument(receipt, {
        checkpoint: base,
        holderIncarnation: Object.freeze({}),
        sourceIncarnation: Object.freeze({}),
        synchronization: cancelled,
      }),
    ).toEqual({ reason: "stale-synchronization", status: "rejected" });

    const stale = store.issueLiveDocumentSynchronization(receipt, source, base, "base")!;
    expect(store.edit(receipt, "dirty").status).toBe("applied");
    expect(
      store.attachLiveDocument(store.capture(document)!, {
        checkpoint: base,
        holderIncarnation: Object.freeze({}),
        sourceIncarnation: Object.freeze({}),
        synchronization: stale,
      }),
    ).toEqual({ reason: "stale-synchronization", status: "rejected" });
  });

  it("accepts bounded reentrant detach cleanup and settles stale detach idempotently", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const document = open(store, owner, "src/a.ts", "base");
    const source = Object.freeze({});
    const holder = Object.freeze({});
    const attachment = attach(store, document, checkpoint(1, 1, 1, 4), source, holder);
    let detached = false;
    let reentrantSynchronization: unknown = "not-called";
    store.subscribeDocument(document, () => {
      reentrantSynchronization = store.issueLiveDocumentSynchronization(
        store.capture(document)!,
        source,
        checkpoint(2, 2, 2, 5),
        "base",
      );
      detached = store.detachLiveDocument(attachment);
    });

    expect(store.checkpointLiveDocument(attachment, checkpoint(2, 2, 2, 5)).status).toBe("applied");
    expect(detached).toBe(true);
    expect(reentrantSynchronization).toBeNull();
    expect(store.detachLiveDocument(attachment)).toBe(true);
    const resumed = attach(store, document, checkpoint(2, 2, 2, 5), source, holder);
    expect(resumed).not.toBe(attachment);
  });

  it("settles repeated holder detach without removing a joined peer", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const document = open(store, owner, "src/a.ts", "base");
    const source = Object.freeze({});
    const base = checkpoint(1, 1, 1, 4);
    const first = attach(store, document, base, source, Object.freeze({}));
    const peer = attach(store, document, base, source, Object.freeze({}));

    expect(store.detachLiveDocument(first)).toBe(true);
    expect(store.detachLiveDocument(first)).toBe(true);
    expect(store.checkpointLiveDocument(peer, checkpoint(2, 2, 2, 5))).toEqual({
      dirty: true,
      status: "applied",
    });
    expect(store.detachLiveDocument(peer)).toBe(true);
  });

  it("rejects forged detach provenance while settling exact old source and owner leases", () => {
    const store = new DocumentSessionStore();
    const ownerA = activate(store, OWNER_A, ROOT_A);
    const document = open(store, ownerA, "src/a.ts", "base");
    const sourceA = Object.freeze({});
    const base = checkpoint(1, 1, 1, 4);
    const firstA = attach(store, document, base, sourceA, Object.freeze({}));
    const peerA = attach(store, document, base, sourceA, Object.freeze({}));
    const stolenFields = Object.freeze({ ...firstA });
    const stolenAuthority = Object.freeze({
      ...firstA,
      holderIncarnation: peerA.holderIncarnation,
    });

    expect(store.detachLiveDocument(null as unknown as DocumentSessionLiveAttachmentLease)).toBe(
      false,
    );
    expect(store.detachLiveDocument(stolenFields)).toBe(false);
    expect(store.detachLiveDocument(stolenAuthority)).toBe(false);

    const sourceB = Object.freeze({});
    const firstB = attach(store, document, base, sourceB, Object.freeze({}));
    const peerB = attach(store, document, base, sourceB, Object.freeze({}));
    expect(store.detachLiveDocument(firstA)).toBe(true);
    expect(store.checkpointLiveDocument(peerA, checkpoint(2, 2, 2, 5))).toEqual({
      reason: "stale-attachment",
      status: "rejected",
    });
    expect(store.checkpointLiveDocument(peerB, checkpoint(2, 2, 2, 5))).toEqual({
      dirty: true,
      status: "applied",
    });
    expect(store.detachLiveDocument(firstB)).toBe(true);
    expect(store.checkpointLiveDocument(peerB, checkpoint(3, 3, 3, 6)).status).toBe("applied");

    activate(store, OWNER_B, ROOT_B);
    expect(store.detachLiveDocument(peerB)).toBe(true);

    const foreignStore = new DocumentSessionStore();
    const foreignOwner = activate(foreignStore, OWNER_A, ROOT_A);
    const foreignDocument = open(foreignStore, foreignOwner, "src/a.ts", "base");
    const foreign = attach(foreignStore, foreignDocument, base);
    expect(store.detachLiveDocument(foreign)).toBe(false);
  });

  it("composes live dirty state with legacy edit, save, close, and eviction", () => {
    const store = new DocumentSessionStore(limits({ maxRetainedDocuments: 1 }));
    const ownerA = activate(store, OWNER_A, ROOT_A);
    const document = open(store, ownerA, "src/a.ts", "base");
    const ownerListener = vi.fn();
    store.subscribeOwner(ownerA, ownerListener);
    const attachment = attach(store, document, checkpoint(1, 1, 1, 4));
    expect(store.checkpointLiveDocument(attachment, checkpoint(2, 2, 2, 5)).status).toBe("applied");
    expect(store.edit(store.capture(document)!, "typed").status).toBe("applied");
    expect(store.close(store.capture(document)!)).toEqual({
      reason: "dirty-document",
      status: "rejected",
    });

    const permit = store.issueSave(store.capture(document)!)!;
    expect(store.acknowledgeSave(permit, { revision: null }).status).toBe("applied");
    expect(available(store, document).dirty).toBe(true);

    expect(store.checkpointLiveDocument(attachment, checkpoint(3, 3, 3, 6)).status).toBe("applied");
    const pending = store.issueSave(store.capture(document)!)!;
    expect(store.checkpointLiveDocument(attachment, checkpoint(4, 4, 4, 7)).status).toBe("applied");
    expect(store.edit(store.capture(document)!, "typed later").status).toBe("applied");
    expect(store.acknowledgeSave(pending, { revision: null }).status).toBe("applied");
    expect(available(store, document).dirty).toBe(true);

    activate(store, OWNER_B, ROOT_B);
    expect(store.open(activate(store, OWNER_B, ROOT_B), seed(ROOT_B, "src/b.ts", "b"))).toEqual({
      reason: "document-limit",
      status: "rejected",
    });
    expect(ownerListener).toHaveBeenCalledTimes(2);
  });

  it("preserves live dirty authority across compatibility reconciliation", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const document = open(store, owner, "src/a.ts", "base");
    const attachment = attach(store, document, checkpoint(1, 1, 1, 4));
    expect(store.checkpointLiveDocument(attachment, checkpoint(2, 2, 2, 5)).status).toBe("applied");
    const projection = store.createCompatibilityProjection(owner)!;
    const retained = available(store, document).document;

    const reconciled = store.reconcileCompatibilityProjection(owner, projection.lease, {
      documents: [
        {
          document: retained,
          identity: identity(ROOT_A, "src/a.ts"),
          receipt: store.capture(document)!,
        },
      ],
      ownerSnapshot: store.getOwnerSnapshot(owner),
      removals: [],
    });
    expect(reconciled.status).toBe("applied");
    expect(available(store, document)).toMatchObject({ dirty: true });
    expect(store.getOwnerSnapshot(owner)).toMatchObject({ dirtyCount: 1 });

    expect(
      store.reconcileCompatibilityProjection(owner, projection.lease, {
        documents: [],
        ownerSnapshot: store.getOwnerSnapshot(owner),
        removals: [{ discardDirty: false, receipt: store.capture(document)! }],
      }),
    ).toEqual({ reason: "dirty-document", status: "rejected" });
  });

  it("does not acknowledge unsynchronized live content through a legacy save permit", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const document = open(store, owner, "src/a.ts", "base");
    const attachment = attach(store, document, checkpoint(1, 1, 1, 4));
    expect(store.checkpointLiveDocument(attachment, checkpoint(2, 2, 2, 5)).status).toBe("applied");

    const permit = store.issueSave(store.capture(document)!)!;
    expect(permit.writtenContent).toBe("base");
    expect(store.acknowledgeSave(permit, { revision: null }).status).toBe("applied");
    expect(available(store, document)).toMatchObject({ dirty: true });
  });

  it("acknowledges an exact live snapshot as the clean saved baseline", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const document = open(store, owner, "src/a.ts", "base");
    const attachment = attach(store, document, checkpoint(1, 1, 1, 4));
    const writtenCheckpoint = checkpoint(2, 2, 2, 5);
    expect(store.checkpointLiveDocument(attachment, writtenCheckpoint)).toMatchObject({
      dirty: true,
      status: "applied",
    });

    const permit = store.issueLiveSave(
      store.capture(document)!,
      attachment,
      writtenCheckpoint,
      "typed",
    );
    expect(permit?.writtenContent).toBe("typed");
    expect(store.acknowledgeSave(permit!, { revision: null }).status).toBe("applied");
    expect(available(store, document)).toMatchObject({
      dirty: false,
      document: { content: "typed", savedContent: "typed" },
    });
    expect(store.acknowledgeSave(permit!, { revision: null })).toEqual({
      reason: "stale-receipt",
      status: "rejected",
    });
  });

  it("rebinds an exact live permit to transformed output without weakening its source checkpoint", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const document = open(store, owner, "src/a.ts", "base");
    const attachment = attach(store, document, checkpoint(1, 1, 1, 4));
    const capturedCheckpoint = checkpoint(2, 2, 2, 5);
    expect(store.checkpointLiveDocument(attachment, capturedCheckpoint).status).toBe("applied");
    const captured = store.issueLiveSave(
      store.capture(document)!,
      attachment,
      capturedCheckpoint,
      "typed",
    )!;

    expect(store.isIssuedSaveCurrent(captured)).toBe(true);
    const transformedCheckpoint = checkpoint(3, 3, 3, 20);
    expect(store.checkpointLiveDocument(attachment, transformedCheckpoint).status).toBe("applied");
    const transformed = store.advanceIssuedLiveSave(
      captured,
      transformedCheckpoint,
      "const value = true;\n",
    )!;
    expect(transformed.writtenContent).toBe("const value = true;\n");
    expect(store.isIssuedSaveCurrent(captured)).toBe(false);
    expect(store.isIssuedSaveCurrent(transformed)).toBe(true);
    expect(store.acknowledgeSave(captured, { revision: null }).status).toBe("rejected");
    expect(store.acknowledgeSave(transformed, { revision: null }).status).toBe("applied");
    expect(available(store, document)).toMatchObject({
      dirty: false,
      document: {
        content: "const value = true;\n",
        savedContent: "const value = true;\n",
      },
    });
  });

  it("admits issued and transformed live saves through the exact 10 MiB boundary", () => {
    const maxContent = "x".repeat(MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS);
    const store = new DocumentSessionStore(
      limits({
        maxRetainedEstimatedBytes: MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS * 2 + 4_096,
      }),
    );
    const owner = activate(store, OWNER_A, ROOT_A);
    const document = open(store, owner, "src/a.ts", "base");
    const attachment = attach(store, document, checkpoint(1, 1, 1, 4));
    const capturedCheckpoint = checkpoint(2, 2, 2, 1);
    expect(store.checkpointLiveDocument(attachment, capturedCheckpoint).status).toBe("applied");
    const captured = store.issueLiveSave(
      store.capture(document)!,
      attachment,
      capturedCheckpoint,
      "x",
    )!;

    const transformedCheckpoint = checkpoint(3, 3, 3, MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS);
    expect(store.checkpointLiveDocument(attachment, transformedCheckpoint).status).toBe("applied");
    const transformed = store.advanceIssuedLiveSave(captured, transformedCheckpoint, maxContent);
    expect(transformed?.writtenContent).toHaveLength(MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS);
    expect(store.isIssuedSaveCurrent(captured)).toBe(false);
    expect(store.replaceIssuedSaveContent(transformed!, `${maxContent}x`)).toBeNull();
    expect(store.isIssuedSaveCurrent(transformed!)).toBe(true);
    expect(store.cancelSave(captured)).toBe(false);
    expect(store.cancelSave(transformed!)).toBe(true);

    const retry = store.issueLiveSave(
      store.capture(document)!,
      attachment,
      transformedCheckpoint,
      maxContent,
    );
    expect(retry).not.toBeNull();
    expect(store.cancelSave(retry!)).toBe(true);
  });

  it("charges live permits to the retained budget and reuses the charge on acknowledgement", () => {
    const maxContent = "x".repeat(MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS);
    const permitBoundStore = new DocumentSessionStore(
      limits({
        maxRetainedEstimatedBytes: MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS * 2 + 4_096,
      }),
    );
    const permitOwner = activate(permitBoundStore, OWNER_A, ROOT_A);
    const permitDocument = open(permitBoundStore, permitOwner, "src/a.ts", "base");
    const exactCheckpoint = checkpoint(2, 2, 2, MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS);
    const permitAttachment = attach(permitBoundStore, permitDocument, checkpoint(1, 1, 1, 4));
    expect(permitBoundStore.checkpointLiveDocument(permitAttachment, exactCheckpoint).status).toBe(
      "applied",
    );
    const first = permitBoundStore.issueLiveSave(
      permitBoundStore.capture(permitDocument)!,
      permitAttachment,
      exactCheckpoint,
      maxContent,
    );
    expect(first).not.toBeNull();
    expect(
      permitBoundStore.issueLiveSave(
        permitBoundStore.capture(permitDocument)!,
        permitAttachment,
        exactCheckpoint,
        maxContent,
      ),
    ).toBeNull();
    expect(permitBoundStore.cancelSave(first!)).toBe(true);
    const afterCancel = permitBoundStore.issueLiveSave(
      permitBoundStore.capture(permitDocument)!,
      permitAttachment,
      exactCheckpoint,
      maxContent,
    );
    expect(afterCancel).not.toBeNull();
    expect(afterCancel?.sequence).toBe(first!.sequence + 1);
    expect(permitBoundStore.cancelSave(afterCancel!)).toBe(true);

    const acknowledgementStore = new DocumentSessionStore(
      limits({
        maxRetainedEstimatedBytes: MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS * 4 + 4_096,
      }),
    );
    const acknowledgementOwner = activate(acknowledgementStore, OWNER_A, ROOT_A);
    const acknowledgementDocument = open(
      acknowledgementStore,
      acknowledgementOwner,
      "src/a.ts",
      "base",
    );
    const acknowledgementAttachment = attach(
      acknowledgementStore,
      acknowledgementDocument,
      checkpoint(1, 1, 1, 4),
    );
    expect(
      acknowledgementStore.checkpointLiveDocument(acknowledgementAttachment, exactCheckpoint)
        .status,
    ).toBe("applied");
    const acknowledged = acknowledgementStore.issueLiveSave(
      acknowledgementStore.capture(acknowledgementDocument)!,
      acknowledgementAttachment,
      exactCheckpoint,
      maxContent,
    )!;
    expect(acknowledgementStore.acknowledgeSave(acknowledged, { revision: null }).status).toBe(
      "applied",
    );
    expect(acknowledgementStore.acknowledgeSave(acknowledged, { revision: null })).toEqual({
      reason: "stale-receipt",
      status: "rejected",
    });
  });

  it("keeps a newer live edit dirty after acknowledging transformed disk content", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const document = open(store, owner, "src/a.ts", "base");
    const attachment = attach(store, document, checkpoint(1, 1, 1, 4));
    const capturedCheckpoint = checkpoint(2, 2, 2, 5);
    expect(store.checkpointLiveDocument(attachment, capturedCheckpoint).status).toBe("applied");
    const captured = store.issueLiveSave(
      store.capture(document)!,
      attachment,
      capturedCheckpoint,
      "typed",
    )!;
    const transformedCheckpoint = checkpoint(3, 3, 3, 7);
    expect(store.checkpointLiveDocument(attachment, transformedCheckpoint).status).toBe("applied");
    const transformed = store.advanceIssuedLiveSave(captured, transformedCheckpoint, "typed;\n")!;
    expect(store.checkpointLiveDocument(attachment, checkpoint(4, 4, 4, 11)).status).toBe(
      "applied",
    );
    expect(store.isIssuedSaveCurrent(transformed)).toBe(false);
    expect(store.acknowledgeSave(transformed, { revision: null }).status).toBe("applied");
    expect(available(store, document)).toMatchObject({
      dirty: true,
      document: { content: "typed;\n", savedContent: "typed;\n" },
    });
  });

  it("snapshots an advance checkpoint once and cannot overwrite a reentrant replacement", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const document = open(store, owner, "src/a.ts", "base");
    const currentCheckpoint = checkpoint(2, 2, 2, 5);
    const attachment = attach(store, document, checkpoint(1, 1, 1, 4));
    expect(store.checkpointLiveDocument(attachment, currentCheckpoint).status).toBe("applied");
    const captured = store.issueLiveSave(
      store.capture(document)!,
      attachment,
      currentCheckpoint,
      "typed",
    )!;
    let replacement: DocumentSessionSavePermit | null = null;
    let alternativeVersionReads = 0;
    const reentrantCheckpoint = Object.create(null) as DocumentSessionLiveCheckpoint;
    Object.defineProperties(reentrantCheckpoint, {
      alternativeVersionId: {
        enumerable: true,
        get: () => {
          alternativeVersionReads += 1;
          replacement ??= store.replaceIssuedSaveContent(captured, "newer");
          return alternativeVersionReads === 1 ? 2 : 999;
        },
      },
      contentVersion: { enumerable: true, get: () => 2 },
      modelVersionId: { enumerable: true, get: () => 2 },
      utf16Length: { enumerable: true, get: () => 5 },
    });

    expect(store.advanceIssuedLiveSave(captured, reentrantCheckpoint, "outer")).toBeNull();
    expect(alternativeVersionReads).toBe(1);
    expect(replacement).not.toBeNull();
    expect(store.isIssuedSaveCurrent(captured)).toBe(false);
    expect(store.isIssuedSaveCurrent(replacement!)).toBe(true);
    expect(store.cancelSave(replacement!)).toBe(true);
  });

  it("rejects forged permit clones without consuming the exact live permit", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const document = open(store, owner, "src/a.ts", "base");
    const attachment = attach(store, document, checkpoint(1, 1, 1, 4));
    const exactCheckpoint = checkpoint(2, 2, 2, 5);
    expect(store.checkpointLiveDocument(attachment, exactCheckpoint).status).toBe("applied");
    const first = store.issueLiveSave(
      store.capture(document)!,
      attachment,
      exactCheckpoint,
      "typed",
    )!;

    for (const forged of [
      { ...first, writtenContent: "evil" },
      {
        ...first,
        writtenContent: "x".repeat(MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS + 1),
      },
      { ...first, receipt: { ...first.receipt, version: first.receipt.version + 1 } },
      { ...first, sequence: first.sequence + 1 },
      { ...first, extra: true },
    ] as DocumentSessionSavePermit[]) {
      expect(store.acknowledgeSave(forged, { revision: null })).toEqual({
        reason: "stale-receipt",
        status: "rejected",
      });
      expect(store.cancelSave(forged)).toBe(false);
    }
    expect(store.cancelSave(first)).toBe(true);

    const second = store.issueLiveSave(
      store.capture(document)!,
      attachment,
      exactCheckpoint,
      "typed",
    )!;
    expect(
      store.acknowledgeSave({ ...second, writtenContent: "evil" }, { revision: null }),
    ).toEqual({
      reason: "stale-receipt",
      status: "rejected",
    });
    expect(store.acknowledgeSave(second, { revision: null }).status).toBe("applied");
    expect(available(store, document)).toMatchObject({
      dirty: false,
      document: { content: "typed", savedContent: "typed" },
    });
  });

  it("revalidates the exact live attachment after acknowledgement revision getters", () => {
    const detachedStore = new DocumentSessionStore();
    const detachedOwner = activate(detachedStore, OWNER_A, ROOT_A);
    const detachedDocument = open(detachedStore, detachedOwner, "src/a.ts", "base");
    const exactCheckpoint = checkpoint(1, 1, 1, 4);
    const detachedAttachment = attach(detachedStore, detachedDocument, exactCheckpoint);
    const detachedPermit = detachedStore.issueLiveSave(
      detachedStore.capture(detachedDocument)!,
      detachedAttachment,
      exactCheckpoint,
      "base",
    )!;
    const detachingAcknowledgement = Object.create(null) as { readonly revision: null };
    Object.defineProperty(detachingAcknowledgement, "revision", {
      enumerable: true,
      get: () => {
        detachedStore.detachLiveDocument(detachedAttachment);
        return null;
      },
    });
    expect(detachedStore.acknowledgeSave(detachedPermit, detachingAcknowledgement)).toEqual({
      reason: "stale-receipt",
      status: "rejected",
    });

    const replacedStore = new DocumentSessionStore();
    const replacedOwner = activate(replacedStore, OWNER_A, ROOT_A);
    const replacedDocument = open(replacedStore, replacedOwner, "src/a.ts", "base");
    const replacedAttachment = attach(replacedStore, replacedDocument, exactCheckpoint);
    const replacedPermit = replacedStore.issueLiveSave(
      replacedStore.capture(replacedDocument)!,
      replacedAttachment,
      exactCheckpoint,
      "base",
    )!;
    const replacingAcknowledgement = Object.create(null) as { readonly revision: null };
    Object.defineProperty(replacingAcknowledgement, "revision", {
      enumerable: true,
      get: () => {
        attach(
          replacedStore,
          replacedDocument,
          exactCheckpoint,
          Object.freeze({ replacement: true }),
        );
        return null;
      },
    });
    expect(replacedStore.acknowledgeSave(replacedPermit, replacingAcknowledgement)).toEqual({
      reason: "stale-receipt",
      status: "rejected",
    });
  });

  it("advances the live saved baseline but stays dirty after an edit during the write", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const document = open(store, owner, "src/a.ts", "base");
    const attachment = attach(store, document, checkpoint(1, 1, 1, 4));
    const writtenCheckpoint = checkpoint(2, 2, 2, 5);
    expect(store.checkpointLiveDocument(attachment, writtenCheckpoint).status).toBe("applied");
    const permit = store.issueLiveSave(
      store.capture(document)!,
      attachment,
      writtenCheckpoint,
      "typed",
    )!;

    expect(store.checkpointLiveDocument(attachment, checkpoint(3, 3, 3, 6)).status).toBe("applied");
    expect(store.acknowledgeSave(permit, { revision: null }).status).toBe("applied");
    expect(available(store, document)).toMatchObject({
      dirty: true,
      document: { content: "typed", savedContent: "typed" },
    });
    expect(store.checkpointLiveDocument(attachment, checkpoint(2, 4, 4, 5))).toEqual({
      dirty: false,
      status: "applied",
    });
  });

  it.each([1, 2, 4])(
    "issues cancellable live permits through %i joined exact holders",
    (holderCount) => {
      const store = new DocumentSessionStore();
      const owner = activate(store, OWNER_A, ROOT_A);
      const document = open(store, owner, "src/a.ts", "base");
      const source = Object.freeze({});
      const exactCheckpoint = checkpoint(1, 1, 1, 4);
      const holders = Array.from({ length: holderCount }, () =>
        attach(store, document, exactCheckpoint, source, Object.freeze({})),
      );

      const permits = holders.map((holder) =>
        store.issueLiveSave(store.capture(document)!, holder, exactCheckpoint, "base"),
      );
      expect(permits.every(Boolean)).toBe(true);
      permits.forEach((permit) => {
        expect(store.cancelSave(permit!)).toBe(true);
        expect(store.cancelSave(permit!)).toBe(false);
      });
    },
  );

  it("rejects stale, foreign, released, mismatched, oversized, and over-limit live permits", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const document = open(store, owner, "src/a.ts", "base");
    const exactCheckpoint = checkpoint(1, 1, 1, 4);
    const attachment = attach(store, document, exactCheckpoint);
    const receipt = store.capture(document)!;

    expect(store.issueLiveSave(receipt, attachment, checkpoint(2, 2, 2, 4), "base")).toBeNull();
    expect(
      store.issueLiveSave(
        receipt,
        attachment,
        checkpoint(1, 1, 1, MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS + 1),
        "x".repeat(MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS + 1),
      ),
    ).toBeNull();

    const permits = Array.from({ length: 8 }, () =>
      store.issueLiveSave(receipt, attachment, exactCheckpoint, "base"),
    );
    expect(permits.every(Boolean)).toBe(true);
    expect(store.issueLiveSave(receipt, attachment, exactCheckpoint, "base")).toBeNull();
    permits.forEach((permit) => expect(store.cancelSave(permit!)).toBe(true));

    const foreignStore = new DocumentSessionStore();
    const foreignOwner = activate(foreignStore, OWNER_A, ROOT_A);
    const foreignDocument = open(foreignStore, foreignOwner, "src/a.ts", "base");
    const foreignAttachment = attach(foreignStore, foreignDocument, exactCheckpoint);
    expect(store.issueLiveSave(receipt, foreignAttachment, exactCheckpoint, "base")).toBeNull();

    expect(store.detachLiveDocument(attachment)).toBe(true);
    expect(store.issueLiveSave(receipt, attachment, exactCheckpoint, "base")).toBeNull();
  });

  it("rejects a live permit after release and stale authority across same-path and A-B-A", () => {
    const store = new DocumentSessionStore();
    const ownerA = activate(store, OWNER_A, ROOT_A);
    const documentA = open(store, ownerA, "src/a.ts", "base");
    const exactCheckpoint = checkpoint(1, 1, 1, 4);
    const attachmentA = attach(store, documentA, exactCheckpoint);
    const oldReceipt = store.capture(documentA)!;
    const releasedPermit = store.issueLiveSave(oldReceipt, attachmentA, exactCheckpoint, "base")!;
    expect(store.detachLiveDocument(attachmentA)).toBe(true);
    expect(store.acknowledgeSave(releasedPermit, { revision: null })).toEqual({
      reason: "stale-receipt",
      status: "rejected",
    });
    expect(store.cancelSave(releasedPermit)).toBe(false);

    expect(store.close(store.capture(documentA)!).status).toBe("applied");
    const reincarnated = open(store, ownerA, "src/a.ts", "base");
    expect(reincarnated.incarnation).not.toBe(documentA.incarnation);
    expect(store.issueLiveSave(oldReceipt, attachmentA, exactCheckpoint, "base")).toBeNull();

    activate(store, OWNER_B, ROOT_B);
    const nextOwnerA = activate(store, OWNER_A, ROOT_A);
    expect(nextOwnerA.generation).toBeGreaterThan(ownerA.generation);
    expect(store.issueLiveSave(oldReceipt, attachmentA, exactCheckpoint, "base")).toBeNull();
  });

  it("rejects live save issuance during subscriber reentrancy", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const document = open(store, owner, "src/a.ts", "base");
    const attachment = attach(store, document, checkpoint(1, 1, 1, 4));
    const receipt = store.capture(document)!;
    const attempted = vi.fn(() =>
      store.issueLiveSave(receipt, attachment, checkpoint(2, 2, 2, 5), "typed"),
    );
    store.subscribeDocument(document, attempted);

    expect(store.checkpointLiveDocument(attachment, checkpoint(2, 2, 2, 5)).status).toBe("applied");
    expect(attempted).toHaveReturnedWith(null);
  });

  it("keeps a clean live source dirty after a same-length legacy-only edit and save", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const document = open(store, owner, "src/a.ts", "base");
    attach(store, document, checkpoint(1, 1, 1, 4));
    expect(available(store, document).dirty).toBe(false);

    expect(store.edit(store.capture(document)!, "evil").status).toBe("applied");
    expect(available(store, document).dirty).toBe(true);
    const permit = store.issueSave(store.capture(document)!)!;
    expect(permit.writtenContent).toBe("evil");
    expect(store.acknowledgeSave(permit, { revision: null }).status).toBe("applied");
    expect(available(store, document).dirty).toBe(true);
    expect(store.close(store.capture(document)!)).toEqual({
      reason: "dirty-document",
      status: "rejected",
    });
  });

  it("keeps checkpoint-first undo clean after the matching saved legacy mirror", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const document = open(store, owner, "src/a.ts", "base");
    const attachment = attach(store, document, checkpoint(1, 1, 1, 4));
    expect(store.checkpointLiveDocument(attachment, checkpoint(2, 2, 2, 5)).status).toBe("applied");
    expect(store.edit(store.capture(document)!, "typed").status).toBe("applied");
    expect(available(store, document).dirty).toBe(true);

    expect(store.checkpointLiveDocument(attachment, checkpoint(1, 3, 3, 4))).toEqual({
      dirty: true,
      status: "applied",
    });
    expect(store.edit(store.capture(document)!, "base").status).toBe("applied");
    expect(available(store, document).dirty).toBe(false);
    expect(store.getOwnerSnapshot(owner)).toMatchObject({ dirtyCount: 0 });
  });

  it("uses injected canonical ownership instead of re-inferring the default lexical path", () => {
    const canonicalRoot = "/canonical/project";
    const selectedRoot = "/selected/project";
    const virtualPath = "/virtual/mount/src/a.ts";
    const ownerKey = createWorkspaceEditorSessionOwnerKey(canonicalRoot);
    const workspaceId = "workspace-canonical";
    const injectedIdentity = identity(canonicalRoot, "src/a.ts");
    const registeredIdentity = createRegisteredDocumentSaveIdentity(
      workspaceId,
      canonicalRoot,
      "src/a.ts",
    )!;
    const document: EditorDocument = {
      content: "export {};",
      language: "typescript",
      name: "a.ts",
      path: virtualPath,
      savedContent: "export {};",
    };
    const store = new DocumentSessionStore();
    const activation = store.activateOwner(
      { canonicalRoot, ownerKey, rootPath: selectedRoot, workspaceId },
      (rootPath, path) =>
        rootPath === selectedRoot && path === virtualPath ? registeredIdentity : null,
    );
    expect(activation.status).toBe("activated");
    if (activation.status !== "activated") {
      return;
    }

    expect(store.open(activation.lease, { document, identity: injectedIdentity }).status).toBe(
      "opened",
    );

    const defaultStore = new DocumentSessionStore();
    const defaultActivation = defaultStore.activateOwner({
      canonicalRoot,
      ownerKey,
      rootPath: selectedRoot,
      workspaceId,
    });
    expect(defaultActivation.status).toBe("activated");
    if (defaultActivation.status === "activated") {
      expect(
        defaultStore.open(defaultActivation.lease, {
          document,
          identity: injectedIdentity,
        }),
      ).toEqual({ reason: "invalid-document", status: "rejected" });
    }
  });

  it("requires explicit workspace ownership and never infers it from ownerKey", () => {
    const store = new DocumentSessionStore();
    const ownerKey = createWorkspaceEditorSessionOwnerKey("opaque-owner");
    expect(
      store.activateOwner({
        canonicalRoot: ROOT_A,
        ownerKey,
        rootPath: ROOT_A,
      } as Parameters<DocumentSessionStore["activateOwner"]>[0]),
    ).toEqual({ reason: "invalid-owner", status: "rejected" });

    const first = store.activateOwner({
      canonicalRoot: ROOT_A,
      ownerKey,
      rootPath: ROOT_A,
      workspaceId: WORKSPACE_A,
    });
    expect(first.status).toBe("activated");
    if (first.status !== "activated") {
      throw new Error("Expected the first workspace owner to activate.");
    }
    expect(first.lease.workspaceId).toBe(WORKSPACE_A);
    store.deactivateOwner(first.lease);

    expect(
      store.activateOwner({
        canonicalRoot: ROOT_A,
        ownerKey,
        rootPath: ROOT_A,
        workspaceId: WORKSPACE_B,
      }),
    ).toEqual({ reason: "invalid-owner", status: "rejected" });
  });

  it("rejects a registered document identity owned by a different workspace", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const candidate = seed(ROOT_A, "src/a.ts", "a");
    const foreign = createRegisteredDocumentSaveIdentity(WORKSPACE_B, ROOT_A, "src/a.ts")!;

    const replacement = store.activateOwner(
      {
        canonicalRoot: ROOT_A,
        ownerKey: OWNER_A,
        rootPath: ROOT_A,
        workspaceId: WORKSPACE_A,
      },
      () => foreign,
    );
    expect(replacement.status).toBe("activated");
    expect(
      replacement.status === "activated" ? store.open(replacement.lease, candidate) : replacement,
    ).toEqual({ reason: "invalid-document", status: "rejected" });
    expect(store.getOwnerSnapshot(owner)).toEqual({ status: "unavailable" });
  });

  it("publishes cached frozen snapshots only to the changed document and dirty owner transition", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const first = open(store, owner, "src/first.ts", "first");
    const second = open(store, owner, "src/second.ts", "second");
    const firstListener = vi.fn();
    const sharedPaneListener = vi.fn();
    const secondListener = vi.fn();
    const ownerListener = vi.fn();
    store.subscribeDocument(first, firstListener);
    store.subscribeDocument(first, sharedPaneListener);
    store.subscribeDocument(second, secondListener);
    store.subscribeOwner(owner, ownerListener);

    const initialDocumentSnapshot = store.getDocumentSnapshot(first);
    const initialOwnerSnapshot = store.getOwnerSnapshot(owner);
    expect(store.getDocumentSnapshot(first)).toBe(initialDocumentSnapshot);
    expect(store.getOwnerSnapshot(owner)).toBe(initialOwnerSnapshot);
    expect(Object.isFrozen(initialDocumentSnapshot)).toBe(true);
    expect(Object.isFrozen(initialOwnerSnapshot)).toBe(true);

    const firstEdit = store.edit(store.capture(first)!, "first edit");
    expect(firstEdit.status).toBe("applied");
    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(sharedPaneListener).toHaveBeenCalledTimes(1);
    expect(secondListener).not.toHaveBeenCalled();
    expect(ownerListener).toHaveBeenCalledTimes(1);
    const dirtyOwnerSnapshot = store.getOwnerSnapshot(owner);
    expect(dirtyOwnerSnapshot).not.toBe(initialOwnerSnapshot);
    expect(dirtyOwnerSnapshot).toMatchObject({ dirtyCount: 1 });

    store.edit(store.capture(first)!, "second edit");
    expect(firstListener).toHaveBeenCalledTimes(2);
    expect(sharedPaneListener).toHaveBeenCalledTimes(2);
    expect(secondListener).not.toHaveBeenCalled();
    expect(ownerListener).toHaveBeenCalledTimes(1);
    expect(store.getOwnerSnapshot(owner)).toBe(dirtyOwnerSnapshot);
    expect(store.getDocumentSnapshot(second)).toBe(store.getDocumentSnapshot(second));
  });

  it("routes one hundred 1 MiB edits only to subscribers of the exact document", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const megabyte = "x".repeat(1024 * 1024);
    const target = open(store, owner, "src/large.ts", megabyte);
    const unrelated = open(store, owner, "src/unrelated.ts", "unrelated");
    const targetListener = vi.fn();
    const sharedPaneListener = vi.fn();
    const unrelatedListener = vi.fn();
    const ownerListener = vi.fn();
    store.subscribeDocument(target, targetListener);
    store.subscribeDocument(target, sharedPaneListener);
    store.subscribeDocument(unrelated, unrelatedListener);
    store.subscribeOwner(owner, ownerListener);
    const unrelatedSnapshot = store.getDocumentSnapshot(unrelated);

    for (let index = 0; index < 100; index += 1) {
      const suffix = index.toString().padStart(3, "0");
      const result = store.edit(
        store.capture(target)!,
        `${megabyte.slice(0, -suffix.length)}${suffix}`,
      );
      expect(result.status).toBe("applied");
    }

    expect(targetListener).toHaveBeenCalledTimes(100);
    expect(sharedPaneListener).toHaveBeenCalledTimes(100);
    expect(unrelatedListener).not.toHaveBeenCalled();
    expect(ownerListener).toHaveBeenCalledTimes(1);
    expect(store.getDocumentSnapshot(unrelated)).toBe(unrelatedSnapshot);
    expect(available(store, target)).toMatchObject({
      contentVersion: 100,
      dirty: true,
      version: 100,
    });
  });

  it("invalidates exact owner authority across A to B to A without losing retained content", () => {
    const store = new DocumentSessionStore();
    const firstA = activate(store, OWNER_A, ROOT_A);
    const documentA = open(store, firstA, "src/a.ts", "base");
    const staleReceipt = store.capture(documentA)!;
    const firstIncarnation = documentA.incarnation;
    store.edit(staleReceipt, "dirty A");

    activate(store, OWNER_B, ROOT_B);
    expect(store.isCurrent(staleReceipt)).toBe(false);
    expect(store.getDocumentSnapshot(documentA)).toEqual({
      status: "unavailable",
    });

    const nextA = activate(store, OWNER_A, ROOT_A);
    expect(nextA.generation).toBeGreaterThan(firstA.generation);
    expect(nextA.incarnation).not.toBe(firstA.incarnation);
    const restored = store.resolve(nextA, identity(ROOT_A, "src/a.ts"));
    expect(restored).not.toBeNull();
    expect(restored?.incarnation).toBe(firstIncarnation);
    expect(available(store, restored!).document.content).toBe("dirty A");
    expect(store.edit(staleReceipt, "stale overwrite")).toEqual({
      reason: "stale-receipt",
      status: "rejected",
    });
  });

  it("rejects reordered edit receipts and creates a new document incarnation after close", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const document = open(store, owner, "src/a.ts", "base");
    const firstReceipt = store.capture(document)!;
    const firstMutation = store.edit(firstReceipt, "one");
    expect(firstMutation.status).toBe("applied");

    expect(store.edit(firstReceipt, "late")).toEqual({
      reason: "stale-receipt",
      status: "rejected",
    });
    const currentReceipt = store.capture(document)!;
    expect(store.close(currentReceipt)).toEqual({
      reason: "dirty-document",
      status: "rejected",
    });
    expect(store.close(currentReceipt, { discardDirty: true }).status).toBe("applied");

    const reopened = open(store, owner, "src/a.ts", "disk");
    expect(reopened.incarnation).not.toBe(document.incarnation);
    expect(store.edit(currentReceipt, "resurrect")).toEqual({
      reason: "stale-receipt",
      status: "rejected",
    });
  });

  it("acknowledges an issued save without overwriting a newer live edit", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const document = open(store, owner, "src/a.ts", "base");
    const issued = store.capture(document)!;
    store.edit(issued, "written");
    const writeReceipt = store.capture(document)!;
    const permit = store.issueSave(writeReceipt)!;
    store.edit(writeReceipt, "typed later");

    const acknowledgement = store.acknowledgeSave(permit, {
      revision: null,
    });
    expect(acknowledgement.status).toBe("applied");
    expect(available(store, document).document).toMatchObject({
      content: "typed later",
      savedContent: "written",
    });
    expect(available(store, document).dirty).toBe(true);
  });

  it("evicts the deterministic oldest clean inactive document for global admission", () => {
    const store = new DocumentSessionStore(
      limits({
        maxRetainedDocuments: 2,
      }),
    );
    const ownerA = activate(store, OWNER_A, ROOT_A);
    const oldest = open(store, ownerA, "src/oldest.ts", "oldest");
    const newer = open(store, ownerA, "src/newer.ts", "newer");
    const ownerB = activate(store, OWNER_B, ROOT_B);

    const admitted = store.open(ownerB, seed(ROOT_B, "src/b.ts", "b"));
    expect(admitted.status).toBe("opened");
    const nextA = activate(store, OWNER_A, ROOT_A);
    expect(store.resolve(nextA, identity(ROOT_A, "src/oldest.ts"))).toBeNull();
    expect(store.resolve(nextA, identity(ROOT_A, "src/newer.ts"))).not.toBeNull();
    expect(store.getDocumentSnapshot(oldest)).toEqual({
      status: "unavailable",
    });
    expect(store.getDocumentSnapshot(newer)).toEqual({
      status: "unavailable",
    });
  });

  it("does not evict retained capacity when freezing a malformed admission throws", () => {
    const store = new DocumentSessionStore(
      limits({
        maxRetainedDocuments: 1,
      }),
    );
    const ownerA = activate(store, OWNER_A, ROOT_A);
    open(store, ownerA, "src/retained.ts", "retained");
    const ownerB = activate(store, OWNER_B, ROOT_B);
    const malformed = seed(ROOT_B, "src/malformed.ts", "malformed");
    Object.defineProperty(malformed.document, "revision", {
      enumerable: true,
      get: () => {
        throw new Error("malformed revision");
      },
    });

    expect(() => store.open(ownerB, malformed)).toThrow("malformed revision");

    const nextA = activate(store, OWNER_A, ROOT_A);
    expect(store.resolve(nextA, identity(ROOT_A, "src/retained.ts"))).not.toBeNull();
  });

  it("never evicts dirty inactive content and fails admission closed", () => {
    const store = new DocumentSessionStore(
      limits({
        maxRetainedDocuments: 1,
      }),
    );
    const ownerA = activate(store, OWNER_A, ROOT_A);
    const dirty = open(store, ownerA, "src/a.ts", "base");
    store.edit(store.capture(dirty)!, "dirty");
    const ownerB = activate(store, OWNER_B, ROOT_B);

    expect(store.open(ownerB, seed(ROOT_B, "src/b.ts", "b"))).toEqual({
      reason: "document-limit",
      status: "rejected",
    });
    const nextA = activate(store, OWNER_A, ROOT_A);
    const retained = store.resolve(nextA, identity(ROOT_A, "src/a.ts"));
    expect(retained).not.toBeNull();
    expect(available(store, retained!).document.content).toBe("dirty");
  });

  it("does not evict a dirty inactive owner to satisfy the owner bound", () => {
    const store = new DocumentSessionStore(limits({ maxOwners: 1 }));
    const ownerA = activate(store, OWNER_A, ROOT_A);
    const dirty = open(store, ownerA, "src/a.ts", "base");
    store.edit(store.capture(dirty)!, "dirty");
    store.deactivateOwner(ownerA);

    expect(
      store.activateOwner({
        canonicalRoot: ROOT_B,
        ownerKey: OWNER_B,
        rootPath: ROOT_B,
        workspaceId: WORKSPACE_B,
      }),
    ).toEqual({
      reason: "owner-limit",
      status: "rejected",
    });
    const nextA = activate(store, OWNER_A, ROOT_A);
    expect(store.resolve(nextA, identity(ROOT_A, "src/a.ts"))).not.toBeNull();
  });

  it("switches clean A to B at the owner bound by deterministically evicting A", () => {
    const store = new DocumentSessionStore(limits({ maxOwners: 1 }));
    const ownerA = activate(store, OWNER_A, ROOT_A);
    const clean = open(store, ownerA, "src/a.ts", "clean");

    const ownerB = activate(store, OWNER_B, ROOT_B);
    expect(store.getOwnerSnapshot(ownerB)).toMatchObject({ status: "active" });
    expect(store.getDocumentSnapshot(clean)).toEqual({ status: "unavailable" });
  });

  it("rejects reentrant owner activation while committing one A to B transition", () => {
    const store = new DocumentSessionStore();
    const ownerA = activate(store, OWNER_A, ROOT_A);
    const attempted = vi.fn(() =>
      store.activateOwner({
        canonicalRoot: "/workspace/c",
        ownerKey: createWorkspaceEditorSessionOwnerKey("/workspace/c"),
        rootPath: "/workspace/c",
        workspaceId: "workspace-c",
      }),
    );
    store.subscribeOwner(ownerA, attempted);

    const ownerB = activate(store, OWNER_B, ROOT_B);
    expect(attempted).toHaveReturnedWith({
      reason: "reentrant-operation",
      status: "rejected",
    });
    expect(store.getOwnerSnapshot(ownerB)).toMatchObject({ status: "active" });
  });

  it("orders issued save permits and rejects duplicate or reordered acknowledgements", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const document = open(store, owner, "src/a.ts", "base");
    store.edit(store.capture(document)!, "first");
    const older = store.issueSave(store.capture(document)!)!;
    store.edit(store.capture(document)!, "second");
    const newer = store.issueSave(store.capture(document)!)!;

    expect(store.acknowledgeSave(newer, { revision: null }).status).toBe("applied");
    expect(store.acknowledgeSave(older, { revision: null })).toEqual({
      reason: "stale-receipt",
      status: "rejected",
    });
    expect(store.acknowledgeSave(newer, { revision: null })).toEqual({
      reason: "stale-receipt",
      status: "rejected",
    });
    expect(available(store, document).document.savedContent).toBe("second");
  });

  it("settles failed save permits exactly once and never exhausts later saves", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const document = open(store, owner, "src/a.ts", "base");

    for (let index = 0; index < 12; index += 1) {
      const permit = store.issueSave(store.capture(document)!);
      expect(permit).not.toBeNull();
      expect(store.cancelSave(permit!)).toBe(true);
      expect(store.cancelSave(permit!)).toBe(false);
    }
    expect(store.issueSave(store.capture(document)!)).not.toBeNull();
  });

  it("protects a clean owner with an in-flight save from deterministic eviction", () => {
    const store = new DocumentSessionStore(limits({ maxOwners: 1 }));
    const ownerA = activate(store, OWNER_A, ROOT_A);
    const document = open(store, ownerA, "src/a.ts", "clean");
    const permit = store.issueSave(store.capture(document)!)!;
    expect(store.close(store.capture(document)!)).toEqual({
      reason: "save-in-flight",
      status: "rejected",
    });

    expect(
      store.activateOwner({
        canonicalRoot: ROOT_B,
        ownerKey: OWNER_B,
        rootPath: ROOT_B,
        workspaceId: WORKSPACE_B,
      }),
    ).toEqual({ reason: "owner-limit", status: "rejected" });
    expect(store.getOwnerSnapshot(ownerA)).toMatchObject({ status: "active" });

    expect(store.cancelSave(permit)).toBe(true);
    expect(activate(store, OWNER_B, ROOT_B)).toMatchObject({
      ownerKey: OWNER_B,
    });
  });

  it("settles an inactive owner's permit before allowing a new owner generation", () => {
    const store = new DocumentSessionStore();
    const ownerA = activate(store, OWNER_A, ROOT_A);
    const document = open(store, ownerA, "src/a.ts", "clean");
    const permit = store.issueSave(store.capture(document)!)!;
    activate(store, OWNER_B, ROOT_B);

    expect(
      store.activateOwner({
        canonicalRoot: ROOT_A,
        ownerKey: OWNER_A,
        rootPath: ROOT_A,
        workspaceId: WORKSPACE_A,
      }),
    ).toEqual({ reason: "save-in-flight", status: "rejected" });
    expect(store.cancelSave(permit)).toBe(true);
    expect(activate(store, OWNER_A, ROOT_A).generation).toBeGreaterThan(ownerA.generation);
  });

  it("rejects foreign canonical identities and paths outside the selected owner root", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    expect(store.open(owner, seed(ROOT_B, "src/foreign.ts", "foreign"))).toEqual({
      reason: "invalid-document",
      status: "rejected",
    });
    expect(
      store.open(owner, {
        document: {
          ...seed(ROOT_A, "src/a.ts", "a").document,
          path: `${ROOT_B}/src/a.ts`,
        },
        identity: identity(ROOT_A, "src/a.ts"),
      }),
    ).toEqual({ reason: "invalid-document", status: "rejected" });
    expect(
      store.activateOwner({
        canonicalRoot: ROOT_A,
        ownerKey: OWNER_A,
        rootPath: `${ROOT_A}/alias`,
        workspaceId: WORKSPACE_A,
      }),
    ).toEqual({ reason: "invalid-owner", status: "rejected" });
  });

  it("keeps clean inactive documents when an edit admission cannot satisfy the byte bound", () => {
    const store = new DocumentSessionStore(
      limits({
        maxRetainedEstimatedBytes: 600,
      }),
    );
    const ownerA = activate(store, OWNER_A, ROOT_A);
    open(store, ownerA, "a", "small");
    const ownerB = activate(store, OWNER_B, ROOT_B);
    const protectedDocument = open(store, ownerB, "b", "x".repeat(100));
    store.edit(store.capture(protectedDocument)!, "y".repeat(100));

    expect(store.edit(store.capture(protectedDocument)!, "z".repeat(1_000))).toEqual({
      reason: "content-budget",
      status: "rejected",
    });
    const nextA = activate(store, OWNER_A, ROOT_A);
    expect(store.resolve(nextA, identity(ROOT_A, "a"))).not.toBeNull();
  });

  it("deep-freezes revision metadata included in retained-size accounting", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const input = seed(ROOT_A, "src/a.ts", "a");
    input.document.revision = {
      contentHash: "hash",
      device: "1",
      inode: "2",
      modifiedNanoseconds: 3,
      modifiedSeconds: 4,
      size: 5,
    };
    const result = store.open(owner, input);
    if (result.status !== "opened") throw new Error("Expected admission");
    const snapshot = available(store, result.lease);
    expect(Object.isFrozen(snapshot.document.revision)).toBe(true);
    expect(snapshot.estimatedRetainedBytes).toBeGreaterThan(
      (input.document.content.length + input.document.savedContent.length) * 2,
    );
  });

  it("enforces per-owner and conservative retained-byte admission bounds", () => {
    const oneDocument = new DocumentSessionStore(
      limits({
        maxDocumentsPerOwner: 1,
      }),
    );
    const owner = activate(oneDocument, OWNER_A, ROOT_A);
    open(oneDocument, owner, "src/a.ts", "a");
    expect(oneDocument.open(owner, seed(ROOT_A, "src/b.ts", "b"))).toEqual({
      reason: "document-limit",
      status: "rejected",
    });

    const byteBound = new DocumentSessionStore(
      limits({
        maxRetainedEstimatedBytes: 30,
      }),
    );
    const byteOwner = activate(byteBound, OWNER_A, ROOT_A);
    expect(byteBound.open(byteOwner, seed(ROOT_A, "a", "1234567890"))).toEqual({
      reason: "content-budget",
      status: "rejected",
    });
  });

  it("notifies stale subscriptions once when owner authority is retired, never on later A", () => {
    const store = new DocumentSessionStore();
    const firstA = activate(store, OWNER_A, ROOT_A);
    const firstDocument = open(store, firstA, "src/a.ts", "a");
    const documentListener = vi.fn();
    const ownerListener = vi.fn();
    store.subscribeDocument(firstDocument, documentListener);
    store.subscribeOwner(firstA, ownerListener);

    activate(store, OWNER_B, ROOT_B);
    expect(documentListener).toHaveBeenCalledTimes(1);
    expect(ownerListener).toHaveBeenCalledTimes(1);

    const nextA = activate(store, OWNER_A, ROOT_A);
    const nextDocument = store.resolve(nextA, identity(ROOT_A, "src/a.ts"))!;
    store.edit(store.capture(nextDocument)!, "next A");
    expect(documentListener).toHaveBeenCalledTimes(1);
    expect(ownerListener).toHaveBeenCalledTimes(1);
  });
});

function activate(
  store: DocumentSessionStore,
  ownerKey: typeof OWNER_A,
  rootPath: string,
): DocumentSessionOwnerLease {
  const result = store.activateOwner({
    canonicalRoot: rootPath,
    ownerKey,
    rootPath,
    workspaceId: rootPath === ROOT_A ? WORKSPACE_A : WORKSPACE_B,
  });
  if (result.status !== "activated") {
    throw new Error(`Owner admission failed: ${result.reason}`);
  }
  return result.lease;
}

function open(
  store: DocumentSessionStore,
  owner: DocumentSessionOwnerLease,
  relativePath: string,
  content: string,
): DocumentSessionDocumentLease {
  const result = store.open(owner, seed(owner.rootPath, relativePath, content));
  if (result.status !== "opened") {
    throw new Error(`Document admission failed: ${result.reason}`);
  }
  return result.lease;
}

function attach(
  store: DocumentSessionStore,
  document: DocumentSessionDocumentLease,
  base: DocumentSessionLiveCheckpoint,
  sourceIncarnation: object = Object.freeze({}),
  holderIncarnation: object = Object.freeze({}),
  capturedCurrentContent?: string,
): DocumentSessionLiveAttachmentLease {
  const receipt = store.capture(document)!;
  const retained = available(store, document).document;
  const synchronization = store.issueLiveDocumentSynchronization(
    receipt,
    sourceIncarnation,
    base,
    capturedCurrentContent ?? retained.content,
  );
  const result = store.attachLiveDocument(receipt, {
    checkpoint: base,
    holderIncarnation,
    sourceIncarnation,
    synchronization,
  });
  if (result.status !== "attached") {
    throw new Error(`Live attachment failed: ${result.reason}`);
  }
  return result.attachment;
}

function checkpoint(
  alternativeVersionId: number,
  contentVersion: number,
  modelVersionId: number,
  utf16Length: number | null,
): DocumentSessionLiveCheckpoint {
  return {
    alternativeVersionId,
    contentVersion,
    modelVersionId,
    utf16Length,
  };
}

function seed(
  rootPath: string,
  relativePath: string,
  content: string,
): { readonly document: EditorDocument; readonly identity: DocumentSaveIdentity } {
  const path = `${rootPath}/${relativePath}`;
  const pathSegments = relativePath.split("/");
  return {
    document: {
      content,
      language: "typescript",
      name: pathSegments[pathSegments.length - 1] ?? relativePath,
      path,
      savedContent: content,
    },
    identity: identity(rootPath, relativePath),
  };
}

function identity(rootPath: string, relativePath: string): DocumentSaveIdentity {
  const result = createDocumentSaveIdentity(rootPath, relativePath);
  if (!result) {
    throw new Error("Invalid test identity");
  }
  return result;
}

function available(store: DocumentSessionStore, lease: DocumentSessionDocumentLease) {
  const snapshot = store.getDocumentSnapshot(lease);
  if (snapshot.status !== "available") {
    throw new Error("Expected available document");
  }
  return snapshot;
}

function limits(overrides: Partial<DocumentSessionStoreLimits>): DocumentSessionStoreLimits {
  return {
    maxDocumentsPerOwner: 10,
    maxOwners: 10,
    maxRetainedDocuments: 10,
    maxRetainedEstimatedBytes: 1_000_000,
    ...overrides,
  };
}
