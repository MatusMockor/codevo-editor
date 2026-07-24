import type * as Monaco from "monaco-editor";
import type { JsTestCoverageReport } from "../domain/jsTestCoverage";
import { isDirty, type EditorDocument } from "../domain/workspace";
import { useJsTestCoverageEditorDecorations } from "./useJsTestCoverageEditorDecorations";
import type { PrecomputedCoverageDecorationOwner } from "./usePrecomputedCoverageEditorDecorations";
import {
  usePhpCoverageEditorDecorations,
  type PhpCoverageEditorDecorationPublication,
} from "./usePhpCoverageEditorDecorations";

export interface EditorSurfaceCoverageProps {
  readonly jsTestCoverageReport?: JsTestCoverageReport | null;
  readonly phpCoverageActiveOwner?: PrecomputedCoverageDecorationOwner | null;
  readonly phpCoveragePublication?: PhpCoverageEditorDecorationPublication | null;
}

interface EditorSurfaceCoverageDecorationOptions {
  readonly activeDocument: EditorDocument | null;
  readonly currentModel: Monaco.editor.ITextModel | null;
  readonly editor: Monaco.editor.IStandaloneCodeEditor | null;
  readonly jsTestCoverageReport: JsTestCoverageReport | null;
  readonly monaco: typeof Monaco | null;
  readonly phpCoverageActiveOwner: PrecomputedCoverageDecorationOwner | null | undefined;
  readonly phpCoveragePublication: PhpCoverageEditorDecorationPublication | null | undefined;
  readonly rootPath: string | null;
  readonly workspaceId: string | null;
}

/** Keeps coverage presentation policy outside the already-large editor surface. */
export function useEditorSurfaceCoverageDecorations({
  activeDocument,
  currentModel,
  editor,
  jsTestCoverageReport,
  monaco,
  phpCoverageActiveOwner,
  phpCoveragePublication,
  rootPath,
  workspaceId,
}: EditorSurfaceCoverageDecorationOptions): void {
  useJsTestCoverageEditorDecorations({
    activeDocument,
    editor,
    monaco,
    report: jsTestCoverageReport,
    rootPath,
    workspaceId,
  });
  const phpModel =
    activeDocument?.language === "php" && !isDirty(activeDocument) ? currentModel : null;
  usePhpCoverageEditorDecorations({
    activeOwner: phpModel ? (phpCoverageActiveOwner ?? null) : null,
    editor,
    model: phpModel,
    monaco,
    publication: phpCoveragePublication ?? null,
  });
}
