import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from "react";
import type * as Monaco from "monaco-editor";
import {
  boundedConflictMarkerDecorationsFromSource,
  type BoundedConflictMarkerDecorationProjection,
} from "../application/conflictMarkerCodeActions";
import type { LargeSmartDocumentPolicy } from "../domain/largeDocumentPolicy";
import type { EditorDocument } from "../domain/workspace";
import {
  ConflictMarkerDecorationRefreshCoordinator,
  type ConflictMarkerDecorationRefreshResult,
} from "./conflictMarkerDecorationRefreshCoordinator";
import { isLargeSmartModel } from "./editorSurfaceModelGuards";
import { modelMatchesProject } from "./editorSurfaceModelIdentity";

interface ConflictMarkerEditorDecorationOptions {
  readonly activeDocumentPath: string | undefined;
  readonly activeDocumentRef: MutableRefObject<EditorDocument | null>;
  readonly editor: Monaco.editor.IStandaloneCodeEditor | null;
  readonly largeDocumentPolicyRef: MutableRefObject<LargeSmartDocumentPolicy>;
  readonly ownerKey: string | null;
  readonly surfaceId: string;
  readonly workspaceIdentity: object | null;
  readonly workspaceRoot: string | null;
  readonly workspaceRootRef: MutableRefObject<string | null>;
}

/**
 * Monaco adapter for the bounded conflict-marker projection coordinator.
 * Typing only replaces one timer; the full source is read and parsed once after
 * the debounce, under an exact model/version/path/workspace owner lease.
 */
export function useConflictMarkerEditorDecorations({
  activeDocumentPath,
  activeDocumentRef,
  editor,
  largeDocumentPolicyRef,
  ownerKey,
  surfaceId,
  workspaceIdentity,
  workspaceRoot,
  workspaceRootRef,
}: ConflictMarkerEditorDecorationOptions): void {
  const decorationOwnerRef = useRef<{
    readonly ids: readonly string[];
    readonly model: Monaco.editor.ITextModel;
  } | null>(null);
  const ownerLeaseRef = useRef({
    generation: 0,
    identity: workspaceIdentity,
    key: ownerKey,
    root: workspaceRoot,
  });
  useLayoutEffect(() => {
    if (
      ownerLeaseRef.current.identity === workspaceIdentity &&
      ownerLeaseRef.current.key === ownerKey &&
      ownerLeaseRef.current.root === workspaceRoot
    ) {
      return;
    }
    ownerLeaseRef.current = {
      generation: ownerLeaseRef.current.generation + 1,
      identity: workspaceIdentity,
      key: ownerKey,
      root: workspaceRoot,
    };
  }, [ownerKey, workspaceIdentity, workspaceRoot]);

  useEffect(() => {
    if (!editor) return;

    const coordinator =
      new ConflictMarkerDecorationRefreshCoordinator<BoundedConflictMarkerDecorationProjection>();
    const clearDecorations = () => {
      const owner = decorationOwnerRef.current;
      decorationOwnerRef.current = null;
      if (!owner || owner.model.isDisposed?.()) return;
      owner.model.deltaDecorations([...owner.ids], []);
    };
    const scheduleRefresh = () => {
      const model = editor.getModel();
      const document = activeDocumentRef.current;
      const matchesActiveDocument =
        model && document && modelMatchesProject(model, workspaceRootRef.current, document.path);
      if (
        !model ||
        !document ||
        !matchesActiveDocument ||
        model.isDisposed?.() ||
        typeof model.deltaDecorations !== "function" ||
        typeof model.getValue !== "function" ||
        typeof model.getValueLength !== "function" ||
        typeof model.getVersionId !== "function" ||
        isLargeSmartModel(model, largeDocumentPolicyRef.current)
      ) {
        coordinator.cancel();
        clearDecorations();
        return;
      }

      const requestedModel = model;
      const requestedPath = document.path;
      const requestedVersion = model.getVersionId();
      const requestedLease = ownerLeaseRef.current;
      const authority = {
        model: requestedModel,
        modelUri: requestedModel.uri.toString(),
        ownerKey: `${requestedLease.key ?? surfaceId}:${requestedLease.generation}`,
        path: requestedPath,
        version: requestedVersion,
      };
      coordinator.request({
        authority,
        currentAuthority: () => {
          const currentDocument = activeDocumentRef.current;
          const currentModel = editor.getModel();
          const currentLease = ownerLeaseRef.current;
          if (
            !currentDocument ||
            !currentModel ||
            typeof currentModel.getVersionId !== "function"
          ) {
            return null;
          }
          return {
            model: currentModel,
            modelUri: currentModel.uri.toString(),
            ownerKey: `${currentLease.key ?? surfaceId}:${currentLease.generation}`,
            path: currentDocument.path,
            version: currentModel.getVersionId(),
          };
        },
        isCurrent: () => {
          const currentDocument = activeDocumentRef.current;
          return (
            editor.getModel() === requestedModel &&
            !requestedModel.isDisposed?.() &&
            requestedModel.getVersionId() === requestedVersion &&
            currentDocument?.path === requestedPath &&
            modelMatchesProject(requestedModel, workspaceRootRef.current, requestedPath)
          );
        },
        project: boundedConflictMarkerDecorationsFromSource,
        publish: (result) => {
          clearDecorations();
          const decorations =
            result.kind === "ready" && result.projection.kind === "ready"
              ? [...result.projection.decorations]
              : [degradedConflictMarkerDecoration(result)];
          const ids = requestedModel.deltaDecorations([], decorations);
          decorationOwnerRef.current = { ids, model: requestedModel };
        },
        readSource: () => requestedModel.getValue(),
        sourceCharacters: requestedModel.getValueLength(),
      });
    };

    scheduleRefresh();
    const contentChange = editor.onDidChangeModelContent(scheduleRefresh);
    const modelChange = editor.onDidChangeModel(scheduleRefresh);
    return () => {
      contentChange.dispose();
      modelChange.dispose();
      coordinator.dispose();
      clearDecorations();
    };
  }, [
    activeDocumentPath,
    activeDocumentRef,
    editor,
    largeDocumentPolicyRef,
    ownerKey,
    surfaceId,
    workspaceIdentity,
    workspaceRoot,
    workspaceRootRef,
  ]);
}

function degradedConflictMarkerDecoration(
  result: ConflictMarkerDecorationRefreshResult<BoundedConflictMarkerDecorationProjection>,
): Monaco.editor.IModelDeltaDecoration {
  const message =
    result.kind === "degraded"
      ? `Conflict marker highlighting is limited because this file exceeds ${result.characterLimit.toLocaleString()} characters.`
      : result.projection.kind === "degraded"
        ? `Conflict marker highlighting is limited because the file contains more than ${result.projection.blockLimit.toLocaleString()} conflicts.`
        : "Conflict marker highlighting is temporarily limited.";
  return {
    options: {
      after: { content: `  ${message}` },
      hoverMessage: { value: message },
      isWholeLine: true,
    },
    range: {
      endColumn: 1,
      endLineNumber: 1,
      startColumn: 1,
      startLineNumber: 1,
    },
  };
}
