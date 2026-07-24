import type * as Monaco from "monaco-editor";
import type { DebugInlineValueContext } from "../application/debugInlineValueContext";
import type { JsTestExplorerCurrentFileIdentity } from "../domain/jsTestExplorerFilter";
import type { JsTestProblemsSnapshot } from "../domain/jsTestProblems";
import type { EditorDocument } from "../domain/workspace";
import { useDebugInlineValueDecorations } from "./useDebugInlineValueDecorations";
import {
  useDebugStoppedLineDecoration,
  type DebugStoppedLocation,
} from "./useDebugStoppedLineDecoration";
import {
  useEditorSurfaceCoverageDecorations,
  type EditorSurfaceCoverageProps,
} from "./useEditorSurfaceCoverageDecorations";
import { useJsTestProblemEditorDecorations } from "./useJsTestProblemEditorDecorations";

export interface EditorRuntimeDecorationOptions extends EditorSurfaceCoverageProps {
  readonly activeDocument: EditorDocument | null;
  readonly currentFileIdentity: JsTestExplorerCurrentFileIdentity | null;
  readonly currentModel: Monaco.editor.ITextModel | null;
  readonly debugInlineValueContext: DebugInlineValueContext | null;
  readonly debugStoppedLocation: DebugStoppedLocation | null;
  readonly editor: Monaco.editor.IStandaloneCodeEditor | null;
  readonly monaco: typeof Monaco | null;
  readonly problemSnapshot: JsTestProblemsSnapshot | null;
  readonly rootPath: string | null;
  readonly workspaceId: string | null;
}

/** Composes runtime-owned editor decorations behind one narrow presentation seam. */
export function useEditorRuntimeDecorations({
  activeDocument,
  currentFileIdentity,
  currentModel,
  debugInlineValueContext,
  debugStoppedLocation,
  editor,
  jsTestCoverageReport = null,
  monaco,
  phpCoverageActiveOwner,
  phpCoveragePublication,
  problemSnapshot,
  rootPath,
  workspaceId,
}: EditorRuntimeDecorationOptions): void {
  useDebugStoppedLineDecoration({
    activeDocumentPath: activeDocument?.path,
    editor,
    location: debugStoppedLocation,
    model: currentModel,
    monaco,
  });
  useDebugInlineValueDecorations({
    activeDocument,
    context: debugInlineValueContext,
    editor,
    model: currentModel,
    monaco,
    workspaceRoot: rootPath,
  });
  useJsTestProblemEditorDecorations({
    activeDocument,
    currentFileIdentity,
    editor,
    model: currentModel,
    monaco,
    rootPath,
    snapshot: problemSnapshot,
  });
  useEditorSurfaceCoverageDecorations({
    activeDocument,
    currentModel,
    editor,
    jsTestCoverageReport,
    monaco,
    phpCoverageActiveOwner,
    phpCoveragePublication,
    rootPath,
    workspaceId,
  });
}
