// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { createInitialEditorGroupsState } from "../../domain/editorGroups";
import type { EslintDiagnosticsByRoot } from "../../domain/eslintDiagnostics";
import type { MarkdownPreviewTab } from "../../domain/markdownPreview";
import type { PhpstanDiagnosticsByRoot } from "../../domain/phpstanDiagnostics";
import type { EditorDocument, ImageTab } from "../../domain/workspace";
import { createWorkspaceRuntimeOwner } from "../../domain/workspaceRuntimeOwner";
import { DocumentSaveCoordinator } from "../documentSaveCoordinator";
import { createRegisteredDocumentSaveIdentity } from "../documentSaveIdentity";
import { useWorkbenchEditorGroupCloseLifecycle } from "../useWorkbenchEditorGroupCloseLifecycle";
import {
  useStableWorkbenchDocumentCloseCommands,
  type StableWorkbenchDocumentCloseCommands,
} from "./useWorkbenchDocumentLifecycleCoordinator";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function deferred(): Deferred {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

describe("useWorkbenchDocumentLifecycleCoordinator close boundary", () => {
  it("drains the exact A1 issued write and rejects its dirty close after B to A2", async () => {
    const rootPath = "/workspace";
    const path = `${rootPath}/src/App.ts`;
    const identity = createRegisteredDocumentSaveIdentity("workspace-a", rootPath, "src/App.ts");
    if (!identity) {
      throw new Error("Registered save identity was not created");
    }
    const ownerA1 = createWorkspaceRuntimeOwner("workspace-a", rootPath);
    const ownerB = createWorkspaceRuntimeOwner("workspace-b", rootPath);
    const ownerA2 = createWorkspaceRuntimeOwner("workspace-a", rootPath);
    const ownerRef = { current: ownerA1 };
    const documentA1: EditorDocument = {
      content: "A1 dirty",
      language: "typescript",
      name: "App.ts",
      path,
      savedContent: "saved",
    };
    const documentA2: EditorDocument = { ...documentA1 };
    const claimGenerationRef = { current: 1 };
    const editorGroupsRef = {
      current: createInitialEditorGroupsState("editor-main", {
        activePath: path,
        openPaths: [path],
        previewPath: null,
      }),
    };
    const documentsRef = { current: { [path]: documentA1 } };
    const activeDocumentRef = { current: documentA1 as EditorDocument | null };
    const openPathsRef = { current: [path] };
    const previewPathRef = { current: null as string | null };
    const imageTabsRef: { current: Record<string, ImageTab> } = { current: {} };
    const markdownPreviewTabsRef: { current: Record<string, MarkdownPreviewTab> } = {
      current: {},
    };
    const saveCoordinator = new DocumentSaveCoordinator<void>();
    const issuedWrite = deferred();
    let writeWasIssued = false;
    const save = saveCoordinator.request(identity, async (lease) => {
      const permit = lease.tryBeginWrite();
      if (!permit) {
        throw new Error("Expected the A1 write permit");
      }
      writeWasIssued = true;
      await issuedWrite.promise;
      permit.settle();
    });
    await vi.waitFor(() => expect(writeWasIssued).toBe(true));

    const closeTextDocument = vi.fn();
    const captured: { current: StableWorkbenchDocumentCloseCommands | null } = {
      current: null,
    };
    let eslintDiagnostics: EslintDiagnosticsByRoot = {};
    let phpstanDiagnostics: PhpstanDiagnosticsByRoot = {};
    const root = createRoot(document.createElement("div"));
    const currentWorkspaceRootRef = { current: rootPath as string | null };

    function Harness({ revision }: { readonly revision: number }) {
      void revision;
      const currentLifecycle = useWorkbenchEditorGroupCloseLifecycle({
        workspaceRoot: rootPath,
        currentWorkspaceRootRef,
        captureWorkspaceAuthority: () => ({
          kind: "registered",
          claimGeneration: claimGenerationRef.current,
          identity: {
            admissionToken: 1,
            canonicalRoot: rootPath,
            caseSensitive: true,
            policy: { caseSensitive: true, unicodeNormalization: "none" },
            selectedPath: rootPath,
            unicodeNormalizationPolicy: "preserved",
            workspaceId: "workspace-a",
          },
          owner: ownerRef.current,
          rootPath,
        }),
        isWorkspaceAuthorityCurrent: (authority) =>
          authority.owner === ownerRef.current &&
          authority.kind === "registered" &&
          authority.claimGeneration === claimGenerationRef.current,
        editorGroupsRef,
        openPathsRef,
        previewPathRef,
        activeDocumentRef,
        documentsRef,
        imageTabsRef,
        markdownPreviewTabsRef,
        setImageTabs: (update) => {
          imageTabsRef.current =
            typeof update === "function" ? update(imageTabsRef.current) : update;
        },
        setMarkdownPreviewTabs: (update) => {
          markdownPreviewTabsRef.current =
            typeof update === "function" ? update(markdownPreviewTabsRef.current) : update;
        },
        setEslintDiagnosticsByRoot: (update) => {
          eslintDiagnostics = typeof update === "function" ? update(eslintDiagnostics) : update;
        },
        setPhpstanDiagnosticsByRoot: (update) => {
          phpstanDiagnostics = typeof update === "function" ? update(phpstanDiagnostics) : update;
        },
        updateEditorGroups: (update) => {
          editorGroupsRef.current = update(editorGroupsRef.current);
        },
        closeTextDocument,
        closeTextSurface: vi.fn(),
        saveDocument: vi.fn(async () => ({ status: "stale" as const })),
        runWithIssuedWriteDrain: saveCoordinator.runWithIssuedWriteDrain.bind(saveCoordinator),
        resolveDocumentSaveOwnership: () => identity,
        resolveWorkspaceRuntimeOwner: () => ownerRef.current,
        dirtyCloseDecisionPort: { decideDirtyClose: vi.fn(async () => "discard" as const) },
        hasExternalFileConflict: () => false,
        prompter: { confirm: vi.fn(() => true), prompt: vi.fn(() => null) },
      });
      const currentCommands = useStableWorkbenchDocumentCloseCommands(
        currentLifecycle.closeDocument,
        currentLifecycle.closeActiveEditorGroup,
        currentLifecycle.closeActiveEditorGroupSurface,
      );
      captured.current = currentCommands;
      return null;
    }

    act(() => root.render(<Harness revision={1} />));
    const stableRunCloseDocument = captured.current?.runCloseDocument;
    if (!stableRunCloseDocument) {
      throw new Error("Document close command did not render");
    }
    const staleClose = stableRunCloseDocument(path);
    await Promise.resolve();
    expect(closeTextDocument).not.toHaveBeenCalled();

    ownerRef.current = ownerB;
    claimGenerationRef.current = 2;
    act(() => root.render(<Harness revision={2} />));
    ownerRef.current = ownerA2;
    claimGenerationRef.current = 3;
    documentsRef.current = { [path]: documentA2 };
    activeDocumentRef.current = documentA2;
    act(() => root.render(<Harness revision={3} />));

    await act(async () => {
      issuedWrite.resolve();
      await expect(save).resolves.toEqual({ status: "saved" });
      await expect(staleClose).resolves.toBe("stale");
    });
    expect(closeTextDocument).not.toHaveBeenCalled();

    const freshClose = stableRunCloseDocument(path);
    await act(async () => {
      await expect(freshClose).resolves.toBe("closed");
    });
    expect(closeTextDocument).toHaveBeenCalledOnce();
    expect(closeTextDocument).toHaveBeenCalledWith(path, { skipConfirmation: true });

    act(() => root.unmount());
  });
});
