import { describe, expect, it, vi } from "vitest";
import { createEditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import { MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS } from "../domain/liveDocumentContentAuthority";
import type { EditorDocument } from "../domain/workspace";
import {
  captureEditorActiveLiveDocumentForSave,
  createEditorActiveLiveDocumentBinding,
  releaseEditorActiveLiveDocumentContent,
} from "./editorActiveLiveDocumentBinding";
import type {
  EditorChangeHunksSnapshotPort,
  EditorLiveDocumentContentAccessPort,
} from "./editorChangeHunksSnapshotPort";
import { DocumentSessionStore } from "./documentSessionStore";
import { createRegisteredDocumentSaveIdentity } from "./documentSaveIdentity";
import type { LiveDocumentSnapshot } from "./liveDocumentSnapshotBroker";
import type { LiveModelSourceHandle } from "./liveModelIngressCoordinator";
import {
  acknowledgeEditorGroupLiveDocumentSave,
  advanceEditorGroupLiveDocumentSave,
  cancelEditorGroupLiveDocumentSave,
  isEditorGroupLiveDocumentSaveCurrent,
  createEditorGroupChangeHunksBaseline,
  createEditorGroupLiveDocumentAuthority,
  EditorSessionDocumentAuthoritySidecar,
  issueEditorGroupLiveDocumentSave,
} from "./editorSessionDocumentAuthority";
import {
  getEditorDocumentDirtySnapshot,
  getEditorOwnerDirtyCountSnapshot,
  subscribeEditorDocumentDirtyProjection,
  subscribeEditorOwnerDirtyCountProjection,
} from "./editorSessionDirtyProjection";

const PATH = "/workspace/src/a.ts";
const DOCUMENT: EditorDocument = {
  content: "saved",
  language: "typescript",
  name: "a.ts",
  path: PATH,
  savedContent: "saved",
};

describe("EditorSessionDocumentAuthoritySidecar live attachments", () => {
  it("issues a live save only from the exact current runtime snapshot", () => {
    const store = new DocumentSessionStore();
    const sidecar = new EditorSessionDocumentAuthoritySidecar(store);
    expect(activateWorkspaceA(sidecar)).toBe(true);
    const lifecycle = sidecar.resolveLifecycle(PATH)!;
    const group = sidecar.createGroupAuthority(lifecycle, "editor-main", PATH, Object.freeze({}))!;
    const modelIncarnation = Object.freeze({});
    const liveAuthority = createEditorGroupLiveDocumentAuthority(group, {
      id: "model-a",
      incarnation: modelIncarnation,
    })!;
    const attachment = sidecar.attachEditorGroupLiveDocument(
      group,
      {
        captureCurrentContent: () => "saved",
        holderIncarnation: Object.freeze({}),
        modelIncarnation,
      },
      revision(1, 1, 5),
      () => true,
    )!;
    expect(attachment.observe(revision(2, 2, 5))).toBe(true);
    const exactSnapshot = saveSnapshot(liveAuthority, modelIncarnation, 2, 2, 5, "typed");
    const runtime = {
      capture: vi.fn(),
      captureForDirtySearch: vi.fn(),
      captureForSave: vi.fn(() => ({ snapshot: exactSnapshot, status: "captured" as const })),
      consumeCurrent: vi.fn(() => true),
      release: vi.fn(() => true),
      subscribe: vi.fn(() => () => undefined),
    } satisfies EditorChangeHunksSnapshotPort & EditorLiveDocumentContentAccessPort;
    const handle = { modelAuthority: modelIncarnation } as LiveModelSourceHandle;
    const binding = createEditorActiveLiveDocumentBinding({
      handle,
      isCurrent: () => true,
      liveContent: runtime,
      sessionAuthority: group,
      snapshots: runtime,
    });
    const captured = captureEditorActiveLiveDocumentForSave(binding);
    expect(captured.status).toBe("captured");
    if (captured.status !== "captured") return;

    expect(
      issueEditorGroupLiveDocumentSave(attachment, binding, {
        ...captured.capture,
        content: "evill",
      }),
    ).toBeNull();
    const foreignBinding = createEditorActiveLiveDocumentBinding({
      handle: { modelAuthority: Object.freeze({}) } as LiveModelSourceHandle,
      isCurrent: () => true,
      liveContent: runtime,
      sessionAuthority: group,
      snapshots: runtime,
    });
    const foreignCapture = captureEditorActiveLiveDocumentForSave(foreignBinding);
    expect(foreignCapture.status).toBe("captured");
    if (foreignCapture.status !== "captured") return;
    expect(
      issueEditorGroupLiveDocumentSave(attachment, foreignBinding, foreignCapture.capture),
    ).toBeNull();
    expect(releaseEditorActiveLiveDocumentContent(foreignBinding, foreignCapture.capture)).toBe(
      true,
    );
    const permit = issueEditorGroupLiveDocumentSave(attachment, binding, captured.capture);
    expect(permit?.writtenContent).toBe("typed");
    expect(isEditorGroupLiveDocumentSaveCurrent(attachment, permit!)).toBe(true);
    expect(attachment.observe(revision(3, 3, 20))).toBe(true);
    const transformed = advanceEditorGroupLiveDocumentSave(
      attachment,
      permit!,
      revision(3, 3, 20),
      "const typed = true;\n",
    );
    expect(transformed?.writtenContent).toBe("const typed = true;\n");
    expect(isEditorGroupLiveDocumentSaveCurrent(attachment, permit!)).toBe(false);
    expect(acknowledgeEditorGroupLiveDocumentSave(attachment, transformed!, null)).toBe(true);
    expect(sidecar.documentDirty(group)).toBe(false);
    expect(issueEditorGroupLiveDocumentSave(attachment, binding, captured.capture)).toBeNull();

    const nextCaptured = captureEditorActiveLiveDocumentForSave(binding);
    expect(nextCaptured.status).toBe("captured");
    if (nextCaptured.status !== "captured") return;
    expect(attachment.release()).toBe(true);
    expect(issueEditorGroupLiveDocumentSave(attachment, binding, nextCaptured.capture)).toBeNull();
    expect(releaseEditorActiveLiveDocumentContent(binding, nextCaptured.capture)).toBe(true);
  });

  it("cancels compensated consume failures without exhausting live save permits", () => {
    const store = new DocumentSessionStore();
    const sidecar = new EditorSessionDocumentAuthoritySidecar(store);
    expect(activateWorkspaceA(sidecar)).toBe(true);
    const lifecycle = sidecar.resolveLifecycle(PATH)!;
    const group = sidecar.createGroupAuthority(lifecycle, "editor-main", PATH, Object.freeze({}))!;
    const modelIncarnation = Object.freeze({});
    const liveAuthority = createEditorGroupLiveDocumentAuthority(group, {
      id: "model-a",
      incarnation: modelIncarnation,
    })!;
    const attachment = sidecar.attachEditorGroupLiveDocument(
      group,
      {
        captureCurrentContent: () => "saved",
        holderIncarnation: Object.freeze({}),
        modelIncarnation,
      },
      revision(1, 1, 5),
      () => true,
    )!;
    const raw = saveSnapshot(liveAuthority, modelIncarnation, 1, 1, 5, "saved");
    const runtime = {
      capture: vi.fn(),
      captureForDirtySearch: vi.fn(),
      captureForSave: vi.fn(() => ({ snapshot: raw, status: "captured" as const })),
      consumeCurrent: vi.fn<EditorLiveDocumentContentAccessPort["consumeCurrent"]>(),
      release: vi.fn<EditorLiveDocumentContentAccessPort["release"]>(),
      subscribe: vi.fn(() => () => undefined),
    } satisfies EditorChangeHunksSnapshotPort & EditorLiveDocumentContentAccessPort;
    const binding = createEditorActiveLiveDocumentBinding({
      handle: { modelAuthority: modelIncarnation } as LiveModelSourceHandle,
      isCurrent: () => true,
      liveContent: runtime,
      sessionAuthority: group,
      snapshots: runtime,
    });

    runtime.consumeCurrent.mockImplementationOnce(() => {
      throw new Error("consume failed");
    });
    runtime.release.mockReturnValueOnce(true);
    const thrown = captureEditorActiveLiveDocumentForSave(binding);
    expect(thrown.status).toBe("captured");
    if (thrown.status !== "captured") return;
    expect(issueEditorGroupLiveDocumentSave(attachment, binding, thrown.capture)).toBeNull();
    expect(releaseEditorActiveLiveDocumentContent(binding, thrown.capture)).toBe(false);

    runtime.consumeCurrent.mockReturnValue(false);
    runtime.release.mockReturnValue(false);
    const retryable = Array.from({ length: 12 }, () => {
      const captured = captureEditorActiveLiveDocumentForSave(binding);
      if (captured.status !== "captured") throw new Error("Expected save capture");
      expect(issueEditorGroupLiveDocumentSave(attachment, binding, captured.capture)).toBeNull();
      return captured.capture;
    });
    runtime.release.mockReturnValue(true);
    retryable.forEach((capture) =>
      expect(releaseEditorActiveLiveDocumentContent(binding, capture)).toBe(true),
    );

    runtime.consumeCurrent.mockReturnValue(true);
    const recovered = captureEditorActiveLiveDocumentForSave(binding);
    expect(recovered.status).toBe("captured");
    if (recovered.status !== "captured") return;
    const permit = issueEditorGroupLiveDocumentSave(attachment, binding, recovered.capture);
    expect(permit).not.toBeNull();
    expect(store.cancelSave(permit!)).toBe(true);
  });

  it("keeps exact 10 MiB save captures single-use, retryable, and source-scoped", () => {
    const store = new DocumentSessionStore();
    const sidecar = new EditorSessionDocumentAuthoritySidecar(store);
    expect(activateWorkspaceA(sidecar)).toBe(true);
    const lifecycle = sidecar.resolveLifecycle(PATH)!;
    const group = sidecar.createGroupAuthority(lifecycle, "editor-main", PATH, Object.freeze({}))!;
    const modelIncarnation = Object.freeze({});
    const liveAuthority = createEditorGroupLiveDocumentAuthority(group, {
      id: "model-a",
      incarnation: modelIncarnation,
    })!;
    const attachment = sidecar.attachEditorGroupLiveDocument(
      group,
      {
        captureCurrentContent: () => "saved",
        holderIncarnation: Object.freeze({}),
        modelIncarnation,
      },
      revision(1, 1, 5),
      () => true,
    )!;
    const exactContent = "x".repeat(MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS);
    expect(attachment.observe(revision(2, 2, MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS))).toBe(true);
    let currentSnapshot = saveSnapshot(
      liveAuthority,
      modelIncarnation,
      2,
      2,
      MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS,
      exactContent,
    );
    const runtime = {
      capture: vi.fn(),
      captureForDirtySearch: vi.fn(),
      captureForSave: vi.fn(() => ({
        snapshot: currentSnapshot,
        status: "captured" as const,
      })),
      consumeCurrent: vi.fn(() => true),
      release: vi.fn(() => true),
      subscribe: vi.fn(() => () => undefined),
    } satisfies EditorChangeHunksSnapshotPort & EditorLiveDocumentContentAccessPort;
    const binding = createEditorActiveLiveDocumentBinding({
      handle: { modelAuthority: modelIncarnation } as LiveModelSourceHandle,
      isCurrent: () => true,
      liveContent: runtime,
      sessionAuthority: group,
      snapshots: runtime,
    });

    const captured = captureEditorActiveLiveDocumentForSave(binding);
    expect(captured.status).toBe("captured");
    if (captured.status !== "captured") return;
    const permit = issueEditorGroupLiveDocumentSave(attachment, binding, captured.capture);
    expect(permit?.writtenContent).toHaveLength(MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS);
    expect(issueEditorGroupLiveDocumentSave(attachment, binding, captured.capture)).toBeNull();
    expect(cancelEditorGroupLiveDocumentSave(attachment, permit!)).toBe(true);

    const retryCapture = captureEditorActiveLiveDocumentForSave(binding);
    expect(retryCapture.status).toBe("captured");
    if (retryCapture.status !== "captured") return;
    const retryPermit = issueEditorGroupLiveDocumentSave(attachment, binding, retryCapture.capture);
    expect(retryPermit).not.toBeNull();
    expect(cancelEditorGroupLiveDocumentSave(attachment, retryPermit!)).toBe(true);

    expect(attachment.observe(revision(3, 3, MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS + 1))).toBe(
      true,
    );
    currentSnapshot = saveSnapshot(
      liveAuthority,
      modelIncarnation,
      3,
      3,
      MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS + 1,
      `${exactContent}x`,
    );
    const oversized = captureEditorActiveLiveDocumentForSave(binding);
    expect(oversized.status).toBe("captured");
    if (oversized.status !== "captured") return;
    expect(issueEditorGroupLiveDocumentSave(attachment, binding, oversized.capture)).toBeNull();
    expect(releaseEditorActiveLiveDocumentContent(binding, oversized.capture)).toBe(true);

    expect(attachment.release()).toBe(true);
    const staleSourceCapture = captureEditorActiveLiveDocumentForSave(binding);
    expect(staleSourceCapture.status).toBe("captured");
    if (staleSourceCapture.status !== "captured") return;
    expect(
      issueEditorGroupLiveDocumentSave(attachment, binding, staleSourceCapture.capture),
    ).toBeNull();
    expect(releaseEditorActiveLiveDocumentContent(binding, staleSourceCapture.capture)).toBe(true);
  });

  it("keeps raw leases private and derives clean state from exact captured content", () => {
    const store = new DocumentSessionStore();
    const sidecar = new EditorSessionDocumentAuthoritySidecar(store);
    expect(
      sidecar.activateOwner(
        {
          canonicalRoot: "/workspace",
          ownerKey: createEditorSessionOwnerKey("workspace", "/workspace"),
          rootPath: "/workspace",
          workspaceId: "workspace",
        },
        (_rootPath, path) =>
          path === PATH
            ? createRegisteredDocumentSaveIdentity("workspace", "/workspace", "src/a.ts")
            : null,
        { [PATH]: DOCUMENT },
      ),
    ).toBe(true);
    const lifecycle = sidecar.resolveLifecycle(PATH);
    expect(lifecycle).not.toBeNull();
    expect(Object.keys(lifecycle!)).toEqual(["identity"]);
    const authority = sidecar.createGroupAuthority(
      lifecycle!,
      "editor-main",
      PATH,
      Object.freeze({}),
    );
    expect(authority).not.toBeNull();
    expect(Object.keys(authority!)).toEqual(["groupId", "identity", "path"]);
    const liveAuthority = createEditorGroupLiveDocumentAuthority(authority!, {
      id: "model-a",
      incarnation: Object.freeze({}),
    });
    const baseline = createEditorGroupChangeHunksBaseline(authority!, "saved");
    expect(liveAuthority?.documentIdentityKey).toBe(baseline?.documentIdentityKey);
    expect(liveAuthority?.documentIdentityKey).not.toContain("\0");
    let selectionCurrent = true;
    const attachment = sidecar.attachEditorGroupLiveDocument(
      authority!,
      {
        captureCurrentContent: () => "saved",
        holderIncarnation: Object.freeze({}),
        modelIncarnation: Object.freeze({}),
      },
      revision(1, 1, 5),
      () => selectionCurrent,
    );
    expect(attachment).not.toBeNull();
    expect(sidecar.documentDirty(authority!)).toBe(false);

    expect(attachment?.observe(revision(2, 2, 7))).toBe(true);
    expect(sidecar.documentDirty(authority!)).toBe(true);

    expect(attachment?.observe(revision(3, 1, 5))).toBe(true);
    expect(sidecar.documentDirty(authority!)).toBe(false);
    expect(attachment?.release()).toBe(true);

    const divergent = sidecar.attachEditorGroupLiveDocument(
      authority!,
      {
        captureCurrentContent: () => "other",
        holderIncarnation: Object.freeze({}),
        modelIncarnation: Object.freeze({}),
      },
      revision(3, 1, 5),
      () => selectionCurrent,
    );
    expect(divergent).not.toBeNull();
    expect(sidecar.documentDirty(authority!)).toBe(true);
    expect(divergent?.release()).toBe(true);

    const staleProbe = sidecar.attachEditorGroupLiveDocument(
      authority!,
      {
        captureCurrentContent: () => {
          selectionCurrent = false;
          return "saved";
        },
        holderIncarnation: Object.freeze({}),
        modelIncarnation: Object.freeze({}),
      },
      revision(3, 1, 5),
      () => selectionCurrent,
    );
    expect(staleProbe).toBeNull();

    expect(attachment?.observe(revision(4, 4, 9))).toBe(false);
    expect(attachment?.release()).toBe(true);
  });

  it("projects adversarial canonical identities injectively without NUL bytes", () => {
    const left = projectedIdentity('/workspace-"', "src/a.ts");
    const right = projectedIdentity("/workspace", '"/src/a.ts');

    expect(left).not.toContain("\0");
    expect(right).not.toContain("\0");
    expect(left).not.toBe(right);
  });

  it.each([1, 2, 4])(
    "publishes only exact dirty transitions to %i joined panes across 100 edits",
    (paneCount) => {
      const sidecar = activatedSidecar();
      const lifecycle = sidecar.resolveLifecycle(PATH)!;
      const projections = Array.from({ length: paneCount }, (_, index) => {
        const group = sidecar.createGroupAuthority(
          lifecycle,
          `editor-${index}`,
          PATH,
          Object.freeze({}),
        )!;
        return sidecar.resolveDocumentDirtyProjection(group)!;
      });
      expect(new Set(projections).size).toBe(1);
      const documentListeners = projections.map(() => vi.fn());
      const cleanups = projections.map((projection, index) =>
        subscribeEditorDocumentDirtyProjection(projection, documentListeners[index]),
      );
      const ownerProjection = sidecar.resolveOwnerDirtyCountProjection()!;
      expect(Object.keys(projections[0])).toEqual(["kind"]);
      expect(Object.keys(ownerProjection)).toEqual(["kind"]);
      const ownerListener = vi.fn();
      const cleanupOwner = subscribeEditorOwnerDirtyCountProjection(ownerProjection, ownerListener);
      const group = sidecar.createGroupAuthority(
        lifecycle,
        "editor-live",
        PATH,
        Object.freeze({}),
      )!;
      const attachment = sidecar.attachEditorGroupLiveDocument(
        group,
        {
          captureCurrentContent: () => "saved",
          holderIncarnation: Object.freeze({}),
          modelIncarnation: Object.freeze({}),
        },
        revision(1, 1, 5),
        () => true,
      )!;

      expect(getEditorDocumentDirtySnapshot(projections[0])).toEqual({
        dirty: false,
        status: "available",
      });
      for (let version = 2; version <= 101; version += 1) {
        expect(attachment.observe(revision(version, version, 5 + version))).toBe(true);
      }
      expect(getEditorDocumentDirtySnapshot(projections[0])).toEqual({
        dirty: true,
        status: "available",
      });
      expect(getEditorOwnerDirtyCountSnapshot(ownerProjection)).toEqual({
        dirtyCount: 1,
        status: "available",
      });
      for (const listener of documentListeners) {
        expect(listener).toHaveBeenCalledOnce();
      }
      expect(ownerListener).toHaveBeenCalledOnce();

      expect(attachment.observe(revision(102, 1, 5))).toBe(true);
      expect(getEditorDocumentDirtySnapshot(projections[0])).toEqual({
        dirty: false,
        status: "available",
      });
      expect(getEditorOwnerDirtyCountSnapshot(ownerProjection)).toEqual({
        dirtyCount: 0,
        status: "available",
      });
      for (const listener of documentListeners) {
        expect(listener).toHaveBeenCalledTimes(2);
      }
      expect(ownerListener).toHaveBeenCalledTimes(2);

      cleanups.forEach((cleanup) => cleanup());
      cleanupOwner();
    },
  );

  it("fails closed across A to B to A owner reincarnation", () => {
    const sidecar = activatedSidecar();
    const oldLifecycle = sidecar.resolveLifecycle(PATH)!;
    const oldDocumentProjection = sidecar.resolveDocumentDirtyProjection(oldLifecycle)!;
    const oldOwnerProjection = sidecar.resolveOwnerDirtyCountProjection()!;
    const oldDocumentListener = vi.fn();
    const oldOwnerListener = vi.fn();
    subscribeEditorDocumentDirtyProjection(oldDocumentProjection, oldDocumentListener);
    subscribeEditorOwnerDirtyCountProjection(oldOwnerProjection, oldOwnerListener);

    expect(
      sidecar.activateOwner(
        {
          canonicalRoot: "/workspace-b",
          ownerKey: createEditorSessionOwnerKey("workspace", "/workspace-b"),
          rootPath: "/workspace-b",
          workspaceId: "workspace",
        },
        () => null,
        {},
      ),
    ).toBe(true);
    expect(getEditorDocumentDirtySnapshot(oldDocumentProjection)).toEqual({
      status: "unavailable",
    });
    expect(getEditorOwnerDirtyCountSnapshot(oldOwnerProjection)).toEqual({
      status: "unavailable",
    });
    expect(oldDocumentListener).toHaveBeenCalledOnce();
    expect(oldOwnerListener).toHaveBeenCalledOnce();

    expect(activateWorkspaceA(sidecar)).toBe(true);
    const nextLifecycle = sidecar.resolveLifecycle(PATH)!;
    const nextDocumentProjection = sidecar.resolveDocumentDirtyProjection(nextLifecycle)!;
    const nextOwnerProjection = sidecar.resolveOwnerDirtyCountProjection()!;
    expect(nextLifecycle).not.toBe(oldLifecycle);
    expect(nextDocumentProjection).not.toBe(oldDocumentProjection);
    expect(nextOwnerProjection).not.toBe(oldOwnerProjection);
    expect(getEditorDocumentDirtySnapshot(oldDocumentProjection)).toEqual({
      status: "unavailable",
    });
    expect(getEditorOwnerDirtyCountSnapshot(oldOwnerProjection)).toEqual({
      status: "unavailable",
    });
    expect(oldDocumentListener).toHaveBeenCalledOnce();
    expect(oldOwnerListener).toHaveBeenCalledOnce();
  });

  it("bounds dirty projection subscriptions and keeps cleanup idempotent", () => {
    const sidecar = activatedSidecar();
    const lifecycle = sidecar.resolveLifecycle(PATH)!;
    const projection = sidecar.resolveDocumentDirtyProjection(lifecycle)!;
    const listeners = Array.from({ length: 17 }, () => vi.fn());
    const cleanups = listeners.map((listener) =>
      subscribeEditorDocumentDirtyProjection(projection, listener),
    );
    const group = sidecar.createGroupAuthority(lifecycle, "editor-main", PATH, Object.freeze({}))!;
    const attachment = sidecar.attachEditorGroupLiveDocument(
      group,
      {
        captureCurrentContent: () => "saved",
        holderIncarnation: Object.freeze({}),
        modelIncarnation: Object.freeze({}),
      },
      revision(1, 1, 5),
      () => true,
    )!;

    expect(attachment.observe(revision(2, 2, 7))).toBe(true);
    listeners.slice(0, 16).forEach((listener) => expect(listener).toHaveBeenCalledOnce());
    expect(listeners[16]).not.toHaveBeenCalled();
    cleanups.forEach((cleanup) => {
      cleanup();
      cleanup();
    });
  });
});

function activatedSidecar(): EditorSessionDocumentAuthoritySidecar {
  const sidecar = new EditorSessionDocumentAuthoritySidecar(new DocumentSessionStore());
  expect(activateWorkspaceA(sidecar)).toBe(true);
  return sidecar;
}

function activateWorkspaceA(sidecar: EditorSessionDocumentAuthoritySidecar): boolean {
  return sidecar.activateOwner(
    {
      canonicalRoot: "/workspace",
      ownerKey: createEditorSessionOwnerKey("workspace", "/workspace"),
      rootPath: "/workspace",
      workspaceId: "workspace",
    },
    (_rootPath, path) =>
      path === PATH
        ? createRegisteredDocumentSaveIdentity("workspace", "/workspace", "src/a.ts")
        : null,
    { [PATH]: DOCUMENT },
  );
}

function projectedIdentity(canonicalRoot: string, relativePath: string): string {
  const path = `${canonicalRoot}/${relativePath}`;
  const store = new DocumentSessionStore();
  const sidecar = new EditorSessionDocumentAuthoritySidecar(store);
  expect(
    sidecar.activateOwner(
      {
        canonicalRoot,
        ownerKey: createEditorSessionOwnerKey("workspace", canonicalRoot),
        rootPath: canonicalRoot,
        workspaceId: "workspace",
      },
      (_rootPath, candidate) =>
        candidate === path
          ? createRegisteredDocumentSaveIdentity("workspace", canonicalRoot, relativePath)
          : null,
      { [path]: { ...DOCUMENT, path } },
    ),
  ).toBe(true);
  const lifecycle = sidecar.resolveLifecycle(path);
  const authority = lifecycle
    ? sidecar.createGroupAuthority(lifecycle, "editor-main", path, Object.freeze({}))
    : null;
  const live = authority
    ? createEditorGroupLiveDocumentAuthority(authority, {
        id: "model",
        incarnation: Object.freeze({}),
      })
    : null;
  expect(live).not.toBeNull();
  return live!.documentIdentityKey;
}

function revision(version: number, alternativeVersionId: number, utf16Length: number) {
  return {
    alternativeVersionId,
    contentVersion: version,
    mode: version === 1 ? ("retained" as const) : ("incremental" as const),
    modelVersionId: version,
    utf16Length,
  };
}

function saveSnapshot(
  authority: NonNullable<ReturnType<typeof createEditorGroupLiveDocumentAuthority>>,
  modelAuthority: object,
  contentVersion: number,
  alternativeVersionId: number,
  utf16Length: number,
  content: string,
): LiveDocumentSnapshot {
  return Object.freeze({
    alternativeVersionId,
    authority,
    content,
    contentVersion,
    modelAuthority,
    modelVersionId: contentVersion,
    purpose: "save",
    reservationAuthority: Object.freeze({}),
    snapshotAuthority: Object.freeze({}),
    sourceAuthority: Object.freeze({}),
    utf16Length,
    utf8BytesUpperBound: content.length * 3,
  });
}
