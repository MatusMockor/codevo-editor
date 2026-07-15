import type { SetStateAction } from "react";
import { describe, expect, it, vi } from "vitest";
import type { EditorDocument, WorkspaceFileRevision } from "../domain/workspace";
import {
  ActiveDocumentSaveStore,
  type DocumentSaveAcknowledgement,
  type DocumentSaveTarget,
} from "./activeDocumentSaveStore";

const ROOT = "/workspace";
const PATH = `${ROOT}/src/User.php`;

function document(
  content = "edited",
  savedContent = "saved",
): EditorDocument {
  return {
    content,
    language: "php",
    name: "User.php",
    path: PATH,
    savedContent,
  };
}

function revision(contentHash: number): WorkspaceFileRevision {
  return {
    contentHash,
    device: 1,
    inode: 2,
    modifiedNanoseconds: 3,
    modifiedSeconds: 4,
    size: 5,
  };
}

function createHarness() {
  const initialDocument = document();
  const currentWorkspaceRootRef = { current: ROOT as string | null };
  const workspaceRequestTokenRef = { current: 1 };
  const activeDocumentRef = {
    current: initialDocument as EditorDocument | null,
  };
  const documentsRef = {
    current: { [PATH]: initialDocument } as Record<string, EditorDocument>,
  };
  let leaseIsCurrent = true;
  const setDocuments = vi.fn(
    (update: SetStateAction<Record<string, EditorDocument>>) => {
      documentsRef.current =
        typeof update === "function" ? update(documentsRef.current) : update;
    },
  );
  const store = new ActiveDocumentSaveStore({
    currentWorkspaceRootRef,
    workspaceRequestTokenRef,
    activeDocumentRef,
    documentsRef,
    setDocuments,
  });
  const target: DocumentSaveTarget = {
    rootPath: ROOT,
    path: PATH,
    workspaceRequestToken: 1,
    lease: {
      isCurrent: () => leaseIsCurrent,
      tryBeginWrite: () => ({ granted: true, settle: () => {} }),
    },
  };

  return {
    activeDocumentRef,
    currentWorkspaceRootRef,
    documentsRef,
    initialDocument,
    setDocuments,
    store,
    target,
    workspaceRequestTokenRef,
    expireLease: () => {
      leaseIsCurrent = false;
    },
  };
}

function acknowledgement(
  expectedDocument: EditorDocument,
): DocumentSaveAcknowledgement {
  return {
    expectedDocument,
    savedDocument: { ...expectedDocument, content: "formatted" },
    startingContent: expectedDocument.content,
    revision: revision(2),
  };
}

