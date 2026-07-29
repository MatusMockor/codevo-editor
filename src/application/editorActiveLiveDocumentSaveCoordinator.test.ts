import { describe, expect, it, vi } from "vitest";
import { createEditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import { MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS } from "../domain/liveDocumentContentAuthority";
import type { EditorDocument } from "../domain/workspace";
import type { ActiveDocumentSaveStorePort } from "./activeDocumentSaveStore";
import { createEditorActiveLiveDocumentBinding } from "./editorActiveLiveDocumentBinding";
import {
  createEditorActiveLiveDocumentSaveBinding,
  EditorActiveLiveDocumentSaveCoordinator,
} from "./editorActiveLiveDocumentSaveCoordinator";
import type {
  EditorChangeHunksSnapshotPort,
  EditorLiveDocumentContentAccessPort,
} from "./editorChangeHunksSnapshotPort";
import { createRegisteredDocumentSaveIdentity } from "./documentSaveIdentity";
import { DocumentSessionStore } from "./documentSessionStore";
import {
  createEditorGroupLiveDocumentAuthority,
  EditorSessionDocumentAuthoritySidecar,
} from "./editorSessionDocumentAuthority";
import type { LiveDocumentSnapshot } from "./liveDocumentSnapshotBroker";
import type { LiveModelRevision, LiveModelSourceHandle } from "./liveModelIngressCoordinator";

const ROOT = "/workspace";
const PATH = `${ROOT}/src/a.ts`;

describe("EditorActiveLiveDocumentSaveCoordinator", () => {
  it("applies transformed content before write admission and acknowledges the exact baseline", () => {
    const subject = createSubject();
    const admitted = subject.admit();
    expect(admitted.status).toBe("admitted");
    if (admitted.status !== "admitted") return;

    const expected = admitted.saveStore.current(admitted.target)!;
    const saved = { ...expected, content: "const value = true;\n" };
    const write = admitted.target.lease.tryBeginWrite()!;
    expect(admitted.saveStore.prepareIssuedWrite?.(admitted.target, expected, saved)).toBe(true);
    expect(subject.appliedContent).toEqual(["const value = true;\n"]);
    expect(
      admitted.saveStore.acknowledgeIssuedWrite(admitted.target, {
        expectedDocument: expected,
        revision: null,
        savedDocument: saved,
        startingContent: expected.content,
      }),
    ).toBe(true);
    write.settle();
    admitted.settle();

    expect(subject.sidecar.documentDirty(subject.group)).toBe(false);
    expect(subject.legacyDocument()).toMatchObject({
      content: "const value = true;\n",
      savedContent: "const value = true;\n",
    });
  });

  it("keeps transformed Monaco content authoritative when the legacy projection stays stale", () => {
    const subject = createSubject({ projectAppliedContentToLegacy: false });
    const admitted = subject.admit();
    expect(admitted.status).toBe("admitted");
    if (admitted.status !== "admitted") return;

    const expected = admitted.saveStore.current(admitted.target)!;
    const saved = { ...expected, content: "const value = true;\n" };
    const write = admitted.target.lease.tryBeginWrite()!;
    expect(admitted.saveStore.prepareIssuedWrite?.(admitted.target, expected, saved)).toBe(true);
    expect(subject.legacyDocument()).toMatchObject({ content: "typed", savedContent: "base" });
    expect(admitted.saveStore.current(admitted.target)).toMatchObject({
      content: saved.content,
      savedContent: "base",
    });

    expect(
      admitted.saveStore.acknowledgeIssuedWrite(admitted.target, {
        expectedDocument: expected,
        revision: null,
        savedDocument: saved,
        startingContent: expected.content,
      }),
    ).toBe(true);
    write.settle();
    expect(admitted.saveStore.current(admitted.target)).toMatchObject({
      content: saved.content,
      revision: null,
      savedContent: saved.content,
    });
    expect(subject.legacyDocument()).toMatchObject({
      content: "typed",
      savedContent: saved.content,
    });

    admitted.settle();
  });

  it("keeps captured Monaco content authoritative when an unchanged participant leaves React stale", () => {
    const subject = createSubject({ startLegacyProjectionStale: true });
    const admitted = subject.admit();
    expect(admitted.status).toBe("admitted");
    if (admitted.status !== "admitted") return;

    const expected = admitted.saveStore.current(admitted.target)!;
    const write = admitted.target.lease.tryBeginWrite()!;
    expect(admitted.saveStore.prepareIssuedWrite?.(admitted.target, expected, expected)).toBe(true);
    expect(subject.appliedContent).toEqual([]);
    expect(subject.legacyDocument()).toMatchObject({ content: "base", savedContent: "base" });

    expect(
      admitted.saveStore.acknowledgeIssuedWrite(admitted.target, {
        expectedDocument: expected,
        revision: null,
        savedDocument: expected,
        startingContent: expected.content,
      }),
    ).toBe(true);
    write.settle();

    expect(admitted.saveStore.current(admitted.target)).toMatchObject({
      content: "typed",
      savedContent: "typed",
    });
    expect(subject.legacyDocument()).toMatchObject({
      content: "base",
      savedContent: "typed",
    });
    admitted.settle();
  });

  it("rejects an oversized transformed participant result before mutating Monaco", () => {
    const subject = createSubject({ projectAppliedContentToLegacy: false });
    const admitted = subject.admit();
    expect(admitted.status).toBe("admitted");
    if (admitted.status !== "admitted") return;

    const expected = admitted.saveStore.current(admitted.target)!;
    const oversized = "x".repeat(MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS + 1);
    const write = admitted.target.lease.tryBeginWrite()!;

    expect(
      admitted.saveStore.prepareIssuedWrite?.(admitted.target, expected, {
        ...expected,
        content: oversized,
      }),
    ).toBe(false);
    expect(subject.appliedContent).toEqual([]);
    expect(subject.legacyDocument()).toMatchObject({ content: "typed", savedContent: "base" });

    write.settle();
    admitted.settle();
  });

  it("keeps an edit arriving during the disk write dirty without losing it", () => {
    const subject = createSubject({ projectAppliedContentToLegacy: false });
    const admitted = subject.admit();
    expect(admitted.status).toBe("admitted");
    if (admitted.status !== "admitted") return;

    const expected = admitted.saveStore.current(admitted.target)!;
    const saved = { ...expected, content: "const value = true;\n" };
    const write = admitted.target.lease.tryBeginWrite()!;
    expect(admitted.saveStore.prepareIssuedWrite?.(admitted.target, expected, saved)).toBe(true);

    subject.editDuringWrite("const value = false;\n");
    expect(
      admitted.saveStore.acknowledgeIssuedWrite(admitted.target, {
        expectedDocument: expected,
        revision: null,
        savedDocument: saved,
        startingContent: expected.content,
      }),
    ).toBe(true);
    write.settle();
    expect(admitted.saveStore.current(admitted.target)).toMatchObject({
      content: "const value = false;\n",
      savedContent: "const value = true;\n",
    });
    admitted.settle();

    expect(subject.sidecar.documentDirty(subject.group)).toBe(true);
    expect(subject.legacyDocument()).toMatchObject({
      content: "const value = false;\n",
      savedContent: "const value = true;\n",
    });
  });

  it("preserves an edit-during-write ABA back to the captured text", () => {
    const subject = createSubject({ projectAppliedContentToLegacy: false });
    const admitted = subject.admit();
    expect(admitted.status).toBe("admitted");
    if (admitted.status !== "admitted") return;

    const expected = admitted.saveStore.current(admitted.target)!;
    const saved = { ...expected, content: "formatted" };
    const write = admitted.target.lease.tryBeginWrite()!;
    expect(admitted.saveStore.prepareIssuedWrite?.(admitted.target, expected, saved)).toBe(true);

    subject.editDuringWrite(expected.content);
    expect(
      admitted.saveStore.acknowledgeIssuedWrite(admitted.target, {
        expectedDocument: expected,
        revision: null,
        savedDocument: saved,
        startingContent: expected.content,
      }),
    ).toBe(true);
    write.settle();

    expect(admitted.saveStore.current(admitted.target)).toMatchObject({
      content: expected.content,
      savedContent: saved.content,
    });
    expect(subject.sidecar.documentDirty(subject.group)).toBe(true);
    admitted.settle();
  });

  it("settles an admitted permit when preparation becomes stale before a write", () => {
    const subject = createSubject();
    const admitted = subject.admit();
    expect(admitted.status).toBe("admitted");
    if (admitted.status !== "admitted") return;
    subject.retire();

    expect(admitted.saveStore.current(admitted.target)).toBeNull();
    admitted.settle();
    admitted.settle();
    expect(subject.sidecar.documentDirty(subject.group)).toBe(true);
  });

  it("acknowledges an exact unchanged baseline without entering the disk-write phase", () => {
    const subject = createSubject();
    subject.setLegacySavedContent("typed");
    const admitted = subject.admit();
    expect(admitted.status).toBe("admitted");
    if (admitted.status !== "admitted") return;

    const expected = admitted.saveStore.current(admitted.target)!;
    expect(
      admitted.saveStore.reconcileUnchangedPreparedContent?.(
        admitted.target,
        expected,
        expected.content,
      ),
    ).toMatchObject({ content: "typed", savedContent: "typed" });
    admitted.settle();

    expect(subject.sidecar.documentDirty(subject.group)).toBe(false);
  });

  it("falls back before capture when the exact live owner does not match the save root", () => {
    const subject = createSubject();
    expect(subject.admit("/workspace-b")).toEqual({ status: "fallback" });
    expect(subject.captureForSave).not.toHaveBeenCalled();
  });

  it("blocks an oversized exact-live save without falling back and recovers after shrink", () => {
    const subject = createSubject();
    subject.captureForSave.mockReturnValueOnce({
      reason: "document-too-large",
      status: "rejected",
    });

    expect(subject.admit()).toEqual({
      reason: "document-too-large",
      status: "rejected",
    });
    expect(subject.legacyDocument()).toMatchObject({ content: "typed", savedContent: "base" });

    expect(subject.admit().status).toBe("admitted");
  });

  it.each(["aborted", "source-failed", "stale"] as const)(
    "blocks an exact-live %s capture without legacy fallback",
    (reason) => {
      const subject = createSubject();
      subject.captureForSave.mockReturnValueOnce({ reason, status: "rejected" });

      expect(subject.admit()).toEqual({
        reason: "exact-live-unavailable",
        status: "rejected",
      });
      expect(subject.legacyDocument()).toMatchObject({ content: "typed", savedContent: "base" });
    },
  );

  it("retains fail-closed ownership across retirement and recovers on exact A-B-A republish", () => {
    const subject = createSubject();
    subject.unpublish();

    expect(subject.admit()).toEqual({
      reason: "exact-live-unavailable",
      status: "rejected",
    });
    expect(subject.captureForSave).not.toHaveBeenCalled();

    subject.republish();
    expect(subject.admit().status).toBe("admitted");
  });

  it("rejects a stale exact facade instead of falling back to its React projection", () => {
    const subject = createSubject();
    subject.retire();

    expect(subject.admit()).toEqual({
      reason: "exact-live-unavailable",
      status: "rejected",
    });
    expect(subject.captureForSave).not.toHaveBeenCalled();
  });

  it("fails closed when exact workspace ownership cannot be determined", () => {
    const subject = createSubject();
    subject.makeWorkspaceMatchUncertain();

    expect(subject.admit()).toEqual({
      reason: "exact-live-unavailable",
      status: "rejected",
    });
    expect(subject.captureForSave).not.toHaveBeenCalled();
  });

  it("does not let many retired paths block an unrelated inactive-file fallback", () => {
    const subject = createSubject();
    subject.publishDistinctPaths(65);

    expect(subject.admitInactive(PATH)).toEqual({
      reason: "exact-live-unavailable",
      status: "rejected",
    });
    expect(subject.admitInactive(`${ROOT}/src/unbound.ts`)).toEqual({
      status: "fallback",
    });
    expect(subject.admitInactive(PATH, "/other-workspace")).toEqual({
      status: "fallback",
    });

    subject.resetRetiredOwnership();
    expect(subject.admitInactive(PATH)).toEqual({
      status: "fallback",
    });
  });

  it("retains same-path retirement independently across workspace roots", () => {
    const subject = createSubject();
    subject.publishSamePathForRoot("/workspace-a");
    subject.publishSamePathForRoot("/workspace-b");

    expect(subject.admitInactive(PATH, "/workspace-a")).toEqual({
      reason: "exact-live-unavailable",
      status: "rejected",
    });
  });
});

function createSubject(
  options: {
    readonly projectAppliedContentToLegacy?: boolean;
    readonly startLegacyProjectionStale?: boolean;
  } = {},
) {
  const store = new DocumentSessionStore();
  const sidecar = new EditorSessionDocumentAuthoritySidecar(store);
  const initial: EditorDocument = {
    content: "base",
    language: "typescript",
    name: "a.ts",
    path: PATH,
    savedContent: "base",
  };
  expect(
    sidecar.activateOwner(
      {
        canonicalRoot: ROOT,
        ownerKey: createEditorSessionOwnerKey("workspace", ROOT),
        rootPath: ROOT,
        workspaceId: "workspace",
      },
      (_root, path) =>
        path === PATH ? createRegisteredDocumentSaveIdentity("workspace", ROOT, "src/a.ts") : null,
      { [PATH]: initial },
    ),
  ).toBe(true);
  const lifecycle = sidecar.resolveLifecycle(PATH)!;
  const group = sidecar.createGroupAuthority(lifecycle, "editor-main", PATH, Object.freeze({}))!;
  const modelAuthority = Object.freeze({});
  let current = true;
  const liveAuthority = createEditorGroupLiveDocumentAuthority(group, {
    id: "model-a",
    incarnation: modelAuthority,
  })!;
  const attachment = sidecar.attachEditorGroupLiveDocument(
    group,
    {
      captureCurrentContent: () => "typed",
      holderIncarnation: Object.freeze({}),
      modelIncarnation: modelAuthority,
    },
    revision(1, 1, 4),
    () => current,
  )!;
  expect(attachment.observe(revision(2, 2, 5))).toBe(true);
  let liveRevision = revision(2, 2, 5);
  let workspaceMatchUncertain = false;
  const snapshot = saveSnapshot(liveAuthority, modelAuthority, liveRevision, "typed");
  const captureForSave = vi.fn<EditorLiveDocumentContentAccessPort["captureForSave"]>(() => ({
    snapshot,
    status: "captured" as const,
  }));
  const runtime = {
    capture: vi.fn(),
    captureForDirtySearch: vi.fn(),
    captureForSave,
    consumeCurrent: vi.fn(() => true),
    release: vi.fn(() => true),
    subscribe: vi.fn(() => () => undefined),
  } satisfies EditorChangeHunksSnapshotPort & EditorLiveDocumentContentAccessPort;
  const binding = createEditorActiveLiveDocumentBinding({
    handle: { modelAuthority } as LiveModelSourceHandle,
    isCurrent: () => current,
    liveContent: runtime,
    sessionAuthority: group,
    snapshots: runtime,
  });
  const appliedContent: string[] = [];
  let legacy = options.startLegacyProjectionStale ? initial : { ...initial, content: "typed" };
  const facade = createEditorActiveLiveDocumentSaveBinding({
    applyContent: (content) => {
      appliedContent.push(content);
      if (options.projectAppliedContentToLegacy !== false) {
        legacy = { ...legacy, content };
      }
      liveRevision = revision(
        liveRevision.contentVersion + 1,
        liveRevision.alternativeVersionId + 1,
        content.length,
      );
      return attachment.observe(liveRevision) ? liveRevision : null;
    },
    attachment,
    binding,
    retirementScopeKey: ROOT,
    workspaceMatches: (rootPath) => {
      if (workspaceMatchUncertain) {
        throw new Error("workspace ownership unavailable");
      }
      return rootPath === ROOT;
    },
  });
  const coordinator = new EditorActiveLiveDocumentSaveCoordinator();
  coordinator.publish(facade);
  const legacySaveStore: ActiveDocumentSaveStorePort = {
    acknowledgeIssuedWrite: (_target, acknowledgement) => {
      legacy = {
        ...legacy,
        savedContent: acknowledgement.savedDocument.content,
        revision: acknowledgement.revision,
      };
    },
    current: () => legacy,
    reconcileUnchangedPreparedContent: (_target, _expected, content) => {
      legacy = { ...legacy, content };
      return legacy;
    },
    updateRevision: (_target, revisionValue) => {
      legacy = { ...legacy, revision: revisionValue };
    },
    updateRevisionForIssuedWrite: (_target, _expected, revisionValue) => {
      legacy = { ...legacy, revision: revisionValue };
    },
  };
  const outerLease = {
    epoch: 1,
    isCurrent: () => current,
    path: PATH,
    rootPath: ROOT,
    tryBeginWrite: () => ({
      granted: true as const,
      settle: vi.fn(),
    }),
  };
  const target = {
    lease: outerLease,
    path: PATH,
    rootPath: ROOT,
    workspaceRequestToken: 1,
  };
  return {
    admit: (rootPath = ROOT) =>
      coordinator.admit({
        document: legacy,
        lease: outerLease,
        legacySaveStore,
        requireExactLiveSave: rootPath === ROOT,
        target: { ...target, rootPath },
      }),
    admitInactive: (path: string, rootPath = ROOT) =>
      coordinator.admit({
        document: { ...legacy, path },
        lease: outerLease,
        legacySaveStore,
        requireExactLiveSave: false,
        target: { ...target, path, rootPath },
      }),
    appliedContent,
    captureForSave: runtime.captureForSave,
    editDuringWrite: (content: string) => {
      legacy = { ...legacy, content };
      liveRevision = revision(
        liveRevision.contentVersion + 1,
        liveRevision.alternativeVersionId + 1,
        content.length,
      );
      expect(attachment.observe(liveRevision)).toBe(true);
    },
    group,
    legacyDocument: () => legacy,
    makeWorkspaceMatchUncertain: () => {
      workspaceMatchUncertain = true;
    },
    publishDistinctPaths: (count: number) => {
      for (let index = 0; index < count; index += 1) {
        coordinator.publish(
          createEditorActiveLiveDocumentSaveBinding({
            applyContent: () => null,
            attachment,
            binding: {
              groupId: `editor-${index}`,
              isCurrent: () => true,
              path: `${ROOT}/src/retired-${index}.ts`,
            },
            retirementScopeKey: ROOT,
            workspaceMatches: (rootPath) => rootPath === ROOT,
          }),
        );
      }
    },
    publishSamePathForRoot: (workspaceRoot: string) => {
      coordinator.publish(
        createEditorActiveLiveDocumentSaveBinding({
          applyContent: () => null,
          attachment,
          binding: {
            groupId: `editor-${workspaceRoot}`,
            isCurrent: () => true,
            path: PATH,
          },
          retirementScopeKey: workspaceRoot,
          workspaceMatches: (rootPath) => rootPath === workspaceRoot,
        }),
      );
    },
    republish: () => coordinator.publish(facade),
    resetRetiredOwnership: () => coordinator.resetRetiredOwnership(),
    retire: () => {
      current = false;
    },
    setLegacySavedContent: (content: string) => {
      legacy = { ...legacy, savedContent: content };
    },
    sidecar,
    unpublish: () => coordinator.publish(null),
  };
}

function revision(
  contentVersion: number,
  alternativeVersionId: number,
  utf16Length: number,
): LiveModelRevision {
  return {
    alternativeVersionId,
    contentVersion,
    mode: contentVersion === 1 ? "retained" : "incremental",
    modelVersionId: contentVersion,
    utf16Length,
  };
}

function saveSnapshot(
  authority: NonNullable<ReturnType<typeof createEditorGroupLiveDocumentAuthority>>,
  modelAuthority: object,
  revisionValue: LiveModelRevision,
  content: string,
): LiveDocumentSnapshot {
  return Object.freeze({
    alternativeVersionId: revisionValue.alternativeVersionId,
    authority,
    content,
    contentVersion: revisionValue.contentVersion,
    modelAuthority,
    modelVersionId: revisionValue.modelVersionId,
    purpose: "save",
    reservationAuthority: Object.freeze({}),
    snapshotAuthority: Object.freeze({}),
    sourceAuthority: Object.freeze({}),
    utf16Length: revisionValue.utf16Length!,
    utf8BytesUpperBound: content.length * 3,
  });
}
