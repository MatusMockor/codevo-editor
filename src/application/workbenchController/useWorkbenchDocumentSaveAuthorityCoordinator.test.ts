import { describe, expect, it, vi } from "vitest";
import { createInitialEditorGroupsState } from "../../domain/editorGroups";
import { defaultWorkspaceSettings } from "../../domain/settings";
import type { EditorDocument, WorkspaceFileGateway } from "../../domain/workspace";
import { createWorkspaceRuntimeOwner } from "../../domain/workspaceRuntimeOwner";
import { createRegisteredDocumentSaveIdentity } from "../documentSaveIdentity";
import { OwnerResolvingDocumentSaveService } from "../ownerResolvingDocumentSaveService";
import { WorkbenchOwnerDocumentSaveAdapters } from "../workbenchOwnerDocumentSaveAdapters";

const ROOT = "/workspace";
const PATH = "/workspace/src/App.ts";

function document(content: string): EditorDocument {
  return {
    content,
    language: "typescript",
    name: "App.ts",
    path: PATH,
    savedContent: "export const value = 0;",
  };
}

describe("Workbench document save authority coordinator boundary", () => {
  it("rejects a captured save after same-root A to B to A replacement", async () => {
    const ownerA1 = createWorkspaceRuntimeOwner("workspace-a", ROOT);
    const ownerB = createWorkspaceRuntimeOwner("workspace-b", ROOT);
    const ownerA2 = createWorkspaceRuntimeOwner("workspace-a", ROOT);
    const ownerRef = { current: ownerA1 };
    const firstDocument = document("export const value = 1;");
    const documentsRef: { current: Record<string, EditorDocument> } = {
      current: { [PATH]: firstDocument },
    };
    const adapters = new WorkbenchOwnerDocumentSaveAdapters({
      currentWorkspaceRootRef: { current: ROOT },
      documentsRef,
      editorGroupsRef: {
        current: createInitialEditorGroupsState("editor-main", {
          activePath: PATH,
          openPaths: [PATH],
          previewPath: null,
        }),
      },
      hasExternalFileConflict: () => false,
      resolveDocumentSaveOwnership: () =>
        createRegisteredDocumentSaveIdentity("workspace-a", ROOT, "src/App.ts"),
      resolveWorkspaceRuntimeOwner: () => ownerRef.current,
      setDocuments: (next) => {
        documentsRef.current = typeof next === "function" ? next(documentsRef.current) : next;
      },
      workspaceIdentityByRootRef: { current: {} },
      workspaceStateCacheRef: { current: {} },
    });
    const captured = adapters.capture(ROOT)?.[0];
    expect(captured).toBeDefined();
    ownerRef.current = ownerB;
    documentsRef.current = { [PATH]: document("export const value = 2;") };
    ownerRef.current = ownerA2;
    const writeTextFile = vi.fn<WorkspaceFileGateway["writeTextFile"]>();
    const service = new OwnerResolvingDocumentSaveService({
      repository: adapters.repository,
      resolvePipeline: () => ({
        beginDocumentSelfWrite: () => null,
        captureLocalHistorySnapshot: async () => undefined,
        formattedContentForSave: async (_owner, _root, _settings, item) => item.content,
        hasExternalFileConflict: () => false,
        invalidatePrefetch: () => undefined,
        optimizedImportsContentForSave: (_owner, _root, _settings, _item, content) => content,
        organizedImportsContentForSave: async (_owner, _root, _settings, _item, content) => content,
        resolveEditorConfigForFile: async () => ({}),
        settings: defaultWorkspaceSettings(),
        syncSavedDocument: async () => undefined,
        syncSavedJavaScriptTypeScriptDocument: async () => undefined,
        workspaceFiles: { writeTextFile } as unknown as WorkspaceFileGateway,
      }),
    });

    await expect(
      service.saveDocument({
        target: captured!.identity.saveTarget,
        lease: {
          isCurrent: () => true,
          tryBeginWrite: () => ({ granted: true, settle: vi.fn() }),
        },
      }),
    ).resolves.toEqual({ status: "stale" });
    expect(writeTextFile).not.toHaveBeenCalled();
    expect(documentsRef.current[PATH].content).toBe("export const value = 2;");
  });
});