describe("ActiveDocumentSaveStore", () => {
  it.each(["root", "token", "lease"] as const)(
    "rejects current reads and revision recovery after %s expiry",
    (guard) => {
      const harness = createHarness();
      if (guard === "root") {
        harness.currentWorkspaceRootRef.current = "/other";
      }
      if (guard === "token") {
        harness.workspaceRequestTokenRef.current += 1;
      }
      if (guard === "lease") {
        harness.expireLease();
      }

      harness.store.updateRevision(harness.target, revision(3));

      expect(harness.store.current(harness.target)).toBeNull();
      expect(harness.documentsRef.current[PATH]).toBe(harness.initialDocument);
      expect(harness.activeDocumentRef.current).toBe(harness.initialDocument);
      expect(harness.setDocuments).not.toHaveBeenCalled();
    },
  );

  it("rejects issued-write acknowledgement after the root changes", () => {
    const harness = createHarness();
    harness.currentWorkspaceRootRef.current = "/other";

    harness.store.acknowledgeIssuedWrite(
      harness.target,
      acknowledgement(harness.initialDocument),
    );

    expect(harness.documentsRef.current[PATH]).toBe(harness.initialDocument);
    expect(harness.setDocuments).not.toHaveBeenCalled();
  });

  it("acknowledges an issued write for the live document after token expiry", () => {
    const harness = createHarness();
    harness.initialDocument.revision = revision(1);
    const typedDocument = {
      ...harness.initialDocument,
      content: "C2",
    };
    harness.documentsRef.current = { [PATH]: typedDocument };
    harness.activeDocumentRef.current = typedDocument;
    harness.workspaceRequestTokenRef.current += 1;

    harness.store.acknowledgeIssuedWrite(
      harness.target,
      {
        ...acknowledgement(harness.initialDocument),
        savedDocument: { ...harness.initialDocument, content: "C1" },
      },
    );

    expect(harness.documentsRef.current[PATH]).toEqual(
      expect.objectContaining({
        content: "C2",
        savedContent: "C1",
        revision: revision(2),
      }),
    );
    expect(harness.activeDocumentRef.current).toEqual(
      harness.documentsRef.current[PATH],
    );
    expect(harness.setDocuments).toHaveBeenCalledOnce();
  });

  it("preserves document identity for a token-expired no-op acknowledgement", () => {
    const harness = createHarness();
    harness.initialDocument.savedContent = harness.initialDocument.content;
    const documents = harness.documentsRef.current;
    harness.workspaceRequestTokenRef.current += 2;

    harness.store.acknowledgeIssuedWrite(harness.target, {
      expectedDocument: harness.initialDocument,
      savedDocument: { ...harness.initialDocument },
      startingContent: harness.initialDocument.content,
      revision: undefined,
    });

    expect(harness.documentsRef.current).toBe(documents);
    expect(harness.documentsRef.current[PATH]).toBe(harness.initialDocument);
    expect(harness.activeDocumentRef.current).toBe(harness.initialDocument);
    expect(harness.setDocuments).not.toHaveBeenCalled();
  });

  it("reconciles a token-expired issued write after C1 to C2 to C1", () => {
    const harness = createHarness();
    const startingRevision = revision(1);
    harness.initialDocument.content = "C1";
    harness.initialDocument.revision = startingRevision;
    const editedDocument = {
      ...harness.initialDocument,
      content: "C2",
    };
    const revertedDocument = {
      ...editedDocument,
      content: "C1",
    };
    harness.documentsRef.current = { [PATH]: revertedDocument };
    harness.activeDocumentRef.current = revertedDocument;
    harness.workspaceRequestTokenRef.current += 1;
    const savedRevision = revision(2);

    harness.store.acknowledgeIssuedWrite(harness.target, {
      expectedDocument: harness.initialDocument,
      savedDocument: { ...harness.initialDocument, content: "C1" },
      startingContent: "C1",
      revision: savedRevision,
    });

    expect(harness.documentsRef.current[PATH]).toEqual(
      expect.objectContaining({
        content: "C1",
        savedContent: "C1",
        revision: savedRevision,
      }),
    );
    expect(harness.documentsRef.current[PATH]).not.toBe(revertedDocument);
    expect(harness.activeDocumentRef.current).toBe(
      harness.documentsRef.current[PATH],
    );
    expect(harness.setDocuments).toHaveBeenCalledOnce();
  });

  it("rejects a token-expired issued write for a new disk snapshot", () => {
    const harness = createHarness();
    const replacementDocument = {
      ...harness.initialDocument,
      content: "reopened",
      savedContent: "reopened",
      revision: revision(9),
    };
    harness.documentsRef.current = { [PATH]: replacementDocument };
    harness.activeDocumentRef.current = replacementDocument;
    harness.workspaceRequestTokenRef.current += 1;

    harness.store.acknowledgeIssuedWrite(
      harness.target,
      acknowledgement(harness.initialDocument),
    );

    expect(harness.documentsRef.current[PATH]).toBe(replacementDocument);
    expect(harness.documentsRef.current[PATH].savedContent).toBe("reopened");
    expect(harness.documentsRef.current[PATH].revision).toEqual(revision(9));
    expect(harness.activeDocumentRef.current).toBe(replacementDocument);
    expect(harness.setDocuments).not.toHaveBeenCalled();
  });

  it("acknowledges a stale issued write for the same inactive document", () => {
    const harness = createHarness();
    const inactiveDocument = {
      ...harness.initialDocument,
      content: "C2",
    };
    const activeDocument = {
      ...document("other"),
      path: `${ROOT}/src/Other.php`,
    };
    harness.documentsRef.current = { [PATH]: inactiveDocument };
    harness.activeDocumentRef.current = activeDocument;
    harness.workspaceRequestTokenRef.current += 1;

    harness.store.acknowledgeIssuedWrite(
      harness.target,
      {
        ...acknowledgement(harness.initialDocument),
        savedDocument: { ...harness.initialDocument, content: "C1" },
      },
    );

    expect(harness.documentsRef.current[PATH]).toEqual(
      expect.objectContaining({
        content: "C2",
        savedContent: "C1",
        revision: revision(2),
      }),
    );
    expect(harness.activeDocumentRef.current).toBe(activeDocument);
    expect(harness.setDocuments).toHaveBeenCalledOnce();
  });

  it("reconciles a partial revision for an inactive stale document", () => {
    const harness = createHarness();
    const startingRevision = revision(1);
    harness.initialDocument.revision = startingRevision;
    const inactiveDocument = {
      ...harness.initialDocument,
      content: "C2",
    };
    const activeDocument = {
      ...document("other"),
      path: `${ROOT}/src/Other.php`,
    };
    const partialRevision = revision(3);
    harness.documentsRef.current = { [PATH]: inactiveDocument };
    harness.activeDocumentRef.current = activeDocument;
    harness.workspaceRequestTokenRef.current += 1;

    harness.store.updateRevisionForIssuedWrite(
      harness.target,
      harness.initialDocument,
      partialRevision,
    );

    expect(harness.documentsRef.current[PATH]).toEqual({
      ...inactiveDocument,
      revision: partialRevision,
    });
    expect(harness.documentsRef.current[PATH].content).toBe("C2");
    expect(harness.documentsRef.current[PATH].savedContent).toBe("saved");
    expect(harness.activeDocumentRef.current).toBe(activeDocument);
    expect(harness.setDocuments).toHaveBeenCalledOnce();
  });

  it("does not apply a partial revision to a new disk snapshot", () => {
    const harness = createHarness();
    const diskRevision = revision(9);
    const replacementDocument = {
      ...harness.initialDocument,
      content: "reopened",
      savedContent: "reopened",
      revision: diskRevision,
    };
    const activeDocument = {
      ...document("other"),
      path: `${ROOT}/src/Other.php`,
    };
    harness.documentsRef.current = { [PATH]: replacementDocument };
    harness.activeDocumentRef.current = activeDocument;
    harness.workspaceRequestTokenRef.current += 1;

    harness.store.updateRevisionForIssuedWrite(
      harness.target,
      harness.initialDocument,
      revision(8),
    );

    expect(harness.documentsRef.current[PATH]).toBe(replacementDocument);
    expect(harness.documentsRef.current[PATH].revision).toBe(diskRevision);
    expect(harness.activeDocumentRef.current).toBe(activeDocument);
    expect(harness.setDocuments).not.toHaveBeenCalled();
  });

  it.each(["success", "partial"] as const)(
    "rejects %s reconciliation after invalidation and same-path reopen edit",
    (outcome) => {
      const harness = createHarness();
      const reopenedDocument = {
        ...harness.initialDocument,
        content: "reopened edit",
      };
      harness.documentsRef.current = { [PATH]: reopenedDocument };
      harness.activeDocumentRef.current = reopenedDocument;
      harness.expireLease();

      if (outcome === "success") {
        harness.store.acknowledgeIssuedWrite(
          harness.target,
          acknowledgement(harness.initialDocument),
        );
      }
      if (outcome === "partial") {
        harness.store.updateRevisionForIssuedWrite(
          harness.target,
          harness.initialDocument,
          revision(8),
        );
      }

      expect(harness.documentsRef.current[PATH]).toBe(reopenedDocument);
      expect(harness.documentsRef.current[PATH].content).toBe("reopened edit");
      expect(harness.documentsRef.current[PATH].savedContent).toBe("saved");
      expect(harness.documentsRef.current[PATH].revision).toBeUndefined();
      expect(harness.activeDocumentRef.current).toBe(reopenedDocument);
      expect(harness.setDocuments).not.toHaveBeenCalled();
    },
  );

  it("acknowledges written bytes across live and active document state", () => {
    const harness = createHarness();
    const savedRevision = revision(2);
    const saved = {
      ...acknowledgement(harness.initialDocument),
      revision: savedRevision,
    };

    harness.store.acknowledgeIssuedWrite(harness.target, saved);

    expect(harness.documentsRef.current[PATH]).toEqual(
      expect.objectContaining({
        content: "formatted",
        savedContent: "formatted",
        revision: savedRevision,
      }),
    );
    expect(harness.activeDocumentRef.current).toEqual(
      harness.documentsRef.current[PATH],
    );
    expect(harness.setDocuments).toHaveBeenCalledOnce();
  });

  it("preserves newer typing while acknowledging the bytes written", () => {
    const harness = createHarness();
    const typedDocument = {
      ...harness.initialDocument,
      content: "typed during write",
    };
    harness.documentsRef.current = { [PATH]: typedDocument };
    harness.activeDocumentRef.current = typedDocument;

    harness.store.acknowledgeIssuedWrite(
      harness.target,
      acknowledgement(harness.initialDocument),
    );

    expect(harness.documentsRef.current[PATH]).toEqual(
      expect.objectContaining({
        content: "typed during write",
        savedContent: "formatted",
      }),
    );
  });

  it("updates only the live document revision", () => {
    const harness = createHarness();
    const nextRevision = revision(3);

    harness.store.updateRevision(harness.target, nextRevision);

    expect(harness.documentsRef.current[PATH].revision).toEqual(nextRevision);
    expect(harness.activeDocumentRef.current).toEqual(
      harness.documentsRef.current[PATH],
    );
    expect(harness.setDocuments).toHaveBeenCalledOnce();
  });

  it("does not resolve a document absent from the live document set", () => {
    const harness = createHarness();
    harness.documentsRef.current = {};

    expect(harness.store.current(harness.target)).toBeNull();
  });
});
