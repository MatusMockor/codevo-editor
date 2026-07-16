import { describe, expect, it, vi } from "vitest";
import { createInitialEditorGroupsState } from "../domain/editorGroups";
import { defaultWorkspaceSettings } from "../domain/settings";
import type { EditorDocument, WorkspaceFileGateway } from "../domain/workspace";
import { createWorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import { OwnerResolvingDocumentSaveService } from "./ownerResolvingDocumentSaveService";
import { WorkbenchOwnerDocumentSaveAdapters } from "./workbenchOwnerDocumentSaveAdapters";

const ROOT = "/selected/workspace";
const CANONICAL_ROOT = "/canonical/workspace";
const SELECTED_PATH = `${ROOT}/src/App.php`;
const CANONICAL_PATH = `${CANONICAL_ROOT}/src/App.php`;
const owner = createWorkspaceRuntimeOwner("workspace-aliases", ROOT);

function document(path: string, content = "<?php\n$edited = true;\n"): EditorDocument {
  return {
    content,
    language: "php",
    name: "App.php",
    path,
    savedContent: "<?php\n$edited = false;\n",
  };
}

function harness(canonicalContent = "<?php\n$edited = true;\n") {
  const documentsRef: { current: Record<string, EditorDocument> } = {
    current: {
      [SELECTED_PATH]: document(SELECTED_PATH),
      [CANONICAL_PATH]: document(CANONICAL_PATH, canonicalContent),
    },
  };
  const editorGroups = createInitialEditorGroupsState("editor-main", {
    activePath: SELECTED_PATH,
    openPaths: [SELECTED_PATH, CANONICAL_PATH],
    previewPath: null,
  });
  const adapters = new WorkbenchOwnerDocumentSaveAdapters({
    currentWorkspaceRootRef: { current: ROOT },
    documentsRef,
    editorGroupsRef: { current: editorGroups },
    hasExternalFileConflict: () => false,
    resolveDocumentSaveOwnership: (_rootPath, path) => {
      if (path !== SELECTED_PATH && path !== CANONICAL_PATH) {
        return null;
      }

      return {
        canonicalRoot: CANONICAL_ROOT,
        workspaceRelativePath: "src/App.php",
      };
    },
    resolveWorkspaceRuntimeOwner: () => owner,
    setDocuments: (next) => {
      documentsRef.current = typeof next === "function"
        ? next(documentsRef.current)
        : next;
    },
    workspaceIdentityByRootRef: { current: {} },
    workspaceStateCacheRef: { current: {} },
  });
  const writeTextFile = vi.fn<WorkspaceFileGateway["writeTextFile"]>(
    async () => ({ status: "success", revision: null }),
  );
  const workspaceFiles = { writeTextFile } as unknown as WorkspaceFileGateway;
  const service = new OwnerResolvingDocumentSaveService({
    repository: adapters.repository,
    resolvePipeline: () => ({
      captureLocalHistorySnapshot: async () => undefined,
      formattedContentForSave: async (_owner, _root, _settings, item) =>
        item.content,
      hasExternalFileConflict: () => false,
      beginDocumentSelfWrite: () => null,
      invalidatePrefetch: () => undefined,
      optimizedImportsContentForSave: (
        _owner,
        _root,
        _settings,
        _item,
        content,
      ) => content,
      organizedImportsContentForSave: async (
        _owner,
        _root,
        _settings,
        _item,
        content,
      ) => content,
      resolveEditorConfigForFile: async () => ({}),
      settings: defaultWorkspaceSettings(),
      syncSavedDocument: async () => undefined,
      syncSavedJavaScriptTypeScriptDocument: async () => undefined,
      workspaceFiles,
    }),
  });

  return { adapters, documentsRef, service, writeTextFile };
}

describe("WorkbenchOwnerDocumentSaveAdapters canonical aliases", () => {
  it("stales divergent aliases before issuing a write", async () => {
    const subject = harness("<?php\n$edited = 'different';\n");
    const targets = subject.adapters.capture(ROOT);

    expect(targets).toHaveLength(1);
    await expect(subject.service.saveDocument({
      target: targets![0]!.identity.saveTarget,
      lease: {
        isCurrent: () => true,
        tryBeginWrite: () => ({ granted: true, settle: vi.fn() }),
      },
    })).resolves.toEqual({ status: "stale" });
    expect(subject.writeTextFile).not.toHaveBeenCalled();
    expect(subject.documentsRef.current[SELECTED_PATH].content).toContain("true");
    expect(subject.documentsRef.current[CANONICAL_PATH].content).toContain(
      "different",
    );
  });

  it("coalesces equivalent aliases into one write and acknowledges both", async () => {
    const subject = harness();
    const targets = subject.adapters.capture(ROOT);

    expect(targets).toHaveLength(1);
    await expect(subject.service.saveDocument({
      target: targets![0]!.identity.saveTarget,
      lease: {
        isCurrent: () => true,
        tryBeginWrite: () => ({ granted: true, settle: vi.fn() }),
      },
    })).resolves.toEqual(expect.objectContaining({
      contentIsCurrent: true,
      status: "saved",
    }));
    expect(subject.writeTextFile).toHaveBeenCalledOnce();
    expect(subject.documentsRef.current[SELECTED_PATH].savedContent).toBe(
      subject.documentsRef.current[SELECTED_PATH].content,
    );
    expect(subject.documentsRef.current[CANONICAL_PATH].savedContent).toBe(
      subject.documentsRef.current[CANONICAL_PATH].content,
    );
  });
});
