import type * as Monaco from "monaco-editor";
import type { PhpCoverageLineState } from "../domain/phpCoverageProjection";
import { phpCoverageModelMatchesDocument } from "./editorCoverageMonacoMappings";
import {
  usePrecomputedCoverageEditorDecorations,
  type PrecomputedCoverageDecorationOwner,
} from "./usePrecomputedCoverageEditorDecorations";

export interface PhpCoverageEditorDecorationPublication extends PrecomputedCoverageDecorationOwner {
  readonly documentPath: string;
  readonly lines: readonly PhpCoverageLineState[];
}

interface PhpCoverageEditorDecorationOptions {
  readonly activeOwner: PrecomputedCoverageDecorationOwner | null;
  readonly editor: Monaco.editor.IStandaloneCodeEditor | null;
  readonly model: Monaco.editor.ITextModel | null;
  readonly monaco: typeof Monaco | null;
  readonly publication: PhpCoverageEditorDecorationPublication | null;
}

/** Renders a precomputed PHP coverage projection without reading Clover data. */
export function usePhpCoverageEditorDecorations(options: PhpCoverageEditorDecorationOptions): void {
  usePrecomputedCoverageEditorDecorations({
    ...options,
    modelMatchesDocument: phpCoverageModelMatchesDocument,
  });
}
