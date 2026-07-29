import { useEffect, useRef, type MutableRefObject } from "react";
import type * as Monaco from "monaco-editor";
import type { WorkspaceSessionViewState } from "../../domain/settings";
import { modelMatchesProject } from "../editorSurfaceModelIdentity";
import {
  foldingModelForEditor,
  type FoldingModelViewState,
  type FoldingRegionViewState,
} from "./modelViewState";

interface EditorModelViewStateLifecycleInput {
  readonly activeDocumentPath?: string;
  readonly captureEnabled: boolean;
  readonly editor: Monaco.editor.IStandaloneCodeEditor | null;
  readonly onViewStateChangeRef: MutableRefObject<
    ((path: string, viewState: WorkspaceSessionViewState) => void) | undefined
  >;
  readonly restoredViewStateRevision: number;
  readonly restoredViewStates: Record<string, WorkspaceSessionViewState>;
  readonly workspaceRoot?: string | null;
}

export function useEditorModelViewStateLifecycle({
  activeDocumentPath,
  captureEnabled,
  editor,
  onViewStateChangeRef,
  restoredViewStateRevision,
  restoredViewStates,
  workspaceRoot,
}: EditorModelViewStateLifecycleInput): void {
  const appliedRestoredViewStateKeysRef = useRef(new Set<string>());

  useEffect(() => {
    if (!editor || !activeDocumentPath || !workspaceRoot) {
      return;
    }

    const viewState = restoredViewStates[activeDocumentPath];
    if (!viewState) {
      return;
    }

    const applicationKey = `${workspaceRoot}\0${activeDocumentPath}\0${restoredViewStateRevision}`;
    if (appliedRestoredViewStateKeysRef.current.has(applicationKey)) {
      return;
    }

    let active = true;
    let positionApplied = false;
    let restorationModel: Monaco.editor.ITextModel | null = null;
    let retryDisposable: Monaco.IDisposable | null = null;

    const activeModel = () => {
      const model = editor.getModel();
      if (!model || !modelMatchesProject(model, workspaceRoot, activeDocumentPath)) {
        return null;
      }
      return model;
    };

    const applyPosition = (model: Monaco.editor.ITextModel) => {
      if (positionApplied) {
        return false;
      }

      const lineNumber = Math.min(Math.max(viewState.line, 1), Math.max(model.getLineCount(), 1));
      const column = Math.min(Math.max(viewState.column, 1), model.getLineMaxColumn(lineNumber));
      const position = { column, lineNumber };

      editor.setPosition(position);
      editor.revealPositionInCenter(position);
      if (viewState.scrollTop !== undefined) {
        editor.setScrollTop(viewState.scrollTop);
      }
      positionApplied = true;
      return true;
    };

    const finish = () => {
      if (active) {
        appliedRestoredViewStateKeysRef.current.add(applicationKey);
      }
    };

    const finishFoldingRestore = (model: Monaco.editor.ITextModel) => {
      if (!active || activeModel() !== model) {
        return;
      }
      if (viewState.scrollTop !== undefined) {
        editor.setScrollTop(viewState.scrollTop);
      }
      finish();
    };

    const collapsePersistedLines = (
      model: Monaco.editor.ITextModel,
      foldingModel: FoldingModelViewState,
    ) => {
      if (activeModel() !== model) {
        return false;
      }

      const validFoldedLines = (viewState.foldedLines ?? []).filter(
        (line) => line >= 1 && line <= model.getLineCount(),
      );
      const foldedLines = new Set(validFoldedLines);
      const regions: FoldingRegionViewState[] = [];
      let matched = validFoldedLines.length === 0;

      for (let index = 0; index < foldingModel.regions.length; index += 1) {
        const startLineNumber = foldingModel.regions.getStartLineNumber(index);
        if (!foldedLines.has(startLineNumber)) {
          continue;
        }
        matched = true;
        if (!foldingModel.regions.isCollapsed(index)) {
          regions.push(foldingModel.regions.toRegion(index));
        }
      }

      if (regions.length > 0) {
        foldingModel.toggleCollapseState(regions);
      }
      return matched;
    };

    const applyFolding = async (model: Monaco.editor.ITextModel) => {
      const foldingModel = await foldingModelForEditor(editor);
      if (!active || activeModel() !== model) {
        return;
      }
      if ((viewState.foldedLines?.length ?? 0) === 0) {
        finish();
        return;
      }
      if (!foldingModel) {
        finishFoldingRestore(model);
        return;
      }
      if (collapsePersistedLines(model, foldingModel)) {
        finishFoldingRestore(model);
        return;
      }

      retryDisposable = foldingModel.onDidChange(() => {
        retryDisposable?.dispose();
        retryDisposable = null;
        collapsePersistedLines(model, foldingModel);
        finishFoldingRestore(model);
      });
    };

    const applyViewState = () => {
      const model = activeModel();
      if (!model) {
        return;
      }
      if (restorationModel !== model) {
        restorationModel = model;
        positionApplied = false;
        retryDisposable?.dispose();
        retryDisposable = null;
      }
      if (applyPosition(model)) {
        void applyFolding(model);
      }
    };

    applyViewState();
    if (appliedRestoredViewStateKeysRef.current.has(applicationKey)) {
      return;
    }

    const disposable = editor.onDidChangeModel(applyViewState);
    return () => {
      active = false;
      disposable.dispose();
      retryDisposable?.dispose();
    };
  }, [activeDocumentPath, editor, restoredViewStateRevision, restoredViewStates, workspaceRoot]);

  useEffect(() => {
    if (!editor || !activeDocumentPath || !captureEnabled) {
      return;
    }

    let active = true;
    let foldingBindingRevision = 0;
    let foldingModel: FoldingModelViewState | null = null;
    let foldingDisposable: Monaco.IDisposable | null = null;

    const resetFoldingBinding = () => {
      foldingBindingRevision += 1;
      foldingDisposable?.dispose();
      foldingDisposable = null;
      foldingModel = null;
    };

    const captureViewState = async () => {
      const model = editor.getModel();
      if (!model || !modelMatchesProject(model, workspaceRoot ?? null, activeDocumentPath)) {
        return;
      }

      const position = editor.getPosition();
      if (!position) {
        return;
      }

      if (!foldingModel) {
        const bindingRevision = foldingBindingRevision;
        const resolvedFoldingModel = await foldingModelForEditor(editor);
        if (!active || bindingRevision !== foldingBindingRevision || editor.getModel() !== model) {
          return;
        }
        foldingModel = resolvedFoldingModel;
        if (foldingModel && !foldingDisposable) {
          foldingDisposable = foldingModel.onDidChange(() => {
            void captureViewState();
          });
        }
      }

      const currentModel = editor.getModel();
      if (
        !currentModel ||
        !modelMatchesProject(currentModel, workspaceRoot ?? null, activeDocumentPath)
      ) {
        return;
      }

      const foldedLines: number[] = [];
      if (foldingModel) {
        for (
          let index = 0;
          index < foldingModel.regions.length && foldedLines.length < 500;
          index += 1
        ) {
          if (foldingModel.regions.isCollapsed(index)) {
            foldedLines.push(foldingModel.regions.getStartLineNumber(index));
          }
        }
      }

      onViewStateChangeRef.current?.(activeDocumentPath, {
        column: position.column,
        ...(foldedLines.length === 0 ? {} : { foldedLines }),
        line: position.lineNumber,
        scrollTop: editor.getScrollTop(),
      });
    };

    void captureViewState();
    const cursorDisposable = editor.onDidChangeCursorPosition(() => void captureViewState());
    const scrollDisposable = editor.onDidScrollChange(() => void captureViewState());
    const modelDisposable = editor.onDidChangeModel(() => {
      resetFoldingBinding();
      void captureViewState();
    });

    return () => {
      active = false;
      cursorDisposable.dispose();
      modelDisposable.dispose();
      resetFoldingBinding();
      scrollDisposable.dispose();
    };
  }, [activeDocumentPath, captureEnabled, editor, onViewStateChangeRef, workspaceRoot]);
}
