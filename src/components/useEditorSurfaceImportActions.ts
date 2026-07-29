import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type * as Monaco from "monaco-editor";
import type { EditorDocument } from "../domain/workspace";
import type {
  EditorSurfaceCommandId,
  EditorSurfaceCommandInvocationScope,
} from "../domain/editorSurfaceCommand";
import { editorSurfaceCommandInvocationScopesEqual } from "../domain/editorSurfaceCommand";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { WorkspacePathPolicy } from "../domain/workspacePath";
import {
  editorSurfaceImportActionKind,
  executeEditorSurfaceImportAction,
  type EditorSurfaceImportActionFeaturesGateway,
} from "./editorSurfaceImportActions";

interface UseEditorSurfaceImportActionsOptions {
  readonly activeDocumentRef: MutableRefObject<EditorDocument | null>;
  readonly captureScope: () => EditorSurfaceCommandInvocationScope | null;
  readonly editor: Monaco.editor.IStandaloneCodeEditor | null;
  readonly featureGateway: EditorSurfaceImportActionFeaturesGateway;
  readonly flushPendingDocumentRef: MutableRefObject<(path: string) => Promise<void>>;
  readonly getDocumentSyncVersionRef: MutableRefObject<
    (rootPath: string, path: string) => number | null
  >;
  readonly reportErrorRef: MutableRefObject<(error: unknown) => void>;
  readonly runtimeStatus: LanguageServerRuntimeStatus | null;
  readonly runtimeStatusRef: MutableRefObject<LanguageServerRuntimeStatus | null>;
  readonly workspaceOwnerKey: string | null;
  readonly workspacePathPolicy?: WorkspacePathPolicy;
  readonly workspaceRoot: string | null;
  readonly workspaceRootRef: MutableRefObject<string | null>;
  readonly workspaceTrusted: boolean;
  modelMatchesDocument(model: Monaco.editor.ITextModel, rootPath: string, path: string): boolean;
}

export function useEditorSurfaceImportActions({
  activeDocumentRef,
  captureScope,
  editor,
  featureGateway,
  flushPendingDocumentRef,
  getDocumentSyncVersionRef,
  modelMatchesDocument,
  reportErrorRef,
  runtimeStatus,
  runtimeStatusRef,
  workspaceOwnerKey,
  workspacePathPolicy,
  workspaceRoot,
  workspaceRootRef,
  workspaceTrusted,
}: UseEditorSurfaceImportActionsOptions) {
  const authorityEpochRef = useRef(0);
  const featureGatewayRef = useRef(featureGateway);
  const inFlightRef = useRef<object | null>(null);
  const mountedRef = useRef(true);
  const workspaceTrustedRef = useRef(workspaceTrusted);
  featureGatewayRef.current = featureGateway;
  workspaceTrustedRef.current = workspaceTrusted;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      authorityEpochRef.current += 1;
      inFlightRef.current = null;
    };
  }, []);

  useEffect(() => {
    authorityEpochRef.current += 1;
    inFlightRef.current = null;
  }, [featureGateway, runtimeStatus, workspaceOwnerKey, workspaceRoot, workspaceTrusted]);

  const capture = useCallback(
    (commandId: EditorSurfaceCommandId) => {
      const document = activeDocumentRef.current;
      const rootPath = workspaceRootRef.current;
      const model = editor?.getModel();
      const status = runtimeStatusRef.current;
      if (
        !mountedRef.current ||
        !workspaceTrustedRef.current ||
        !document ||
        document.readOnly === true ||
        !rootPath ||
        !model ||
        !modelMatchesDocument(model, rootPath, document.path) ||
        status?.kind !== "running" ||
        status.capabilities.codeAction !== true ||
        !workspaceRootKeysEqual(status.rootPath, rootPath)
      ) {
        return null;
      }
      try {
        const kind = editorSurfaceImportActionKind(commandId, model.getLanguageId());
        const scope = captureScope();
        if (!kind || !scope) return null;
        return {
          content: model.getValue(),
          epoch: authorityEpochRef.current,
          gateway: featureGatewayRef.current,
          kind,
          model,
          path: document.path,
          rootPath,
          scope,
          sessionId: status.sessionId,
          version: model.getVersionId(),
          workspacePathPolicy,
        };
      } catch {
        return null;
      }
    },
    [
      activeDocumentRef,
      captureScope,
      editor,
      modelMatchesDocument,
      runtimeStatusRef,
      workspacePathPolicy,
      workspaceRootRef,
    ],
  );

  const isEnabled = useCallback(
    (commandId: EditorSurfaceCommandId): boolean =>
      inFlightRef.current === null && capture(commandId) !== null,
    [capture],
  );

  const run = useCallback(
    (commandId: EditorSurfaceCommandId): void => {
      if (inFlightRef.current !== null || !editor) return;
      const captured = capture(commandId);
      if (!captured) return;
      const token = {};
      inFlightRef.current = token;
      const isCurrent = (): boolean => {
        const currentStatus = runtimeStatusRef.current;
        const currentDocument = activeDocumentRef.current;
        const currentScope = captureScope();
        try {
          return (
            mountedRef.current &&
            authorityEpochRef.current === captured.epoch &&
            inFlightRef.current === token &&
            featureGatewayRef.current === captured.gateway &&
            workspaceTrustedRef.current === true &&
            workspaceRootKeysEqual(workspaceRootRef.current, captured.rootPath) &&
            currentDocument?.path === captured.path &&
            currentDocument.readOnly !== true &&
            currentScope !== null &&
            editorSurfaceCommandInvocationScopesEqual(currentScope, captured.scope) &&
            editor.getModel() === captured.model &&
            captured.model.getVersionId() === captured.version &&
            captured.model.getValue() === captured.content &&
            currentStatus?.kind === "running" &&
            currentStatus.sessionId === captured.sessionId &&
            currentStatus.capabilities.codeAction === true &&
            workspaceRootKeysEqual(currentStatus.rootPath, captured.rootPath)
          );
        } catch {
          return false;
        }
      };

      void executeEditorSurfaceImportAction({
        content: captured.content,
        gateway: captured.gateway,
        kind: captured.kind,
        path: captured.path,
        rootPath: captured.rootPath,
        sessionId: captured.sessionId,
        version: () => getDocumentSyncVersionRef.current(captured.rootPath, captured.path),
        flush: () => flushPendingDocumentRef.current(captured.path),
        isCurrent,
        reportError: () => {
          if (isCurrent()) reportErrorRef.current(new Error("Unable to apply the import action."));
        },
        workspacePathPolicy: captured.workspacePathPolicy,
        apply: (edits) =>
          isCurrent() &&
          editor.executeEdits(
            "editor.importActions",
            edits.map((edit) => ({
              range: {
                startLineNumber: edit.range.start.line + 1,
                startColumn: edit.range.start.character + 1,
                endLineNumber: edit.range.end.line + 1,
                endColumn: edit.range.end.character + 1,
              },
              text: edit.newText,
              forceMoveMarkers: true,
            })),
          ),
      }).finally(() => {
        if (inFlightRef.current === token) inFlightRef.current = null;
      });
    },
    [
      activeDocumentRef,
      capture,
      captureScope,
      editor,
      flushPendingDocumentRef,
      getDocumentSyncVersionRef,
      reportErrorRef,
      runtimeStatusRef,
      workspaceRootRef,
    ],
  );

  const invalidateAuthority = useCallback(() => {
    authorityEpochRef.current += 1;
    inFlightRef.current = null;
  }, []);

  return { invalidateAuthority, isEnabled, run };
}
