import { useEffect, useRef, type MutableRefObject } from "react";
import type * as Monaco from "monaco-editor";
import type {
  BackgroundTokenizableModel,
  BackgroundTokenizer,
} from "../../domain/backgroundTokenizer";
import {
  editorConfigEol,
  editorConfigFormattingOptions,
  type ResolvedEditorConfig,
} from "../../domain/editorConfig";
import type { LargeSmartDocumentPolicy } from "../../domain/largeDocumentPolicy";
import { isLargeSmartDocument } from "../../domain/largeDocumentPolicy";
import type { EditorDocument } from "../../domain/workspace";
import type { EditorRuntimeContextValue } from "../editorRuntimeContext";
import type { EditorRuntimeSurfaceRegistration } from "../EditorRuntimeHost";
import { reconcileActiveDocumentModelContent } from "../editorSurfaceLiveModelContentAuthority";
import { modelMatchesProject } from "../editorSurfaceModelIdentity";

interface EditorActiveModelLifecycleOptions {
  readonly activeDocumentContent?: string;
  readonly activeDocumentContentReady: boolean;
  readonly activeDocumentPath?: string;
  readonly activeDocumentRef: MutableRefObject<EditorDocument | null>;
  readonly backgroundTokenizerRef: MutableRefObject<BackgroundTokenizer | null>;
  readonly editor: Monaco.editor.IStandaloneCodeEditor | null;
  readonly editorConfig?: ResolvedEditorConfig;
  readonly generatedSurfaceId: string;
  readonly groupId: string;
  readonly isOpeningFile: boolean;
  readonly largeSmartDocumentPolicyRef: MutableRefObject<LargeSmartDocumentPolicy>;
  readonly monaco: typeof Monaco | null;
  readonly runtime: EditorRuntimeContextValue | null;
  readonly runtimeRegistrationRef: MutableRefObject<EditorRuntimeSurfaceRegistration>;
  readonly workspaceRoot: string | null;
  readonly workspaceRootRef: MutableRefObject<string | null>;
}

/**
 * Reconciles active-model content and re-applies model-owned configuration
 * whenever Monaco replaces the model behind the stable editor widget.
 */
export function useEditorActiveModelLifecycle({
  activeDocumentContent,
  activeDocumentContentReady,
  activeDocumentPath,
  activeDocumentRef,
  backgroundTokenizerRef,
  editor,
  editorConfig,
  generatedSurfaceId,
  groupId,
  isOpeningFile,
  largeSmartDocumentPolicyRef,
  monaco,
  runtime,
  runtimeRegistrationRef,
  workspaceRoot,
  workspaceRootRef,
}: EditorActiveModelLifecycleOptions): void {
  const reconcileActiveModelContentRef = useRef(() => undefined);
  const applyActiveModelConfigRef = useRef(() => undefined);
  const startActiveModelTokenizerRef = useRef(() => undefined);

  reconcileActiveModelContentRef.current = () => {
    const document = activeDocumentRef.current;

    if (!editor || !document || !activeDocumentContentReady || isOpeningFile) {
      return;
    }

    reconcileActiveDocumentModelContent(
      runtime,
      groupId,
      editor,
      workspaceRootRef.current,
      document,
    );
  };
  applyActiveModelConfigRef.current = () => {
    const document = activeDocumentRef.current;

    if (!editor || !monaco || !document) {
      return;
    }

    const model = editor.getModel();

    if (!model || !modelMatchesProject(model, workspaceRootRef.current, document.path)) {
      return;
    }

    const resolved: ResolvedEditorConfig = editorConfig ?? {};
    const formattingOptions = editorConfigFormattingOptions(resolved);

    if (formattingOptions) {
      model.updateOptions({
        insertSpaces: formattingOptions.insertSpaces,
        tabSize: formattingOptions.tabSize,
      });
    }

    const eol = editorConfigEol(resolved);

    if (!eol) {
      return;
    }

    model.setEOL(
      eol === "\r\n" ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF,
    );
  };
  startActiveModelTokenizerRef.current = () => {
    const document = activeDocumentRef.current;
    const tokenizer = backgroundTokenizerRef.current;

    if (!editor || !document || !tokenizer) {
      return;
    }

    if (isLargeSmartDocument(document, largeSmartDocumentPolicyRef.current)) {
      tokenizer.stop();
      return;
    }

    const model = editor.getModel();

    if (!model || !modelMatchesProject(model, workspaceRootRef.current, document.path)) {
      return;
    }

    tokenizer.start(model as unknown as BackgroundTokenizableModel);
  };

  useEffect(() => {
    if (!editor || !activeDocumentPath || !activeDocumentContentReady || isOpeningFile) {
      return;
    }

    reconcileActiveModelContentRef.current();
  }, [
    activeDocumentContent,
    activeDocumentContentReady,
    activeDocumentPath,
    editor,
    isOpeningFile,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const disposable = editor.onDidChangeModel(() => {
      reconcileActiveModelContentRef.current();
      applyActiveModelConfigRef.current();
      startActiveModelTokenizerRef.current();
      runtime?.updateSurface(generatedSurfaceId, runtimeRegistrationRef.current);
    });

    return () => disposable.dispose();
  }, [editor, generatedSurfaceId, runtime]);
}
