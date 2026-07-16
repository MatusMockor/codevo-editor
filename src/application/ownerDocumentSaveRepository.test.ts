import { describe, expect, it, vi } from "vitest";
import type { EditorDocument } from "../domain/workspace";
import { createWorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import type { DocumentSaveTarget } from "./activeDocumentSaveStore";
import {
  OwnerDocumentSaveRepository,
  type OwnerDocumentRepositoryCandidate,
} from "./ownerDocumentSaveRepository";

const ROOT = "/workspace";
const PATH = `${ROOT}/src/a.ts`;
const owner = createWorkspaceRuntimeOwner("workspace-a", ROOT);
const otherOwner = createWorkspaceRuntimeOwner("workspace-b", ROOT);

function document(content = "edited", savedContent = "saved"): EditorDocument {
  return {
    content,
    language: "typescript",
    name: "a.ts",
    path: PATH,
    savedContent,
  };
}

function candidate(
  repositoryOwner = owner,
  kind: "active" | "cached" = "active",
) {
  const incarnation = {};
  let documentIncarnation = {};
  let currentDocument = document();
  const value: OwnerDocumentRepositoryCandidate = {
    kind,
    owner: repositoryOwner,
    rootPath: ROOT,
    incarnation,
    readDocument: (identity) =>
      identity === "src/a.ts"
        ? { incarnation: documentIncarnation, document: currentDocument }
        : null,
    replaceDocument: (
      identity,
      expectedRepositoryIncarnation,
      expectedDocumentIncarnation,
      expectedDocument,
      nextDocument,
    ) => {
      if (identity !== "src/a.ts") {
        return false;
      }
      if (expectedRepositoryIncarnation !== incarnation) {
        return false;
      }
      if (expectedDocumentIncarnation !== documentIncarnation) {
        return false;
      }
      if (expectedDocument !== currentDocument) {
        return false;
      }

      currentDocument = nextDocument;
      return true;
    },
  };

  return {
    candidate: value,
    document: () => currentDocument,
    editDocument: (next: EditorDocument) => {
      currentDocument = next;
    },
    replaceDocument: (next = document()) => {
      currentDocument = next;
      documentIncarnation = {};
    },
  };
}

function saveTarget(path = PATH): DocumentSaveTarget {
  return {
    rootPath: ROOT,
    path,
    workspaceRequestToken: 0,
    lease: {
      isCurrent: () => true,
      tryBeginWrite: () => ({ granted: true, settle: vi.fn() }),
    },
  };
}

describe("OwnerDocumentSaveRepository", () => {
  it("resolves the captured active document and acknowledges into that incarnation", () => {
    const active = candidate();
    const repository = new OwnerDocumentSaveRepository({
      active: () => active.candidate,
      cached: () => null,
    });
    const captured = active.document();
    const session = repository.resolve({
      owner,
      documentIdentity: "src/a.ts",
      document: captured,
    });

    session?.saveStore.acknowledgeIssuedWrite(saveTarget(), {
      expectedDocument: captured,
      savedDocument: { ...captured, content: "formatted" },
      startingContent: captured.content,
      revision: undefined,
    });

    expect(session?.kind).toBe("active");
    expect(active.document()).toEqual(
      expect.objectContaining({ content: "formatted", savedContent: "formatted" }),
    );
  });

  it("acknowledges an issued write into the current live document", () => {
    const active = candidate();
    const repository = new OwnerDocumentSaveRepository({
      active: () => active.candidate,
      cached: () => null,
    });
    const captured = active.document();
    const session = repository.resolve({
      owner,
      documentIdentity: "src/a.ts",
      document: captured,
    });
    active.editDocument({ ...captured, content: "typed during write" });

    session?.saveStore.acknowledgeIssuedWrite(saveTarget(), {
      expectedDocument: captured,
      savedDocument: { ...captured, content: "formatted" },
      startingContent: captured.content,
      revision: undefined,
    });

    expect(active.document()).toEqual(
      expect.objectContaining({
        content: "typed during write",
        savedContent: "formatted",
      }),
    );
  });

  it("acknowledges a partial-write revision into the current live document", () => {
    const active = candidate();
    const repository = new OwnerDocumentSaveRepository({
      active: () => active.candidate,
      cached: () => null,
    });
    const captured = active.document();
    const session = repository.resolve({
      owner,
      documentIdentity: "src/a.ts",
      document: captured,
    });
    const typed = { ...captured, content: "typed during write" };
    active.editDocument(typed);
    const nextRevision = {
      contentHash: "2",
      device: "1",
      inode: "2",
      modifiedNanoseconds: 3,
      modifiedSeconds: 4,
      size: 5,
    };

    session?.saveStore.updateRevisionForIssuedWrite(
      saveTarget(),
      captured,
      nextRevision,
    );

    expect(active.document()).toEqual({
      ...typed,
      revision: nextRevision,
    });
  });

  it("uses an inactive cached repository without activating it", () => {
    const active = candidate(otherOwner);
    const cached = candidate(owner, "cached");
    const activate = vi.fn();
    const repository = new OwnerDocumentSaveRepository({
      active: () => active.candidate,
      cached: (requestedOwner) => {
        expect(requestedOwner).toBe(owner);
        return cached.candidate;
      },
    });

    const session = repository.resolve({
      owner,
      documentIdentity: "src/a.ts",
      document: cached.document(),
    });

    expect(session?.kind).toBe("cached");
    expect(session?.saveStore.current(saveTarget())).toBe(cached.document());
    expect(activate).not.toHaveBeenCalled();
  });

  it("resolves the current owner document by identity without a captured document", () => {
    const active = candidate();
    const repository = new OwnerDocumentSaveRepository({
      active: () => active.candidate,
      cached: () => null,
    });

    const session = repository.resolveCurrent(owner, "src/a.ts");

    expect(session?.currentDocument()).toBe(active.document());
    expect(session?.path).toBe(PATH);
  });

  it("rejects owner, cache, and document replacement", () => {
    const original = candidate();
    let active: OwnerDocumentRepositoryCandidate | null = original.candidate;
    let cached: OwnerDocumentRepositoryCandidate | null = null;
    const repository = new OwnerDocumentSaveRepository({
      active: () => active,
      cached: () => cached,
    });
    const activeSession = repository.resolve({
      owner,
      documentIdentity: "src/a.ts",
      document: original.document(),
    });

    active = candidate(otherOwner).candidate;
    expect(activeSession?.isCurrent()).toBe(false);

    const cachedOriginal = candidate(owner, "cached");
    active = candidate(otherOwner).candidate;
    cached = cachedOriginal.candidate;
    const cachedSession = repository.resolve({
      owner,
      documentIdentity: "src/a.ts",
      document: cachedOriginal.document(),
    });
    cached = candidate(owner, "cached").candidate;
    expect(cachedSession?.isCurrent()).toBe(false);

    cached = cachedOriginal.candidate;
    const documentSession = repository.resolve({
      owner,
      documentIdentity: "src/a.ts",
      document: cachedOriginal.document(),
    });
    cachedOriginal.replaceDocument();
    expect(documentSession?.isCurrent()).toBe(false);
  });

  it("rejects an already replaced captured document", () => {
    const active = candidate();
    const captured = active.document();
    active.replaceDocument({ ...captured });
    const repository = new OwnerDocumentSaveRepository({
      active: () => active.candidate,
      cached: () => null,
    });

    expect(
      repository.resolve({
        owner,
        documentIdentity: "src/a.ts",
        document: captured,
      }),
    ).toBeNull();
  });
});
