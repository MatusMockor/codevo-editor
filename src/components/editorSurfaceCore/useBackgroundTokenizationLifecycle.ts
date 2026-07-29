import { useEffect, type MutableRefObject } from "react";
import type * as Monaco from "monaco-editor";
import {
  type BackgroundTokenizableModel,
  type BackgroundTokenizer,
} from "../../domain/backgroundTokenizer";
import { modelMatchesProject } from "../editorSurfaceModelIdentity";

interface BackgroundTokenizationLifecycleInput {
  readonly activeDocumentIsLargeSmart: boolean;
  readonly activeDocumentPath?: string;
  readonly editor: Monaco.editor.IStandaloneCodeEditor | null;
  readonly tokenizerRef: MutableRefObject<BackgroundTokenizer | null>;
  readonly workspaceRoot?: string | null;
}

/**
 * Owns idle token warming and its permanent teardown for one editor surface.
 */
export function useBackgroundTokenizationLifecycle({
  activeDocumentIsLargeSmart,
  activeDocumentPath,
  editor,
  tokenizerRef,
  workspaceRoot,
}: BackgroundTokenizationLifecycleInput): void {
  useEffect(() => {
    const tokenizer = tokenizerRef.current;
    if (!editor || !activeDocumentPath || !tokenizer) {
      return;
    }

    if (activeDocumentIsLargeSmart) {
      tokenizer.stop();
      return;
    }

    const model = editor.getModel();
    if (!model || !modelMatchesProject(model, workspaceRoot ?? null, activeDocumentPath)) {
      return;
    }

    tokenizer.start(model as unknown as BackgroundTokenizableModel);
    return () => tokenizer.stop();
  }, [activeDocumentIsLargeSmart, activeDocumentPath, editor, tokenizerRef, workspaceRoot]);

  useEffect(() => {
    const tokenizer = tokenizerRef.current;
    return () => tokenizer?.dispose();
  }, [tokenizerRef]);
}
