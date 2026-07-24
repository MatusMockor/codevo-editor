import { useEffect, useRef } from "react";
import type * as Monaco from "monaco-editor";
import { modelPath } from "./phpMonacoDocumentContext";
import { toPrecomputedCoverageMonacoDecoration } from "./editorCoverageMonacoMappings";

export type PrecomputedCoverageLineStatus = "covered" | "uncovered";

export interface PrecomputedCoverageLineState {
  readonly hits: number;
  readonly lineNumber: number;
  readonly status: PrecomputedCoverageLineStatus;
}

export interface PrecomputedCoverageDecorationOwner {
  readonly ownerKey: string;
  readonly revision: number;
}

export interface PrecomputedCoverageDecorationPublication extends PrecomputedCoverageDecorationOwner {
  readonly documentPath: string;
  readonly lines: readonly PrecomputedCoverageLineState[];
}

export interface PrecomputedCoverageEditorDecorationOptions {
  readonly activeOwner: PrecomputedCoverageDecorationOwner | null;
  readonly editor: Monaco.editor.IStandaloneCodeEditor | null;
  readonly model: Monaco.editor.ITextModel | null;
  readonly modelMatchesDocument?: (
    model: Monaco.editor.ITextModel,
    documentPath: string,
  ) => boolean;
  readonly monaco: typeof Monaco | null;
  readonly publication: PrecomputedCoverageDecorationPublication | null;
  readonly toDecoration?: (
    monaco: typeof Monaco,
    line: PrecomputedCoverageLineState,
  ) => Monaco.editor.IModelDeltaDecoration;
}

/**
 * Presentation-only boundary for already projected coverage lines. Ownership,
 * publication revision and Monaco model/version are fenced before rendering;
 * this hook never reads or parses coverage artifacts.
 */
export function usePrecomputedCoverageEditorDecorations({
  activeOwner,
  editor,
  model,
  modelMatchesDocument = exactModelPathMatchesDocument,
  monaco,
  publication,
  toDecoration = toPrecomputedCoverageMonacoDecoration,
}: PrecomputedCoverageEditorDecorationOptions): void {
  const decorationIdsRef = useRef<string[]>([]);
  const publicationRef = useRef<object | null>(null);

  useEffect(() => {
    const token = Object.freeze({});
    publicationRef.current = token;
    if (
      !activeOwner ||
      !publication ||
      !validOwner(activeOwner) ||
      activeOwner.ownerKey !== publication.ownerKey ||
      activeOwner.revision !== publication.revision ||
      !editor ||
      !monaco ||
      !model ||
      editor.getModel() !== model ||
      model.isDisposed?.() ||
      !safeModelMatchesDocument(modelMatchesDocument, model, publication.documentPath)
    ) {
      return;
    }

    const modelVersion = typeof model.getVersionId === "function" ? model.getVersionId() : null;
    const lines = canonicalVisibleLines(publication.lines, model.getLineCount());
    decorationIdsRef.current = editor.deltaDecorations(
      decorationIdsRef.current,
      lines.map((line) => toDecoration(monaco, line)),
    );
    const clear = () => {
      if (publicationRef.current !== token) return;
      decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, []);
    };
    const contentSubscription = editor.onDidChangeModelContent(() => {
      if (
        editor.getModel() !== model ||
        model.isDisposed?.() ||
        modelVersion === null ||
        model.getVersionId() !== modelVersion
      ) {
        clear();
      }
    });
    const modelSubscription =
      typeof editor.onDidChangeModel === "function" ? editor.onDidChangeModel(clear) : null;

    return () => {
      contentSubscription.dispose();
      modelSubscription?.dispose();
      clear();
      if (publicationRef.current === token) publicationRef.current = null;
    };
  }, [activeOwner, editor, model, modelMatchesDocument, monaco, publication, toDecoration]);
}

function exactModelPathMatchesDocument(
  model: Monaco.editor.ITextModel,
  documentPath: string,
): boolean {
  return modelPath(model) === documentPath;
}

function safeModelMatchesDocument(
  matcher: (model: Monaco.editor.ITextModel, documentPath: string) => boolean,
  model: Monaco.editor.ITextModel,
  documentPath: string,
): boolean {
  try {
    return matcher(model, documentPath) === true;
  } catch {
    return false;
  }
}

function canonicalVisibleLines(
  lines: readonly PrecomputedCoverageLineState[],
  lineCount: number,
): readonly PrecomputedCoverageLineState[] {
  if (!Array.isArray(lines) || !Number.isSafeInteger(lineCount) || lineCount < 1) return [];
  if (lines.some((line) => !validLine(line, lineCount))) return [];
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index - 1]!.lineNumber >= lines[index]!.lineNumber) return [];
  }
  return lines;
}

function validOwner(owner: PrecomputedCoverageDecorationOwner): boolean {
  return (
    owner.ownerKey.trim().length > 0 && Number.isSafeInteger(owner.revision) && owner.revision >= 0
  );
}

function validLine(line: PrecomputedCoverageLineState, lineCount: number): boolean {
  return (
    line !== null &&
    typeof line === "object" &&
    Number.isSafeInteger(line.lineNumber) &&
    line.lineNumber >= 1 &&
    line.lineNumber <= lineCount &&
    Number.isSafeInteger(line.hits) &&
    line.hits >= 0 &&
    ((line.status === "covered" && line.hits > 0) ||
      (line.status === "uncovered" && line.hits === 0))
  );
}
