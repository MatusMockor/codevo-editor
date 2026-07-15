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
    lease: { isCurrent: () => leaseIsCurrent },
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
    "rejects current, acknowledgement, and revision updates after %s expiry",
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

      harness.store.acknowledge(
        harness.target,
        acknowledgement(harness.initialDocument),
      );
      harness.store.updateRevision(harness.target, revision(3));

      expect(harness.store.current(harness.target)).toBeNull();
      expect(harness.documentsRef.current[PATH]).toBe(harness.initialDocument);
      expect(harness.activeDocumentRef.current).toBe(harness.initialDocument);
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

    harness.store.acknowledge(harness.target, saved);

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

    harness.store.acknowledge(
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
