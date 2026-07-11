import type * as Monaco from "monaco-editor";
import {
  parseConflictMarkers,
  type ConflictMarkerBlock,
  type ConflictMarkerTextRange,
} from "../domain/conflictMarkers";

export const CONFLICT_MARKER_COMMAND_ID = "mockor.acceptConflictMarker";

export type ConflictMarkerAcceptVariant = "both" | "current" | "incoming";

export interface ConflictMarkerCodeActionRequest {
  blockEndOffset: number;
  blockStartOffset: number;
  expectedBlock: string;
  modelUri: string;
  variant: ConflictMarkerAcceptVariant;
}

interface ConflictMarkerActionDefinition {
  title: string;
  variant: ConflictMarkerAcceptVariant;
}

const ACTION_DEFINITIONS: readonly ConflictMarkerActionDefinition[] = [
  { title: "Accept Current", variant: "current" },
  { title: "Accept Incoming", variant: "incoming" },
  { title: "Accept Both", variant: "both" },
];

export function registerConflictMarkerCodeActions(
  monaco: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor,
): Monaco.IDisposable[] {
  const provider = monaco.languages.registerCodeActionProvider("*", {
    provideCodeActions: (model, range) =>
      provideConflictMarkerCodeActions(model, range),
  });
  const command = monaco.editor.addCommand({
    id: CONFLICT_MARKER_COMMAND_ID,
    run: (_accessor, request: unknown) => {
      if (!isConflictMarkerCodeActionRequest(request)) {
        return;
      }

      applyConflictMarkerCodeAction(monaco, editor, request);
    },
  });

  return [provider, command];
}

export function provideConflictMarkerCodeActions(
  model: Monaco.editor.ITextModel,
  range: Monaco.Range,
): Monaco.languages.CodeActionList {
  const text = model.getValue();
  const requestStartOffset = model.getOffsetAt({
    column: range.startColumn,
    lineNumber: range.startLineNumber,
  });
  const requestEndOffset = model.getOffsetAt({
    column: range.endColumn,
    lineNumber: range.endLineNumber,
  });
  const blocks = parseConflictMarkers(text).filter((block) =>
    offsetsIntersect(
      requestStartOffset,
      requestEndOffset,
      block.block.startOffset,
      block.block.endOffset,
    ),
  );

  return {
    actions: blocks.flatMap((block) =>
      ACTION_DEFINITIONS.map((definition) => ({
        command: {
          arguments: [codeActionRequest(model, text, block, definition.variant)],
          id: CONFLICT_MARKER_COMMAND_ID,
          title: definition.title,
        },
        kind: "quickfix",
        title: definition.title,
      })),
    ),
    dispose: () => undefined,
  };
}

export function conflictMarkerDecorations(
  model: Monaco.editor.ITextModel,
): Monaco.editor.IModelDeltaDecoration[] {
  return parseConflictMarkers(model.getValue()).flatMap((block) => {
    const markers = [
      lineDecoration(
        block.currentMarker,
        "conflict-marker-line conflict-marker-current",
      ),
      ...(block.baseMarker
        ? [lineDecoration(block.baseMarker, "conflict-marker-line")]
        : []),
      lineDecoration(block.separatorMarker, "conflict-marker-line"),
      lineDecoration(
        block.incomingMarker,
        "conflict-marker-line conflict-marker-incoming",
      ),
    ];
    const sections = [
      sectionDecoration(block.ours, "conflict-marker-current"),
      ...(block.base
        ? [sectionDecoration(block.base, "conflict-marker-base")]
        : []),
      sectionDecoration(block.theirs, "conflict-marker-incoming"),
    ].filter(
      (decoration): decoration is Monaco.editor.IModelDeltaDecoration =>
        decoration !== null,
    );

    return [...markers, ...sections];
  });
}

export function applyConflictMarkerCodeAction(
  monaco: typeof Monaco,
  editor: Monaco.editor.ICodeEditor,
  request: ConflictMarkerCodeActionRequest,
): boolean {
  const model = editor.getModel();

  if (!model || model.uri.toString() !== request.modelUri) {
    return false;
  }

  const text = model.getValue();
  const currentBlockText = text.slice(
    request.blockStartOffset,
    request.blockEndOffset,
  );

  if (currentBlockText !== request.expectedBlock) {
    return false;
  }

  const block = parseConflictMarkers(text).find(
    (candidate) =>
      candidate.block.startOffset === request.blockStartOffset &&
      candidate.block.endOffset === request.blockEndOffset,
  );

  if (!block) {
    return false;
  }

  const start = model.getPositionAt(block.block.startOffset);
  const end = model.getPositionAt(block.block.endOffset);
  editor.executeEdits(CONFLICT_MARKER_COMMAND_ID, [
    {
      forceMoveMarkers: true,
      range: new monaco.Range(
        start.lineNumber,
        start.column,
        end.lineNumber,
        end.column,
      ),
      text: block.replacements[request.variant],
    },
  ]);

  return true;
}

function codeActionRequest(
  model: Monaco.editor.ITextModel,
  text: string,
  block: ConflictMarkerBlock,
  variant: ConflictMarkerAcceptVariant,
): ConflictMarkerCodeActionRequest {
  return {
    blockEndOffset: block.block.endOffset,
    blockStartOffset: block.block.startOffset,
    expectedBlock: text.slice(block.block.startOffset, block.block.endOffset),
    modelUri: model.uri.toString(),
    variant,
  };
}

function offsetsIntersect(
  requestStartOffset: number,
  requestEndOffset: number,
  blockStartOffset: number,
  blockEndOffset: number,
): boolean {
  if (requestStartOffset === requestEndOffset) {
    return (
      requestStartOffset >= blockStartOffset &&
      requestStartOffset < blockEndOffset
    );
  }

  return (
    requestStartOffset < blockEndOffset && requestEndOffset > blockStartOffset
  );
}

function lineDecoration(
  range: ConflictMarkerTextRange,
  className: string,
): Monaco.editor.IModelDeltaDecoration {
  return {
    options: {
      className,
      isWholeLine: true,
    },
    range: lineRange(range.startLineNumber, range.endLineNumber),
  };
}

function sectionDecoration(
  range: ConflictMarkerTextRange,
  className: string,
): Monaco.editor.IModelDeltaDecoration | null {
  if (range.startOffset === range.endOffset) {
    return null;
  }

  return lineDecoration(range, className);
}

function lineRange(
  startLineNumber: number,
  endLineNumber: number,
): Monaco.IRange {
  return {
    endColumn: 1,
    endLineNumber,
    startColumn: 1,
    startLineNumber,
  };
}

function isConflictMarkerCodeActionRequest(
  value: unknown,
): value is ConflictMarkerCodeActionRequest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const request = value as Partial<ConflictMarkerCodeActionRequest>;

  return (
    typeof request.blockEndOffset === "number" &&
    typeof request.blockStartOffset === "number" &&
    typeof request.expectedBlock === "string" &&
    typeof request.modelUri === "string" &&
    (request.variant === "both" ||
      request.variant === "current" ||
      request.variant === "incoming")
  );
}
