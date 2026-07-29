// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { createInitialEditorGroupsState, editorGroupsReducer } from "../domain/editorGroups";
import { createEditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import type { MarkdownPreviewTab } from "../domain/markdownPreview";
import type { EditorDocument, ImageTab } from "../domain/workspace";
import type { EditorSurfaceSnapshot } from "../domain/workspaceSessionSnapshot";
import { createRegisteredDocumentSaveIdentity } from "./documentSaveIdentity";
import { useEditorSessionState, type EditorSessionState } from "./useEditorSessionState";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const DOCUMENT_A: EditorDocument = {
  content: "changed",
  language: "typescript",
  name: "a.ts",
  path: "/workspace/a.ts",
  savedContent: "saved",
};

const DOCUMENT_B: EditorDocument = {
  content: "export {};",
  language: "typescript",
  name: "b.ts",
  path: "/workspace/b.ts",
  savedContent: "export {};",
};

const DOCUMENT_C: EditorDocument = {
  content: "const c = true;",
  language: "typescript",
  name: "c.ts",
  path: "/workspace/c.ts",
  savedContent: "const c = true;",
};

const FOREIGN_DOCUMENT: EditorDocument = {
  ...DOCUMENT_B,
  name: "foreign.ts",
  path: "/other-workspace/foreign.ts",
};

const IMAGE: ImageTab = {
  byteLength: 3,
  dataUrl: "data:image/png;base64,abc",
  name: "diagram.png",
  path: "/workspace/diagram.png",
};

const FOREIGN_IMAGE: ImageTab = {
  ...IMAGE,
  name: "foreign.png",
  path: "/other-workspace/foreign.png",
};

const PREVIEW: MarkdownPreviewTab = {
  content: "# Preview",
  html: "<h1>Preview</h1>",
  name: "README.md Preview",
  path: "markdown-preview:///workspace/README.md",
  sourcePath: "/workspace/README.md",
};

const FOREIGN_PREVIEW: MarkdownPreviewTab = {
  ...PREVIEW,
  path: "markdown-preview:///other-workspace/README.md",
  sourcePath: "/other-workspace/README.md",
};

interface Harness {
  renderCount: () => number;
  session: () => EditorSessionState;
  unmount: () => void;
}

function renderEditorSessionState(): Harness {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { current: EditorSessionState | null } = { current: null };
  let renderCount = 0;
  function Probe() {
    renderCount += 1;
    captured.current = useEditorSessionState();
    return null;
  }

  act(() => {
    root.render(<Probe />);
  });

  return {
    renderCount: () => renderCount,
    session: () => {
      if (!captured.current) {
        throw new Error("hook not mounted");
      }

      return captured.current;
    },
    unmount: () => {
      act(() => root.unmount());
    },
  };
}

function injectedResolver(
  workspaceId: string,
  selectedRoot: string,
  canonicalRoot: string,
  virtualPrefix: string,
) {
  return (rootPath: string, path: string) => {
    if (rootPath !== selectedRoot || !path.startsWith(virtualPrefix)) {
      return null;
    }
    return createRegisteredDocumentSaveIdentity(
      workspaceId,
      canonicalRoot,
      path.slice(virtualPrefix.length),
    );
  };
}

function liveRevision(version: number) {
  return {
    alternativeVersionId: version,
    contentVersion: version,
    mode: version === 1 ? ("retained" as const) : ("incremental" as const),
    modelVersionId: version,
    utf16Length: version === 1 ? 5 : 5 + version,
  };
}

describe("useEditorSessionState", () => {
  it("exposes injected exact sidecar authority across groups, reopen, and A-B-A", () => {
    const harness = renderEditorSessionState();
    const canonicalA = "/canonical/a";
    const canonicalB = "/canonical/b";
    const selectedA = "/selected/a";
    const selectedB = "/selected/b";
    const pathA = "/virtual/a/src/a.ts";
    const pathB = "/virtual/b/src/b.ts";
    const documentA = { ...DOCUMENT_A, path: pathA };
    const documentB = { ...DOCUMENT_B, path: pathB };
    const resolveA = injectedResolver("workspace-a", selectedA, canonicalA, "/virtual/a/");
    const resolveB = injectedResolver("workspace-b", selectedB, canonicalB, "/virtual/b/");
    const ownerA = {
      canonicalRoot: canonicalA,
      ownerKey: createEditorSessionOwnerKey("workspace-a", canonicalA),
      rootPath: selectedA,
      workspaceId: "workspace-a",
    };
    const ownerB = {
      canonicalRoot: canonicalB,
      ownerKey: createEditorSessionOwnerKey("workspace-b", canonicalB),
      rootPath: selectedB,
      workspaceId: "workspace-b",
    };

    act(() => {
      const session = harness.session();
      expect(
        session.activateDocumentSessionAuthority(ownerA, resolveA, {
          [pathA]: documentA,
        }),
      ).toBe(true);
      session.setDocuments({ [pathA]: documentA });
      let groups = createInitialEditorGroupsState("editor-main", {
        activePath: pathA,
        openPaths: [pathA],
        previewPath: null,
      });
      groups = editorGroupsReducer(groups, {
        direction: "right",
        newGroupId: "editor-1",
        type: "split-group",
      });
      groups = {
        ...groups,
        groups: {
          ...groups.groups,
          "editor-1": {
            activePath: pathA,
            openPaths: [pathA],
            previewPath: null,
          },
        },
      };
      session.updateEditorGroups(() => groups);
    });

    const first = harness.session().resolveEditorGroupDocumentSessionAuthority("editor-main");
    expect(first).not.toBeNull();
    const firstAuthorityRevision = harness.session().documentSessionAuthorityRevision;
    const firstLifecycle = harness.session().resolveDocumentSessionLifecycleAuthority(pathA)!;
    const secondGroup = harness.session().resolveEditorGroupDocumentSessionAuthority("editor-1");
    expect(secondGroup?.identity).not.toBe(first?.identity);
    expect(secondGroup?.groupId).toBe("editor-1");
    expect(harness.session().resolveDocumentSessionLifecycleAuthority(pathA)?.identity).toBe(
      firstLifecycle.identity,
    );
    expect(harness.session().isEditorGroupDocumentSessionAuthorityCurrent(first!)).toBe(true);
    const priorGroups = harness.session().editorGroupsRef.current;
    act(() => {
      harness.session().updateEditorGroups((current) => ({
        ...current,
        activeGroupId: "editor-1",
        groups: { ...current.groups },
      }));
    });
    expect(harness.session().documentSessionAuthorityRevision).toBe(firstAuthorityRevision);
    expect(harness.session().isEditorGroupDocumentSessionAuthorityCurrent(first!)).toBe(true);
    act(() => {
      harness.session().updateEditorGroups((current) =>
        current.layout.kind === "split"
          ? {
              ...current,
              layout: {
                ...current.layout,
                sizes: [0.55, 0.45],
              },
            }
          : current,
      );
    });
    expect(harness.session().documentSessionAuthorityRevision).toBe(firstAuthorityRevision);
    act(() => {
      harness.session().updateEditorGroups((current) => ({
        ...current,
        groups: {
          ...current.groups,
          [first!.groupId]: {
            ...current.groups[first!.groupId],
            activePath: null,
          },
        },
      }));
      harness.session().updateEditorGroups(() => priorGroups);
    });
    expect(harness.session().isEditorGroupDocumentSessionAuthorityCurrent(first!)).toBe(false);
    const rotatedSelectionRevision = harness.session().documentSessionAuthorityRevision;
    expect(rotatedSelectionRevision).not.toBe(firstAuthorityRevision);

    act(() => {
      harness.session().documentTabSession.removeDocument(pathA);
    });
    const closedRevision = harness.session().documentSessionAuthorityRevision;
    expect(closedRevision).not.toBe(rotatedSelectionRevision);
    expect(harness.session().resolveDocumentSessionLifecycleAuthority(pathA)).toBeNull();
    expect(harness.session().isDocumentSessionLifecycleAuthorityCurrent(firstLifecycle)).toBe(
      false,
    );

    act(() => {
      harness.session().documentTabSession.commitTextOpen({
        document: documentA,
        pin: true,
      });
    });
    const reopened = harness.session().resolveDocumentSessionLifecycleAuthority(pathA);
    const reopenedRevision = harness.session().documentSessionAuthorityRevision;
    expect(reopened).not.toBeNull();
    expect(reopened?.identity).not.toBe(first?.identity);
    expect(reopenedRevision).not.toBe(closedRevision);

    act(() => {
      const session = harness.session();
      session.setDocuments({});
      expect(
        session.activateDocumentSessionAuthority(ownerB, resolveB, {
          [pathB]: documentB,
        }),
      ).toBe(true);
      session.setDocuments({ [pathB]: documentB });
      session.updateEditorGroups(() =>
        createInitialEditorGroupsState("editor-main", {
          activePath: pathB,
          openPaths: [pathB],
          previewPath: null,
        }),
      );
    });
    expect(harness.session().isDocumentSessionLifecycleAuthorityCurrent(reopened!)).toBe(false);
    expect(harness.session().resolveActiveDocumentSessionAuthority()?.path).toBe(pathB);

    act(() => {
      const session = harness.session();
      session.setDocuments({});
      expect(
        session.activateDocumentSessionAuthority(ownerA, resolveA, {
          [pathA]: documentA,
        }),
      ).toBe(true);
      session.setDocuments({ [pathA]: documentA });
      session.updateEditorGroups(() =>
        createInitialEditorGroupsState("editor-main", {
          activePath: pathA,
          openPaths: [pathA],
          previewPath: null,
        }),
      );
    });
    const nextA = harness.session().resolveActiveDocumentSessionAuthority();
    expect(nextA).not.toBeNull();
    expect(harness.session().resolveDocumentSessionLifecycleAuthority(pathA)?.identity).not.toBe(
      firstLifecycle.identity,
    );
    expect(harness.session().isDocumentSessionLifecycleAuthorityCurrent(reopened!)).toBe(false);
    harness.unmount();
  });

  it("keeps legacy documents visible after fail-closed explicit activation", () => {
    const harness = renderEditorSessionState();
    const canonicalRoot = "/canonical/a";
    const selectedRoot = "/selected/a";
    const owner = {
      canonicalRoot,
      ownerKey: createEditorSessionOwnerKey("workspace-a", canonicalRoot),
      rootPath: selectedRoot,
      workspaceId: "workspace-a",
    };

    act(() => {
      expect(
        harness
          .session()
          .activateDocumentSessionAuthority(
            owner,
            () => createRegisteredDocumentSaveIdentity("workspace-a", "/foreign", "a.ts"),
            { [DOCUMENT_A.path]: DOCUMENT_A },
          ),
      ).toBe(false);
      harness.session().setDocuments({ [DOCUMENT_A.path]: DOCUMENT_A });
    });

    expect(harness.session().documents[DOCUMENT_A.path]).toBe(DOCUMENT_A);
    expect(harness.session().documentsRef.current[DOCUMENT_A.path]).toBe(DOCUMENT_A);
    expect(harness.session().resolveDocumentSessionLifecycleAuthority(DOCUMENT_A.path)).toBeNull();
    harness.unmount();
  });

  it("mirrors current documents on activation and excludes known transient documents", () => {
    const harness = renderEditorSessionState();
    const canonicalRoot = "/canonical/a";
    const selectedRoot = "/selected/a";
    const path = "/virtual/a/src/a.ts";
    const transientPath = "mockor-git-diff:worktree:/virtual/a/src/a.ts";
    const document = { ...DOCUMENT_A, path };
    const transientDocument = {
      ...DOCUMENT_B,
      path: transientPath,
      readOnly: true,
    };

    act(() => {
      const session = harness.session();
      session.setDocuments({
        [path]: document,
        [transientPath]: transientDocument,
      });
      expect(
        session.activateDocumentSessionAuthority(
          {
            canonicalRoot,
            ownerKey: createEditorSessionOwnerKey("workspace-a", canonicalRoot),
            rootPath: selectedRoot,
            workspaceId: "workspace-a",
          },
          injectedResolver("workspace-a", selectedRoot, canonicalRoot, "/virtual/a/"),
          {
            [path]: document,
            [transientPath]: transientDocument,
          },
        ),
      ).toBe(true);
    });

    expect(harness.session().resolveDocumentSessionLifecycleAuthority(path)).not.toBeNull();
    expect(harness.session().resolveDocumentSessionLifecycleAuthority(transientPath)).toBeNull();
    expect(harness.session().documents[transientPath]).toBe(transientDocument);

    const lifecycle = harness.session().resolveDocumentSessionLifecycleAuthority(path)!;
    act(() => {
      harness.session().deactivateDocumentSessionAuthority();
    });
    expect(harness.session().isDocumentSessionLifecycleAuthorityCurrent(lifecycle)).toBe(false);
    expect(harness.session().documents[path]).toBe(document);
    harness.unmount();
  });

  it("keeps unknown non-file surfaces outside lifecycle authority without scanning them", () => {
    const harness = renderEditorSessionState();
    const canonicalRoot = "/canonical/a";
    const selectedRoot = "/selected/a";
    const documents = {
      "": { ...DOCUMENT_A, path: "" },
      "relative.ts": { ...DOCUMENT_B, path: "relative.ts" },
      "unknown-surface:panel": {
        ...DOCUMENT_C,
        path: "unknown-surface:panel",
      },
    };
    let scans = 0;

    act(() => {
      expect(
        harness.session().activateDocumentSessionAuthority(
          {
            canonicalRoot,
            ownerKey: createEditorSessionOwnerKey("workspace-a", canonicalRoot),
            rootPath: selectedRoot,
            workspaceId: "workspace-a",
          },
          () => {
            scans += 1;
            throw new Error("non-file paths must not be resolved");
          },
          documents,
        ),
      ).toBe(true);
    });

    expect(scans).toBe(0);
    for (const path of Object.keys(documents)) {
      expect(harness.session().resolveDocumentSessionLifecycleAuthority(path)).toBeNull();
    }
    harness.unmount();
  });

  it("normalizes dirty lifecycle records so explicit close needs no fabricated discard", () => {
    const harness = renderEditorSessionState();
    const canonicalRoot = "/canonical/a";
    const selectedRoot = "/selected/a";
    const path = "/virtual/a/src/a.ts";
    const dirtyDocument = {
      ...DOCUMENT_A,
      content: "dirty",
      path,
      savedContent: "clean",
    };

    act(() => {
      const session = harness.session();
      expect(
        session.activateDocumentSessionAuthority(
          {
            canonicalRoot,
            ownerKey: createEditorSessionOwnerKey("workspace-a", canonicalRoot),
            rootPath: selectedRoot,
            workspaceId: "workspace-a",
          },
          injectedResolver("workspace-a", selectedRoot, canonicalRoot, "/virtual/a/"),
          { [path]: dirtyDocument },
        ),
      ).toBe(true);
      session.setDocuments({ [path]: dirtyDocument });
      session.updateEditorGroups(() =>
        createInitialEditorGroupsState("editor-main", {
          activePath: path,
          openPaths: [path],
          previewPath: null,
        }),
      );
    });
    const lifecycle = harness.session().resolveDocumentSessionLifecycleAuthority(path)!;

    act(() => {
      harness.session().documentTabSession.removeDocument(path);
    });

    expect(harness.session().isDocumentSessionLifecycleAuthorityCurrent(lifecycle)).toBe(false);
    expect(harness.session().resolveDocumentSessionLifecycleAuthority(path)).toBeNull();
    harness.unmount();
  });

  it("does no canonical projection scans during 100 legacy content edits", () => {
    const harness = renderEditorSessionState();
    const canonicalRoot = "/canonical/a";
    const selectedRoot = "/selected/a";
    const path = "/virtual/a/src/a.ts";
    const document = { ...DOCUMENT_A, path };
    let canonicalScans = 0;
    const resolver = (rootPath: string, candidate: string) => {
      canonicalScans += 1;
      return injectedResolver(
        "workspace-a",
        selectedRoot,
        canonicalRoot,
        "/virtual/a/",
      )(rootPath, candidate);
    };

    act(() => {
      expect(
        harness.session().activateDocumentSessionAuthority(
          {
            canonicalRoot,
            ownerKey: createEditorSessionOwnerKey("workspace-a", canonicalRoot),
            rootPath: selectedRoot,
            workspaceId: "workspace-a",
          },
          resolver,
          { [path]: document },
        ),
      ).toBe(true);
      harness.session().setDocuments({ [path]: document });
    });
    const scansAfterActivation = canonicalScans;
    const revisionAfterActivation = harness.session().documentSessionAuthorityRevision;

    act(() => {
      for (let index = 0; index < 100; index += 1) {
        harness.session().setDocuments((current) => ({
          ...current,
          [path]: {
            ...current[path],
            content: `edit ${index}`,
          },
        }));
      }
    });

    expect(scansAfterActivation).toBeGreaterThan(0);
    expect(canonicalScans).toBe(scansAfterActivation);
    expect(harness.session().documentSessionAuthorityRevision).toBe(revisionAfterActivation);
    expect(harness.session().resolveDocumentSessionLifecycleAuthority(path)).not.toBeNull();
    harness.unmount();
  });

  it("reconciles explicit document-key topology changes without leaving old authority live", () => {
    const harness = renderEditorSessionState();
    const canonicalRoot = "/canonical/a";
    const selectedRoot = "/selected/a";
    const oldPath = "/virtual/a/src/old.ts";
    const nextPath = "/virtual/a/src/next.ts";
    const oldDocument = { ...DOCUMENT_A, path: oldPath };
    const nextDocument = { ...oldDocument, name: "next.ts", path: nextPath };

    act(() => {
      const session = harness.session();
      expect(
        session.activateDocumentSessionAuthority(
          {
            canonicalRoot,
            ownerKey: createEditorSessionOwnerKey("workspace-a", canonicalRoot),
            rootPath: selectedRoot,
            workspaceId: "workspace-a",
          },
          injectedResolver("workspace-a", selectedRoot, canonicalRoot, "/virtual/a/"),
          { [oldPath]: oldDocument },
        ),
      ).toBe(true);
      session.updateEditorGroups(() =>
        createInitialEditorGroupsState("editor-main", {
          activePath: oldPath,
          openPaths: [oldPath],
          previewPath: null,
        }),
      );
    });
    const oldLifecycle = harness.session().resolveDocumentSessionLifecycleAuthority(oldPath)!;
    const oldGroup = harness.session().resolveActiveDocumentSessionAuthority()!;
    const revisionBefore = harness.session().documentSessionAuthorityRevision;

    act(() => {
      expect(harness.session().reconcileDocumentSessionTopology({ [nextPath]: nextDocument })).toBe(
        true,
      );
    });

    expect(harness.session().resolveDocumentSessionLifecycleAuthority(oldPath)).toBeNull();
    expect(harness.session().isDocumentSessionLifecycleAuthorityCurrent(oldLifecycle)).toBe(false);
    expect(harness.session().isEditorGroupDocumentSessionAuthorityCurrent(oldGroup)).toBe(false);
    expect(harness.session().resolveDocumentSessionLifecycleAuthority(nextPath)).not.toBeNull();
    expect(harness.session().documentSessionAuthorityRevision).not.toBe(revisionBefore);
    harness.unmount();
  });

  it("keeps 100 live checkpoints outside React state and isolates joined model holders", () => {
    const harness = renderEditorSessionState();
    const canonicalRoot = "/canonical/a";
    const selectedRoot = "/selected/a";
    const path = "/virtual/a/src/a.ts";
    const document = {
      ...DOCUMENT_A,
      content: "saved",
      path,
      savedContent: "saved",
    };
    const groupIds = ["editor-main", "editor-1", "editor-2", "editor-3"] as const;

    act(() => {
      const session = harness.session();
      expect(
        session.activateDocumentSessionAuthority(
          {
            canonicalRoot,
            ownerKey: createEditorSessionOwnerKey("workspace-a", canonicalRoot),
            rootPath: selectedRoot,
            workspaceId: "workspace-a",
          },
          injectedResolver("workspace-a", selectedRoot, canonicalRoot, "/virtual/a/"),
          { [path]: document },
        ),
      ).toBe(true);
      session.updateEditorGroups(() => ({
        activeGroupId: "editor-main",
        groups: Object.fromEntries(
          groupIds.map((groupId) => [
            groupId,
            { activePath: path, openPaths: [path], previewPath: null },
          ]),
        ),
        layout: { groupId: "editor-main", kind: "group" },
      }));
    });

    const authorities = groupIds.map((groupId) =>
      harness.session().resolveEditorGroupDocumentSessionAuthority(groupId)!,
    );
    const modelIncarnation = Object.freeze({});
    const attachments = authorities.map((authority) =>
      harness.session().attachEditorGroupLiveDocument(
        authority,
        {
          captureCurrentContent: () => "saved",
          holderIncarnation: Object.freeze({}),
          modelIncarnation,
        },
        liveRevision(1),
      ),
    );
    expect(attachments.every(Boolean)).toBe(true);

    const documentsBefore = harness.session().documentsRef.current;
    const authorityRevisionBefore = harness.session().documentSessionAuthorityRevision;
    const rendersBefore = harness.renderCount();
    act(() => {
      for (let index = 2; index <= 101; index += 1) {
        expect(attachments[0]?.observe(liveRevision(index))).toBe(true);
      }
    });

    expect(harness.session().documentsRef.current).toBe(documentsBefore);
    expect(harness.session().documentSessionAuthorityRevision).toBe(authorityRevisionBefore);
    expect(harness.renderCount()).toBe(rendersBefore);

    expect(attachments[0]?.release()).toBe(true);
    expect(attachments[1]?.observe(liveRevision(102))).toBe(true);

    const replacement = harness.session().attachEditorGroupLiveDocument(
      authorities[1],
      {
        captureCurrentContent: () => "x".repeat(107),
        holderIncarnation: Object.freeze({}),
        modelIncarnation: Object.freeze({}),
      },
      liveRevision(102),
    );
    expect(replacement).not.toBeNull();
    expect(attachments[1]?.observe(liveRevision(103))).toBe(false);
    expect(replacement?.observe(liveRevision(103))).toBe(true);
    expect(attachments[2]?.release()).toBe(true);
    expect(replacement?.release()).toBe(true);
    harness.unmount();
  });

  it("coalesces exact aliases and rejects divergent alias collisions", () => {
    const harness = renderEditorSessionState();
    const canonicalRoot = "/canonical/a";
    const selectedRoot = "/selected/a";
    const aliasA = "/virtual/a/src/File.ts";
    const aliasB = "/virtual/a/src/file.ts";
    const unrelatedPath = "/virtual/a/src/other.ts";
    const common = { ...DOCUMENT_A, content: "same", savedContent: "same" };
    const documents = {
      [aliasA]: { ...common, path: aliasA },
      [aliasB]: { ...common, path: aliasB },
      [unrelatedPath]: { ...DOCUMENT_B, path: unrelatedPath },
    };
    const resolver = (rootPath: string, path: string) => {
      if (rootPath !== selectedRoot || !path.startsWith("/virtual/a/")) return null;
      const relative = path.slice("/virtual/a/".length).toLowerCase();
      return createRegisteredDocumentSaveIdentity("workspace-a", canonicalRoot, relative);
    };
    const owner = {
      canonicalRoot,
      ownerKey: createEditorSessionOwnerKey("workspace-a", canonicalRoot),
      rootPath: selectedRoot,
      workspaceId: "workspace-a",
    };

    act(() => {
      expect(harness.session().activateDocumentSessionAuthority(owner, resolver, documents)).toBe(
        true,
      );
      harness.session().setDocuments(documents);
      harness.session().updateEditorGroups(() =>
        createInitialEditorGroupsState("editor-main", {
          activePath: aliasA,
          openPaths: [aliasA, aliasB],
          previewPath: null,
        }),
      );
    });
    const authorityA = harness.session().resolveDocumentSessionLifecycleAuthority(aliasA);
    const authorityB = harness.session().resolveDocumentSessionLifecycleAuthority(aliasB);
    expect(authorityA?.identity).not.toBe(authorityB?.identity);
    expect(
      harness.session().resolveDocumentSessionLifecycleAuthority(unrelatedPath),
    ).not.toBeNull();

    act(() => {
      harness.session().documentTabSession.removeDocument(aliasA);
    });
    const aliasBAfterPrimaryClose = harness
      .session()
      .resolveDocumentSessionLifecycleAuthority(aliasB);
    expect(aliasBAfterPrimaryClose?.identity).toBe(authorityB?.identity);

    act(() => {
      harness.session().documentTabSession.commitTextOpen({
        document: documents[aliasA],
        pin: true,
      });
    });
    expect(harness.session().resolveDocumentSessionLifecycleAuthority(aliasA)?.identity).not.toBe(
      authorityA?.identity,
    );
    expect(harness.session().resolveDocumentSessionLifecycleAuthority(aliasB)?.identity).toBe(
      authorityB?.identity,
    );

    act(() => {
      harness.session().documentTabSession.removeDocument(aliasA);
      harness.session().documentTabSession.removeDocument(aliasB);
    });
    expect(
      harness.session().isDocumentSessionLifecycleAuthorityCurrent(aliasBAfterPrimaryClose!),
    ).toBe(false);
    expect(harness.session().resolveDocumentSessionLifecycleAuthority(aliasB)).toBeNull();
    expect(
      harness.session().resolveDocumentSessionLifecycleAuthority(unrelatedPath),
    ).not.toBeNull();

    act(() => {
      harness.session().deactivateDocumentSessionAuthority();
      expect(
        harness.session().activateDocumentSessionAuthority(owner, resolver, {
          ...documents,
          [aliasB]: { ...documents[aliasB], content: "diverged" },
        }),
      ).toBe(false);
    });
    expect(harness.session().resolveDocumentSessionLifecycleAuthority(aliasA)).toBeNull();
    expect(harness.session().resolveDocumentSessionLifecycleAuthority(aliasB)).toBeNull();
    expect(harness.session().resolveDocumentSessionLifecycleAuthority(unrelatedPath)).toBeNull();
    harness.unmount();
  });

  it("publishes exact changed-document batches without replaying them", () => {
    const harness = renderEditorSessionState();
    const received: string[][] = [];
    const unsubscribe = harness.session().subscribeChangedDocuments((paths) => {
      received.push([...paths]);
    });

    act(() => {
      harness.session().reportChangedDocuments([DOCUMENT_A.path, DOCUMENT_B.path, DOCUMENT_A.path]);
    });

    expect(received).toEqual([[DOCUMENT_A.path, DOCUMENT_B.path]]);
    unsubscribe();

    act(() => {
      harness.session().reportChangedDocuments([DOCUMENT_C.path]);
    });

    expect(received).toHaveLength(1);
    harness.unmount();
  });

  it("commits a text preview and replaces only the clean active preview", () => {
    const harness = renderEditorSessionState();
    let replaced: EditorDocument | null = null;

    act(() => {
      const session = harness.session();
      session.setDocuments({
        [DOCUMENT_B.path]: DOCUMENT_B,
      });
      session.updateEditorGroups(() =>
        createInitialEditorGroupsState("editor-main", {
          activePath: DOCUMENT_B.path,
          openPaths: [],
          previewPath: DOCUMENT_B.path,
        }),
      );

      replaced = session.documentTabSession.commitTextOpen({
        document: DOCUMENT_A,
        pin: false,
      }).replacedDocument;

      expect(replaced).toBe(DOCUMENT_B);
      expect(session.documentsRef.current).toEqual({
        [DOCUMENT_A.path]: DOCUMENT_A,
      });
      expect(session.editorGroupsRef.current.groups["editor-main"]).toEqual({
        activePath: DOCUMENT_A.path,
        openPaths: [],
        previewPath: DOCUMENT_A.path,
      });
      expect(session.activeDocumentRef.current).toBe(DOCUMENT_A);
      expect(session.openPathsRef.current).toEqual([]);
      expect(session.previewPathRef.current).toBe(DOCUMENT_A.path);
    });

    expect(harness.session().documents).toEqual({
      [DOCUMENT_A.path]: DOCUMENT_A,
    });
    expect(harness.session().activePath).toBe(DOCUMENT_A.path);
    harness.unmount();
  });

  it("preserves dirty previews and documents visible in another group", () => {
    const harness = renderEditorSessionState();
    const dirtyPreview = { ...DOCUMENT_B, content: "changed" };
    let groups = createInitialEditorGroupsState("editor-main", {
      activePath: dirtyPreview.path,
      openPaths: [],
      previewPath: dirtyPreview.path,
    });
    groups = editorGroupsReducer(groups, {
      direction: "right",
      newGroupId: "editor-1",
      type: "split-group",
    });
    groups = {
      ...groups,
      activeGroupId: "editor-main",
      groups: {
        ...groups.groups,
        "editor-1": {
          activePath: dirtyPreview.path,
          openPaths: [dirtyPreview.path],
          previewPath: null,
        },
      },
    };

    act(() => {
      const session = harness.session();
      session.setDocuments({ [dirtyPreview.path]: dirtyPreview });
      session.updateEditorGroups(() => groups);

      const dirtyResult = session.documentTabSession.commitTextOpen({
        document: DOCUMENT_A,
        pin: false,
      });

      expect(dirtyResult.replacedDocument).toBeNull();
      expect(session.documentsRef.current[dirtyPreview.path]).toBe(dirtyPreview);
      expect(session.editorGroupsRef.current.groups["editor-main"].openPaths).toContain(
        dirtyPreview.path,
      );
      expect(session.editorGroupsRef.current.groups["editor-1"]).toEqual(groups.groups["editor-1"]);
    });

    act(() => {
      const session = harness.session();
      const cleanPreview = {
        ...dirtyPreview,
        content: dirtyPreview.savedContent,
      };
      session.setDocuments({
        [DOCUMENT_A.path]: DOCUMENT_A,
        [cleanPreview.path]: cleanPreview,
      });
      session.updateEditorGroups((current) => ({
        ...current,
        activeGroupId: "editor-main",
        groups: {
          ...current.groups,
          "editor-main": {
            activePath: cleanPreview.path,
            openPaths: [],
            previewPath: cleanPreview.path,
          },
        },
      }));

      const sharedResult = session.documentTabSession.commitTextOpen({
        document: DOCUMENT_A,
        pin: true,
      });

      expect(sharedResult.replacedDocument).toBeNull();
      expect(session.documentsRef.current[cleanPreview.path]).toBe(cleanPreview);
      expect(session.editorGroupsRef.current.groups["editor-1"].openPaths).toEqual([
        cleanPreview.path,
      ]);
    });

    harness.unmount();
  });

  it("commits image, activation, and pinning to the active group atomically", () => {
    const harness = renderEditorSessionState();
    let groups = createInitialEditorGroupsState("editor-main", {
      activePath: DOCUMENT_A.path,
      openPaths: [DOCUMENT_A.path],
      previewPath: null,
    });
    groups = editorGroupsReducer(groups, {
      direction: "right",
      newGroupId: "editor-1",
      type: "split-group",
    });

    act(() => {
      const session = harness.session();
      session.setDocuments({ [DOCUMENT_A.path]: DOCUMENT_A });
      session.updateEditorGroups(() => groups);
      session.documentTabSession.commitImageOpen(IMAGE);

      expect(session.imageTabsRef.current).toEqual({ [IMAGE.path]: IMAGE });
      expect(session.activeDocumentRef.current).toBeNull();
      expect(session.editorGroupsRef.current.groups["editor-main"]).toEqual(
        groups.groups["editor-main"],
      );
      expect(session.editorGroupsRef.current.groups["editor-1"]).toEqual({
        activePath: IMAGE.path,
        openPaths: [DOCUMENT_A.path, IMAGE.path],
        previewPath: null,
      });

      session.documentTabSession.activate(DOCUMENT_A.path);
      session.documentTabSession.pin(DOCUMENT_A.path);
      expect(session.activeDocumentRef.current).toBe(DOCUMENT_A);
      expect(session.openPathsRef.current).toEqual([DOCUMENT_A.path, IMAGE.path]);
      expect(session.editorGroupsRef.current.groups["editor-main"]).toEqual(
        groups.groups["editor-main"],
      );
    });

    expect(harness.session().activePath).toBe(DOCUMENT_A.path);
    expect(harness.session().imageTabs).toEqual({ [IMAGE.path]: IMAGE });
    harness.unmount();
  });

  it("removes a displaced clean text preview only after its last group membership", () => {
    const harness = renderEditorSessionState();
    const cleanPreview = {
      ...DOCUMENT_A,
      content: DOCUMENT_A.savedContent,
    };
    let groups = createInitialEditorGroupsState("editor-main", {
      activePath: cleanPreview.path,
      openPaths: [],
      previewPath: cleanPreview.path,
    });

    act(() => {
      const session = harness.session();
      session.setDocuments({ [cleanPreview.path]: cleanPreview });
      session.updateEditorGroups(() => groups);

      const result = session.documentTabSession.commitImageOpen(IMAGE);

      expect(result.replacedDocument).toBe(cleanPreview);
      expect(session.documentsRef.current[cleanPreview.path]).toBeUndefined();
      expect(session.editorGroupsRef.current.groups["editor-main"]).toEqual({
        activePath: IMAGE.path,
        openPaths: [IMAGE.path],
        previewPath: null,
      });
    });

    groups = editorGroupsReducer(groups, {
      direction: "right",
      newGroupId: "editor-1",
      type: "split-group",
    });
    groups = {
      ...groups,
      activeGroupId: "editor-main",
      groups: {
        ...groups.groups,
        "editor-1": {
          activePath: cleanPreview.path,
          openPaths: [cleanPreview.path],
          previewPath: null,
        },
      },
    };

    act(() => {
      const session = harness.session();
      session.setDocuments({ [cleanPreview.path]: cleanPreview });
      session.updateEditorGroups(() => groups);

      const result = session.documentTabSession.commitImageOpen(IMAGE);

      expect(result.replacedDocument).toBeNull();
      expect(session.documentsRef.current[cleanPreview.path]).toBe(cleanPreview);
      expect(session.editorGroupsRef.current.groups["editor-1"]).toEqual(groups.groups["editor-1"]);
    });

    harness.unmount();
  });

  it.each([
    {
      group: {
        activePath: DOCUMENT_A.path,
        openPaths: [DOCUMENT_B.path, DOCUMENT_A.path],
        previewPath: null,
      },
      label: "pinned",
    },
    {
      group: {
        activePath: DOCUMENT_A.path,
        openPaths: [DOCUMENT_B.path],
        previewPath: DOCUMENT_A.path,
      },
      label: "preview",
    },
  ])("globally removes an active $label document", ({ group }) => {
    const harness = renderEditorSessionState();
    let result: ReturnType<EditorSessionState["documentTabSession"]["removeDocument"]>;

    act(() => {
      const session = harness.session();
      session.setDocuments({
        [DOCUMENT_A.path]: DOCUMENT_A,
        [DOCUMENT_B.path]: DOCUMENT_B,
      });
      session.setImageTabs({ [IMAGE.path]: IMAGE });
      session.updateEditorGroups(() => createInitialEditorGroupsState("editor-main", group));

      result = session.documentTabSession.removeDocument(DOCUMENT_A.path);

      expect(result).toEqual({
        closedActiveDocument: true,
        nextActivePath: DOCUMENT_B.path,
        removedDocument: DOCUMENT_A,
      });
      expect(session.documentsRef.current).toEqual({
        [DOCUMENT_B.path]: DOCUMENT_B,
      });
      expect(session.imageTabsRef.current).toEqual({ [IMAGE.path]: IMAGE });
      expect(session.editorGroupsRef.current.groups["editor-main"]).toEqual({
        activePath: DOCUMENT_B.path,
        openPaths: [DOCUMENT_B.path],
        previewPath: null,
      });
      expect(session.activeDocumentRef.current).toBe(DOCUMENT_B);
    });

    expect(harness.session().activePath).toBe(DOCUMENT_B.path);
    harness.unmount();
  });

  it("removes a non-active document without changing the active tab", () => {
    const harness = renderEditorSessionState();

    act(() => {
      const session = harness.session();
      session.setDocuments({
        [DOCUMENT_A.path]: DOCUMENT_A,
        [DOCUMENT_B.path]: DOCUMENT_B,
      });
      session.updateEditorGroups(() =>
        createInitialEditorGroupsState("editor-main", {
          activePath: DOCUMENT_B.path,
          openPaths: [DOCUMENT_A.path, DOCUMENT_B.path],
          previewPath: null,
        }),
      );

      expect(session.documentTabSession.removeDocument(DOCUMENT_A.path)).toEqual({
        closedActiveDocument: false,
        nextActivePath: DOCUMENT_B.path,
        removedDocument: DOCUMENT_A,
      });
      expect(session.editorGroupsRef.current.groups["editor-main"]).toEqual({
        activePath: DOCUMENT_B.path,
        openPaths: [DOCUMENT_B.path],
        previewPath: null,
      });
    });

    harness.unmount();
  });

  it("removes dirty documents after caller confirmation and uses ordinary fallback", () => {
    const harness = renderEditorSessionState();

    act(() => {
      const session = harness.session();
      session.setDocuments({
        [DOCUMENT_A.path]: DOCUMENT_A,
        [DOCUMENT_B.path]: DOCUMENT_B,
      });
      session.updateEditorGroups(() =>
        createInitialEditorGroupsState("editor-main", {
          activePath: DOCUMENT_A.path,
          openPaths: [DOCUMENT_B.path, DOCUMENT_A.path],
          previewPath: null,
        }),
      );

      const result = session.documentTabSession.removeDocument(DOCUMENT_A.path);

      expect(result.removedDocument).toBe(DOCUMENT_A);
      expect(result.nextActivePath).toBe(DOCUMENT_B.path);
      expect(session.documentsRef.current[DOCUMENT_A.path]).toBeUndefined();
    });

    harness.unmount();
  });

  it("closes a document in every group with independent fallbacks", () => {
    const harness = renderEditorSessionState();
    let groups = createInitialEditorGroupsState("editor-main", {
      activePath: DOCUMENT_A.path,
      openPaths: [DOCUMENT_B.path, DOCUMENT_A.path],
      previewPath: null,
    });
    groups = editorGroupsReducer(groups, {
      direction: "right",
      newGroupId: "editor-1",
      type: "split-group",
    });
    groups = {
      ...groups,
      activeGroupId: "editor-main",
      groups: {
        ...groups.groups,
        "editor-1": {
          activePath: DOCUMENT_A.path,
          openPaths: [DOCUMENT_C.path, DOCUMENT_A.path],
          previewPath: null,
        },
      },
    };

    act(() => {
      const session = harness.session();
      session.setDocuments({
        [DOCUMENT_A.path]: DOCUMENT_A,
        [DOCUMENT_B.path]: DOCUMENT_B,
        [DOCUMENT_C.path]: DOCUMENT_C,
      });
      session.updateEditorGroups(() => groups);

      const result = session.documentTabSession.removeDocument(DOCUMENT_A.path);

      expect(result.nextActivePath).toBe(DOCUMENT_B.path);
      expect(session.editorGroupsRef.current.layout).toBe(groups.layout);
      expect(session.editorGroupsRef.current.groups).toEqual({
        "editor-main": {
          activePath: DOCUMENT_B.path,
          openPaths: [DOCUMENT_B.path],
          previewPath: null,
        },
        "editor-1": {
          activePath: DOCUMENT_C.path,
          openPaths: [DOCUMENT_C.path],
          previewPath: null,
        },
      });
    });

    harness.unmount();
  });

  it("preserves an unrelated preview and falls back to it", () => {
    const harness = renderEditorSessionState();

    act(() => {
      const session = harness.session();
      session.setDocuments({
        [DOCUMENT_A.path]: DOCUMENT_A,
        [DOCUMENT_B.path]: DOCUMENT_B,
      });
      session.updateEditorGroups(() =>
        createInitialEditorGroupsState("editor-main", {
          activePath: DOCUMENT_A.path,
          openPaths: [DOCUMENT_A.path],
          previewPath: DOCUMENT_B.path,
        }),
      );

      const result = session.documentTabSession.removeDocument(DOCUMENT_A.path);

      expect(result.nextActivePath).toBe(DOCUMENT_B.path);
      expect(session.editorGroupsRef.current.groups["editor-main"]).toEqual({
        activePath: DOCUMENT_B.path,
        openPaths: [],
        previewPath: DOCUMENT_B.path,
      });
      expect(session.documentsRef.current[DOCUMENT_B.path]).toBe(DOCUMENT_B);
    });

    harness.unmount();
  });

  it("no-ops for missing paths and globally removes foreign documents", () => {
    const harness = renderEditorSessionState();

    act(() => {
      const session = harness.session();
      session.setDocuments({
        [DOCUMENT_B.path]: DOCUMENT_B,
        [FOREIGN_DOCUMENT.path]: FOREIGN_DOCUMENT,
      });
      session.updateEditorGroups(() =>
        createInitialEditorGroupsState("editor-main", {
          activePath: DOCUMENT_B.path,
          openPaths: [DOCUMENT_B.path, FOREIGN_DOCUMENT.path],
          previewPath: null,
        }),
      );
      const documentsBeforeMissing = session.documentsRef.current;
      const groupsBeforeMissing = session.editorGroupsRef.current;

      expect(session.documentTabSession.removeDocument("/workspace/missing.ts")).toEqual({
        closedActiveDocument: false,
        nextActivePath: DOCUMENT_B.path,
        removedDocument: null,
      });
      expect(session.documentsRef.current).toBe(documentsBeforeMissing);
      expect(session.editorGroupsRef.current).toBe(groupsBeforeMissing);

      expect(session.documentTabSession.removeDocument(FOREIGN_DOCUMENT.path)).toEqual({
        closedActiveDocument: false,
        nextActivePath: DOCUMENT_B.path,
        removedDocument: FOREIGN_DOCUMENT,
      });
      expect(session.documentsRef.current).toEqual({
        [DOCUMENT_B.path]: DOCUMENT_B,
      });
      expect(session.openPathsRef.current).toEqual([DOCUMENT_B.path]);
    });

    harness.unmount();
  });

  it("refreshes only a still-clean empty document and keeps active refs current", () => {
    const harness = renderEditorSessionState();
    const emptyDocument = {
      ...DOCUMENT_B,
      content: "",
      savedContent: "",
    };

    act(() => {
      const session = harness.session();
      session.setDocuments({ [emptyDocument.path]: emptyDocument });
      session.updateEditorGroups(() =>
        createInitialEditorGroupsState("editor-main", {
          activePath: emptyDocument.path,
          openPaths: [emptyDocument.path],
          previewPath: null,
        }),
      );

      const refreshed = session.documentTabSession.refreshCleanDocument(
        emptyDocument.path,
        "fresh",
      );
      expect(refreshed?.content).toBe("fresh");
      expect(session.documentsRef.current[emptyDocument.path]).toBe(refreshed);
      expect(session.activeDocumentRef.current).toBe(refreshed);

      session.setDocuments((current) => ({
        ...current,
        [emptyDocument.path]: {
          ...current[emptyDocument.path],
          content: "dirty",
        },
      }));
      expect(
        session.documentTabSession.refreshCleanDocument(emptyDocument.path, "must-not-win"),
      ).toBeNull();
      expect(session.documentsRef.current[emptyDocument.path].content).toBe("dirty");
    });

    harness.unmount();
  });

  it("opens read-only documents as pinned or preview tabs", () => {
    const harness = renderEditorSessionState();
    const readOnlyDocument = {
      ...DOCUMENT_B,
      savedContent: undefined,
    } as unknown as EditorDocument;

    act(() => {
      const session = harness.session();
      session.documentTabSession.openReadOnlyDocument(readOnlyDocument, false);
      expect(session.documentsRef.current[DOCUMENT_B.path]).toMatchObject({
        content: DOCUMENT_B.content,
        readOnly: true,
        savedContent: DOCUMENT_B.content,
      });
      expect(session.previewPathRef.current).toBe(DOCUMENT_B.path);

      session.documentTabSession.openReadOnlyDocument(readOnlyDocument, true);
      expect(session.openPathsRef.current).toContain(DOCUMENT_B.path);
      expect(session.previewPathRef.current).toBeNull();
      expect(session.activeDocumentRef.current?.readOnly).toBe(true);
    });

    expect(harness.session().openPaths).toContain(DOCUMENT_B.path);
    expect(harness.session().previewPath).toBeNull();
    harness.unmount();
  });

  it("preserves an unrelated preview when opening a new pinned read-only document", () => {
    const harness = renderEditorSessionState();
    const readOnlyDocument = { ...DOCUMENT_B, readOnly: true };

    act(() => {
      const session = harness.session();
      session.setDocuments({ [DOCUMENT_A.path]: DOCUMENT_A });
      session.updateEditorGroups(() =>
        createInitialEditorGroupsState("editor-main", {
          activePath: DOCUMENT_A.path,
          openPaths: [],
          previewPath: DOCUMENT_A.path,
        }),
      );

      session.documentTabSession.openReadOnlyDocument(readOnlyDocument, true);

      expect(session.editorGroupsRef.current.groups["editor-main"]).toEqual({
        activePath: DOCUMENT_B.path,
        openPaths: [DOCUMENT_B.path],
        previewPath: DOCUMENT_A.path,
      });
      expect(session.documentsRef.current).toEqual({
        [DOCUMENT_A.path]: DOCUMENT_A,
        [DOCUMENT_B.path]: readOnlyDocument,
      });

      session.documentTabSession.openReadOnlyDocument(DOCUMENT_A, true);
      expect(session.previewPathRef.current).toBeNull();
      expect(session.openPathsRef.current).toEqual([DOCUMENT_B.path, DOCUMENT_A.path]);
    });

    harness.unmount();
  });

  it("safely replaces read-only previews without orphaning dirty documents", () => {
    const harness = renderEditorSessionState();
    const dirtyPreview = { ...DOCUMENT_A, content: "unsaved" };
    const readOnlyDocument = { ...DOCUMENT_B, readOnly: true };

    act(() => {
      const session = harness.session();
      session.setDocuments({ [dirtyPreview.path]: dirtyPreview });
      session.updateEditorGroups(() =>
        createInitialEditorGroupsState("editor-main", {
          activePath: dirtyPreview.path,
          openPaths: [],
          previewPath: dirtyPreview.path,
        }),
      );

      const dirtyTransition = session.documentTabSession.openReadOnlyDocument(
        readOnlyDocument,
        false,
      );

      expect(dirtyTransition.replacedDocument).toBeNull();
      expect(session.documentsRef.current[dirtyPreview.path]).toBe(dirtyPreview);
      expect(session.openPathsRef.current).toEqual([dirtyPreview.path]);
      expect(session.previewPathRef.current).toBe(readOnlyDocument.path);

      const nextReadOnly = {
        ...DOCUMENT_A,
        path: "/workspace/read-only-next.ts",
        readOnly: true,
      };
      const cleanTransition = session.documentTabSession.openReadOnlyDocument(nextReadOnly, false);

      expect(cleanTransition.replacedDocument).toEqual(readOnlyDocument);
      expect(session.documentsRef.current[readOnlyDocument.path]).toBeUndefined();
      expect(session.documentsRef.current[dirtyPreview.path]).toBe(dirtyPreview);
      expect(session.previewPathRef.current).toBe(nextReadOnly.path);
    });

    harness.unmount();
  });

  it("preserves an unrelated preview when pinning an existing document", () => {
    const harness = renderEditorSessionState();

    act(() => {
      const session = harness.session();
      session.setDocuments({
        [DOCUMENT_A.path]: DOCUMENT_A,
        [DOCUMENT_B.path]: DOCUMENT_B,
      });
      session.updateEditorGroups(() =>
        createInitialEditorGroupsState("editor-main", {
          activePath: DOCUMENT_A.path,
          openPaths: [],
          previewPath: DOCUMENT_A.path,
        }),
      );

      const transition = session.documentTabSession.openExistingDocument({
        path: DOCUMENT_B.path,
        pin: true,
        readOnly: false,
      });

      expect(transition?.replacedDocument).toBeNull();
      expect(session.editorGroupsRef.current.groups["editor-main"]).toEqual({
        activePath: DOCUMENT_B.path,
        openPaths: [DOCUMENT_B.path],
        previewPath: DOCUMENT_A.path,
      });
      expect(session.documentsRef.current[DOCUMENT_A.path]).toBe(DOCUMENT_A);
    });

    harness.unmount();
  });

  it("returns detached readonly snapshots that cannot alias live state", () => {
    const harness = renderEditorSessionState();

    act(() => {
      const session = harness.session();
      session.setDocuments({ [DOCUMENT_A.path]: DOCUMENT_A });
      session.updateEditorGroups(() =>
        createInitialEditorGroupsState("editor-main", {
          activePath: DOCUMENT_A.path,
          openPaths: [DOCUMENT_A.path],
          previewPath: null,
        }),
      );
    });

    const snapshot = harness.session().documentTabSession.snapshot();
    const mutableDocuments = snapshot.documents as Record<string, EditorDocument>;
    const mutableOpenPaths = snapshot.openPaths as string[];
    mutableDocuments[DOCUMENT_A.path].content = "mutated snapshot";
    mutableOpenPaths.push("/workspace/injected.ts");

    const liveSnapshot = harness.session().documentTabSession.snapshot();
    expect(liveSnapshot.documents[DOCUMENT_A.path].content).toBe(DOCUMENT_A.content);
    expect(liveSnapshot.openPaths).toEqual([DOCUMENT_A.path]);
    harness.unmount();
  });

  it("queries the live active path, document, and tab display name in constant time", () => {
    const harness = renderEditorSessionState();

    act(() => {
      const session = harness.session();
      session.setDocuments({ [DOCUMENT_A.path]: DOCUMENT_A });
      session.setImageTabs({ [IMAGE.path]: IMAGE });
      session.updateEditorGroups(() =>
        createInitialEditorGroupsState("editor-main", {
          activePath: DOCUMENT_A.path,
          openPaths: [DOCUMENT_A.path, IMAGE.path],
          previewPath: null,
        }),
      );

      expect(session.documentTabSession.getActivePath()).toBe(DOCUMENT_A.path);
      expect(session.documentTabSession.getDocument(DOCUMENT_A.path)).toBe(DOCUMENT_A);
      expect(session.documentTabSession.getDocument(IMAGE.path)).toBeNull();
      expect(session.documentTabSession.getTabDisplayName(DOCUMENT_A.path)).toBe(DOCUMENT_A.name);
      expect(session.documentTabSession.getTabDisplayName(IMAGE.path)).toBe(IMAGE.name);
      expect(session.documentTabSession.getTabDisplayName("/missing")).toBeNull();

      session.documentTabSession.activate(IMAGE.path);
      expect(session.documentTabSession.getActivePath()).toBe(IMAGE.path);
    });

    harness.unmount();
  });

  it("keeps detached snapshots isolated while live queries observe commits", () => {
    const harness = renderEditorSessionState();

    act(() => {
      harness.session().documentTabSession.commitTextOpen({
        document: DOCUMENT_A,
        pin: true,
      });
    });

    const port = harness.session().documentTabSession;
    const detached = port.snapshot();
    const mutableDetachedDocument = detached.documents[DOCUMENT_A.path] as EditorDocument;
    mutableDetachedDocument.name = "detached.ts";

    expect(port.getDocument(DOCUMENT_A.path)?.name).toBe(DOCUMENT_A.name);
    expect(port.getTabDisplayName(DOCUMENT_A.path)).toBe(DOCUMENT_A.name);

    act(() => {
      harness.session().setDocuments({
        [DOCUMENT_A.path]: { ...DOCUMENT_A, name: "renamed.ts" },
      });
    });

    expect(port.getDocument(DOCUMENT_A.path)?.name).toBe("renamed.ts");
    expect(port.getTabDisplayName(DOCUMENT_A.path)).toBe("renamed.ts");
    expect(detached.documents[DOCUMENT_A.path].name).toBe("detached.ts");
    harness.unmount();
  });

  it("opens an existing document with one-way read-only state and exposes its active view", () => {
    const harness = renderEditorSessionState();

    act(() => {
      const session = harness.session();
      session.setDocuments({
        [DOCUMENT_A.path]: DOCUMENT_A,
        [DOCUMENT_B.path]: { ...DOCUMENT_B, readOnly: true },
      });
      session.updateEditorGroups(() =>
        createInitialEditorGroupsState("editor-main", {
          activePath: DOCUMENT_A.path,
          openPaths: [DOCUMENT_A.path],
          previewPath: null,
        }),
      );

      const upgraded = session.documentTabSession.openExistingDocument({
        path: DOCUMENT_A.path,
        pin: true,
        readOnly: true,
      });
      expect(upgraded?.document.readOnly).toBe(true);

      const opened = session.documentTabSession.openExistingDocument({
        path: DOCUMENT_B.path,
        pin: false,
        readOnly: false,
      });

      expect(opened?.document.readOnly).toBe(true);
      expect(opened?.replacedDocument).toBeNull();
      expect(session.documentTabSession.snapshot()).toMatchObject({
        activeDocument: opened?.document,
        activePath: DOCUMENT_B.path,
        openPaths: [DOCUMENT_A.path],
        previewPath: DOCUMENT_B.path,
      });

      const pinned = session.documentTabSession.openExistingDocument({
        path: DOCUMENT_B.path,
        pin: true,
        readOnly: false,
      });
      expect(pinned?.document.readOnly).toBe(true);
      expect(session.openPathsRef.current).toEqual([DOCUMENT_A.path, DOCUMENT_B.path]);
      expect(session.previewPathRef.current).toBeNull();
      expect(
        session.documentTabSession.openExistingDocument({
          path: "/workspace/missing.ts",
          pin: false,
          readOnly: true,
        }),
      ).toBeNull();
    });

    expect(harness.session().documents[DOCUMENT_B.path].readOnly).toBe(true);
    expect(harness.session().activePath).toBe(DOCUMENT_B.path);
    harness.unmount();
  });

  it("synchronizes live refs in the same tick", () => {
    const harness = renderEditorSessionState();

    act(() => {
      const session = harness.session();
      session.setDocuments({ [DOCUMENT_A.path]: DOCUMENT_A });
      expect(session.documentsRef.current).toEqual({
        [DOCUMENT_A.path]: DOCUMENT_A,
      });

      session.setImageTabs({ [IMAGE.path]: IMAGE });
      expect(session.imageTabsRef.current).toEqual({ [IMAGE.path]: IMAGE });

      session.setMarkdownPreviewTabs({ [PREVIEW.path]: PREVIEW });
      expect(session.markdownPreviewTabsRef.current).toEqual({
        [PREVIEW.path]: PREVIEW,
      });

      session.setOpenPaths([DOCUMENT_A.path]);
      session.setActivePath(DOCUMENT_A.path);
      expect(session.openPathsRef.current).toEqual([DOCUMENT_A.path]);
      expect(session.editorGroupsRef.current.groups["editor-main"].activePath).toBe(
        DOCUMENT_A.path,
      );
      expect(session.activeDocumentRef.current).toBe(DOCUMENT_A);
    });

    harness.unmount();
  });

  it("routes compatibility setters to the currently active group", () => {
    const harness = renderEditorSessionState();
    let groups = createInitialEditorGroupsState("editor-main", {
      activePath: DOCUMENT_A.path,
      openPaths: [DOCUMENT_A.path],
      previewPath: null,
    });
    groups = editorGroupsReducer(groups, {
      direction: "right",
      newGroupId: "editor-1",
      type: "split-group",
    });

    act(() => {
      const session = harness.session();
      session.updateEditorGroups(() => groups);
      session.setOpenPaths([DOCUMENT_B.path]);
      session.setPreviewPath(PREVIEW.path);
      session.setActivePath(PREVIEW.path);
    });

    const current = harness.session().editorGroups;
    expect(current.groups["editor-main"]).toEqual({
      activePath: DOCUMENT_A.path,
      openPaths: [DOCUMENT_A.path],
      previewPath: null,
    });
    expect(current.groups["editor-1"]).toEqual({
      activePath: PREVIEW.path,
      openPaths: [DOCUMENT_B.path],
      previewPath: PREVIEW.path,
    });

    harness.unmount();
  });

  it("resets and restores a dirty document and preview membership snapshot", () => {
    const harness = renderEditorSessionState();
    const groups = createInitialEditorGroupsState("editor-main", {
      activePath: PREVIEW.path,
      openPaths: [DOCUMENT_A.path],
      previewPath: PREVIEW.path,
    });
    let snapshot: ReturnType<EditorSessionState["snapshotEditorSurface"]>;

    act(() => {
      const session = harness.session();
      session.setDocuments({ [DOCUMENT_A.path]: DOCUMENT_A });
      session.setMarkdownPreviewTabs({ [PREVIEW.path]: PREVIEW });
      session.updateEditorGroups(() => groups);
      snapshot = session.snapshotEditorSurface("/workspace");
      session.resetEditorSurfaceState();

      expect(session.documentsRef.current).toEqual({});
      expect(session.markdownPreviewTabsRef.current).toEqual({});
      expect(session.openPathsRef.current).toEqual([]);
      expect(session.previewPathRef.current).toBeNull();

      session.restoreEditorSurface("/workspace", snapshot);
    });

    const restored = harness.session();
    expect(restored.documents[DOCUMENT_A.path]).toEqual(DOCUMENT_A);
    expect(restored.documents[DOCUMENT_A.path].content).not.toBe(
      restored.documents[DOCUMENT_A.path].savedContent,
    );
    expect(restored.markdownPreviewTabs[PREVIEW.path]).toEqual(PREVIEW);
    expect(restored.activePath).toBe(PREVIEW.path);
    expect(restored.openPaths).toEqual([DOCUMENT_A.path]);
    expect(restored.previewPath).toBe(PREVIEW.path);
    expect(restored.nextEditorGroupIdRef.current).toBe(1);

    harness.unmount();
  });

  it("creates a root-scoped snapshot while preserving same-root groups", () => {
    const harness = renderEditorSessionState();
    const gitDiff = {
      ...DOCUMENT_A,
      path: "mockor-git-diff:worktree:/workspace/a.ts",
    };
    let groups = createInitialEditorGroupsState("editor-main", {
      activePath: FOREIGN_DOCUMENT.path,
      openPaths: [DOCUMENT_A.path, FOREIGN_DOCUMENT.path, gitDiff.path],
      previewPath: FOREIGN_PREVIEW.path,
    });
    groups = editorGroupsReducer(groups, {
      direction: "right",
      newGroupId: "editor-1",
      type: "split-group",
    });
    groups = {
      ...groups,
      activeGroupId: "editor-1",
      groups: {
        ...groups.groups,
        "editor-1": {
          activePath: PREVIEW.path,
          openPaths: [DOCUMENT_B.path, IMAGE.path, FOREIGN_IMAGE.path],
          previewPath: PREVIEW.path,
        },
      },
    };
    let snapshot!: EditorSurfaceSnapshot;

    act(() => {
      const session = harness.session();
      session.setDocuments({
        [DOCUMENT_A.path]: DOCUMENT_A,
        [DOCUMENT_B.path]: DOCUMENT_B,
        [FOREIGN_DOCUMENT.path]: FOREIGN_DOCUMENT,
        [gitDiff.path]: gitDiff,
      });
      session.setImageTabs({
        [IMAGE.path]: IMAGE,
        [FOREIGN_IMAGE.path]: FOREIGN_IMAGE,
      });
      session.setMarkdownPreviewTabs({
        [PREVIEW.path]: PREVIEW,
        [FOREIGN_PREVIEW.path]: FOREIGN_PREVIEW,
      });
      session.updateEditorGroups(() => groups);
      snapshot = session.snapshotEditorSurface("/workspace");
    });

    expect(Object.keys(snapshot.documents)).toEqual([DOCUMENT_A.path, DOCUMENT_B.path]);
    expect(snapshot.imageTabs).toEqual({ [IMAGE.path]: IMAGE });
    expect(snapshot.markdownPreviewTabs).toEqual({ [PREVIEW.path]: PREVIEW });
    expect(snapshot.editorGroups?.groups["editor-main"]).toEqual({
      activePath: DOCUMENT_A.path,
      openPaths: [DOCUMENT_A.path],
      previewPath: null,
    });
    expect(snapshot.editorGroups?.groups["editor-1"]).toEqual({
      activePath: PREVIEW.path,
      openPaths: [DOCUMENT_B.path, IMAGE.path],
      previewPath: PREVIEW.path,
    });
    expect(snapshot.activePath).toBe(PREVIEW.path);
    expect(snapshot.openPaths).toEqual([DOCUMENT_B.path, IMAGE.path]);
    expect(snapshot.previewPath).toBe(PREVIEW.path);

    act(() => {
      const session = harness.session();
      session.resetEditorSurfaceState();
      session.restoreEditorSurface("/workspace", {
        activePath: FOREIGN_DOCUMENT.path,
        documents: {
          [DOCUMENT_A.path]: DOCUMENT_A,
          [DOCUMENT_B.path]: DOCUMENT_B,
          [FOREIGN_DOCUMENT.path]: FOREIGN_DOCUMENT,
          [gitDiff.path]: gitDiff,
        },
        editorGroups: groups,
        imageTabs: {
          [IMAGE.path]: IMAGE,
          [FOREIGN_IMAGE.path]: FOREIGN_IMAGE,
        },
        markdownPreviewTabs: {
          [PREVIEW.path]: PREVIEW,
          [FOREIGN_PREVIEW.path]: FOREIGN_PREVIEW,
        },
        openPaths: [FOREIGN_DOCUMENT.path],
        previewPath: FOREIGN_PREVIEW.path,
      });
    });

    const restored = harness.session();
    expect(Object.keys(restored.documents)).toEqual([DOCUMENT_A.path, DOCUMENT_B.path]);
    expect(restored.imageTabs).toEqual({ [IMAGE.path]: IMAGE });
    expect(restored.markdownPreviewTabs).toEqual({ [PREVIEW.path]: PREVIEW });
    expect(restored.editorGroups).toEqual(snapshot.editorGroups);
    expect(restored.activePath).toBe(PREVIEW.path);
    expect(restored.openPaths).toEqual([DOCUMENT_B.path, IMAGE.path]);
    expect(restored.previewPath).toBe(PREVIEW.path);
    harness.unmount();
  });

  it("restores legacy snapshots without editor groups and synchronizes refs", () => {
    const harness = renderEditorSessionState();
    const legacySnapshot: EditorSurfaceSnapshot = {
      activePath: "/workspace/missing.ts",
      documents: {
        [DOCUMENT_A.path]: DOCUMENT_A,
        [DOCUMENT_B.path]: DOCUMENT_B,
      },
      imageTabs: {},
      markdownPreviewTabs: {},
      openPaths: [DOCUMENT_A.path, DOCUMENT_B.path, "/workspace/missing.ts"],
      previewPath: DOCUMENT_B.path,
    };

    act(() => {
      const session = harness.session();
      session.restoreEditorSurface("/workspace", legacySnapshot);

      expect(session.documentsRef.current).toEqual(legacySnapshot.documents);
      expect(session.editorGroupsRef.current.activeGroupId).toBe("editor-main");
      expect(session.editorGroupsRef.current.groups["editor-main"]).toEqual({
        activePath: DOCUMENT_A.path,
        openPaths: [DOCUMENT_A.path],
        previewPath: DOCUMENT_B.path,
      });
      expect(session.openPathsRef.current).toEqual([DOCUMENT_A.path]);
      expect(session.previewPathRef.current).toBe(DOCUMENT_B.path);
      expect(session.activeDocumentRef.current).toEqual(DOCUMENT_A);
    });

    const restored = harness.session();
    expect(restored.activePath).toBe(DOCUMENT_A.path);
    expect(restored.openPaths).toEqual([DOCUMENT_A.path]);
    expect(restored.previewPath).toBe(DOCUMENT_B.path);
    expect(restored.documents[DOCUMENT_A.path].content).not.toBe(
      restored.documents[DOCUMENT_A.path].savedContent,
    );
    harness.unmount();
  });

  it("restores a legacy runtime snapshot without Markdown previews or groups", () => {
    const harness = renderEditorSessionState();
    const legacyRuntimeSnapshot = {
      activePath: DOCUMENT_A.path,
      documents: { [DOCUMENT_A.path]: DOCUMENT_A },
      imageTabs: {},
      openPaths: [DOCUMENT_A.path],
      previewPath: null,
    } as unknown as EditorSurfaceSnapshot;

    expect(() => {
      act(() => {
        harness.session().restoreEditorSurface("/workspace", legacyRuntimeSnapshot);
      });
    }).not.toThrow();

    const restored = harness.session();
    expect(restored.documents).toEqual({ [DOCUMENT_A.path]: DOCUMENT_A });
    expect(restored.markdownPreviewTabs).toEqual({});
    expect(restored.editorGroups.groups["editor-main"]).toEqual({
      activePath: DOCUMENT_A.path,
      openPaths: [DOCUMENT_A.path],
      previewPath: null,
    });
    expect(restored.activeDocumentRef.current).toEqual(DOCUMENT_A);

    harness.unmount();
  });
});
