export interface ConflictMarkerTextRange {
  endLineNumber: number;
  endOffset: number;
  startLineNumber: number;
  startOffset: number;
}

export interface ConflictMarkerReplacements {
  both: string;
  current: string;
  incoming: string;
}

export interface ConflictMarkerBlock {
  base: ConflictMarkerTextRange | null;
  baseMarker?: ConflictMarkerTextRange;
  block: ConflictMarkerTextRange;
  currentMarker: ConflictMarkerTextRange;
  incomingMarker: ConflictMarkerTextRange;
  ours: ConflictMarkerTextRange;
  replacements: ConflictMarkerReplacements;
  separatorMarker: ConflictMarkerTextRange;
  theirs: ConflictMarkerTextRange;
}

interface SourceLine {
  content: string;
  endOffsetIncludingBreak: number;
  lineNumber: number;
  startOffset: number;
}

interface PendingConflict {
  baseMarker: SourceLine | null;
  currentMarker: SourceLine;
  separatorMarker: SourceLine | null;
}

const CURRENT_MARKER = "<<<<<<<";
const BASE_MARKER = "|||||||";
const SEPARATOR_MARKER = "=======";
const INCOMING_MARKER = ">>>>>>>";

export function parseConflictMarkers(text: string): ConflictMarkerBlock[] {
  const lines = sourceLines(text);
  const blocks: ConflictMarkerBlock[] = [];
  let pending: PendingConflict | null = null;

  for (const line of lines) {
    if (isMarkerLine(line.content, CURRENT_MARKER)) {
      pending = {
        baseMarker: null,
        currentMarker: line,
        separatorMarker: null,
      };
      continue;
    }

    if (!pending) {
      continue;
    }

    if (
      !pending.separatorMarker &&
      !pending.baseMarker &&
      isMarkerLine(line.content, BASE_MARKER)
    ) {
      pending.baseMarker = line;
      continue;
    }

    if (
      !pending.separatorMarker &&
      isMarkerLine(line.content, SEPARATOR_MARKER)
    ) {
      pending.separatorMarker = line;
      continue;
    }

    if (
      !pending.separatorMarker ||
      !isMarkerLine(line.content, INCOMING_MARKER)
    ) {
      continue;
    }

    blocks.push(conflictBlock(text, pending, line));
    pending = null;
  }

  return blocks;
}

function conflictBlock(
  text: string,
  pending: PendingConflict,
  incomingMarker: SourceLine,
): ConflictMarkerBlock {
  const separatorMarker = pending.separatorMarker;

  if (!separatorMarker) {
    throw new Error("A completed conflict requires a separator marker.");
  }

  const oursEnd = pending.baseMarker?.startOffset ?? separatorMarker.startOffset;
  const oursEndLine = (pending.baseMarker ?? separatorMarker).lineNumber - 1;
  const ours = textRange(
    pending.currentMarker.endOffsetIncludingBreak,
    oursEnd,
    pending.currentMarker.lineNumber + 1,
    oursEndLine,
  );
  const base = pending.baseMarker
    ? textRange(
        pending.baseMarker.endOffsetIncludingBreak,
        separatorMarker.startOffset,
        pending.baseMarker.lineNumber + 1,
        separatorMarker.lineNumber - 1,
      )
    : null;
  const theirs = textRange(
    separatorMarker.endOffsetIncludingBreak,
    incomingMarker.startOffset,
    separatorMarker.lineNumber + 1,
    incomingMarker.lineNumber - 1,
  );
  const current = text.slice(ours.startOffset, ours.endOffset);
  const incoming = text.slice(theirs.startOffset, theirs.endOffset);

  return {
    base,
    ...(pending.baseMarker
      ? { baseMarker: markerRange(pending.baseMarker) }
      : {}),
    block: textRange(
      pending.currentMarker.startOffset,
      incomingMarker.endOffsetIncludingBreak,
      pending.currentMarker.lineNumber,
      incomingMarker.lineNumber,
    ),
    currentMarker: markerRange(pending.currentMarker),
    incomingMarker: markerRange(incomingMarker),
    ours,
    replacements: {
      both: current + incoming,
      current,
      incoming,
    },
    separatorMarker: markerRange(separatorMarker),
    theirs,
  };
}

function markerRange(line: SourceLine): ConflictMarkerTextRange {
  return textRange(
    line.startOffset,
    line.endOffsetIncludingBreak,
    line.lineNumber,
    line.lineNumber,
  );
}

function textRange(
  startOffset: number,
  endOffset: number,
  startLineNumber: number,
  endLineNumber: number,
): ConflictMarkerTextRange {
  return {
    endLineNumber,
    endOffset,
    startLineNumber,
    startOffset,
  };
}

function isMarkerLine(content: string, marker: string): boolean {
  if (!content.startsWith(marker)) {
    return false;
  }

  return content.length === marker.length || content[marker.length] === " ";
}

function sourceLines(text: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let lineNumber = 1;
  let startOffset = 0;

  while (startOffset < text.length) {
    const lineFeedOffset = text.indexOf("\n", startOffset);

    if (lineFeedOffset < 0) {
      lines.push({
        content: text.slice(startOffset),
        endOffsetIncludingBreak: text.length,
        lineNumber,
        startOffset,
      });
      break;
    }

    const hasCarriageReturn =
      lineFeedOffset > startOffset && text[lineFeedOffset - 1] === "\r";
    const endOffset = hasCarriageReturn ? lineFeedOffset - 1 : lineFeedOffset;
    lines.push({
      content: text.slice(startOffset, endOffset),
      endOffsetIncludingBreak: lineFeedOffset + 1,
      lineNumber,
      startOffset,
    });
    startOffset = lineFeedOffset + 1;
    lineNumber += 1;
  }

  return lines;
}
