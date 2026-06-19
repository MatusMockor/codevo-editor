export interface EditorSelectionTextRange {
  end: number;
  start: number;
}

export function nextEditorSelectionExpansionRange(
  line: string,
  offset: number,
  currentRange: EditorSelectionTextRange,
): EditorSelectionTextRange | null {
  return (
    editorSelectionExpansionRanges(line, offset).find(
      (candidate) =>
        containsEditorTextRange(candidate, currentRange) &&
        editorTextRangeLength(candidate) > editorTextRangeLength(currentRange),
    ) ?? null
  );
}

export function editorSelectionExpansionRanges(
  line: string,
  offset: number,
): EditorSelectionTextRange[] {
  const identifier = identifierRangeAtOffset(line, offset);

  if (!identifier) {
    return [];
  }

  const callOrIdentifier = callRangeFromIdentifier(line, identifier) ?? identifier;
  const expression = expressionRangeAround(line, callOrIdentifier);
  const statement = statementRangeAround(line, expression);

  return uniqueEditorTextRanges([identifier, expression, statement])
    .filter((range) => range.end > range.start)
    .sort((left, right) => editorTextRangeLength(left) - editorTextRangeLength(right));
}

function identifierRangeAtOffset(
  line: string,
  offset: number,
): EditorSelectionTextRange | null {
  if (!line) {
    return null;
  }

  let index = Math.max(0, Math.min(offset, line.length - 1));

  if (!isIdentifierCharacter(line[index]) && index > 0 && isIdentifierCharacter(line[index - 1])) {
    index -= 1;
  }

  if (!isIdentifierCharacter(line[index])) {
    return null;
  }

  let start = index;
  let end = index + 1;

  while (start > 0 && isIdentifierCharacter(line[start - 1])) {
    start -= 1;
  }

  while (end < line.length && isIdentifierCharacter(line[end])) {
    end += 1;
  }

  if (start > 0 && line[start - 1] === "$") {
    start -= 1;
  }

  return { end, start };
}

function callRangeFromIdentifier(
  line: string,
  identifier: EditorSelectionTextRange,
): EditorSelectionTextRange | null {
  const openParen = skipWhitespaceRight(line, identifier.end);

  if (line[openParen] !== "(") {
    return null;
  }

  const closeParen = findMatchingForward(line, openParen, "(", ")");

  if (closeParen === null) {
    return null;
  }

  return { end: closeParen + 1, start: identifier.start };
}

function expressionRangeAround(
  line: string,
  range: EditorSelectionTextRange,
): EditorSelectionTextRange {
  let expression = { ...range };

  while (true) {
    const operator = memberOperatorBefore(line, expression.start);

    if (!operator) {
      break;
    }

    const operand = operandRangeBefore(line, operator.start);

    if (!operand) {
      break;
    }

    expression = { end: expression.end, start: operand.start };
  }

  while (true) {
    const operator = memberOperatorAfter(line, expression.end);

    if (!operator) {
      break;
    }

    const operand = operandRangeAfter(line, operator.end);

    if (!operand) {
      break;
    }

    expression = { end: operand.end, start: expression.start };
  }

  return expression;
}

function statementRangeAround(
  line: string,
  range: EditorSelectionTextRange,
): EditorSelectionTextRange {
  const statementStart = skipWhitespaceRight(
    line,
    Math.max(
      line.lastIndexOf(";", range.start - 1),
      line.lastIndexOf("{", range.start - 1),
      line.lastIndexOf("}", range.start - 1),
    ) + 1,
  );
  const semicolon = line.indexOf(";", range.end);
  const statementEnd = semicolon === -1 ? range.end : semicolon + 1;

  return statementEnd > statementStart
    ? { end: statementEnd, start: statementStart }
    : range;
}

function memberOperatorBefore(
  line: string,
  start: number,
): EditorSelectionTextRange | null {
  const index = skipWhitespaceLeft(line, start);
  const candidates: Array<[string, number]> = [
    ["?->", 3],
    ["->", 2],
    ["::", 2],
    ["?.", 2],
    [".", 1],
  ];

  for (const [operator, length] of candidates) {
    if (line.slice(index - length, index) === operator) {
      return { end: index, start: index - length };
    }
  }

  return null;
}

function memberOperatorAfter(line: string, end: number): EditorSelectionTextRange | null {
  const index = skipWhitespaceRight(line, end);
  const candidates = ["?->", "->", "::", "?.", "."];
  const operator = candidates.find((candidate) =>
    line.startsWith(candidate, index),
  );

  return operator ? { end: index + operator.length, start: index } : null;
}

function operandRangeBefore(line: string, end: number): EditorSelectionTextRange | null {
  const operandEnd = skipWhitespaceLeft(line, end);

  if (operandEnd <= 0) {
    return null;
  }

  const lastCharacter = line[operandEnd - 1];

  if (lastCharacter === ")" || lastCharacter === "]") {
    const openIndex = findMatchingBackward(
      line,
      operandEnd - 1,
      lastCharacter === ")" ? "(" : "[",
      lastCharacter,
    );

    if (openIndex === null) {
      return null;
    }

    const callee = identifierRangeEndingAt(line, openIndex);
    const start = callee?.start ?? openIndex;
    return expressionRangeAround(line, { end: operandEnd, start });
  }

  return identifierRangeEndingAt(line, operandEnd);
}

function operandRangeAfter(line: string, start: number): EditorSelectionTextRange | null {
  const operandStart = skipWhitespaceRight(line, start);
  const identifier = identifierRangeStartingAt(line, operandStart);

  if (!identifier) {
    return null;
  }

  return callRangeFromIdentifier(line, identifier) ?? identifier;
}

function identifierRangeEndingAt(
  line: string,
  end: number,
): EditorSelectionTextRange | null {
  let cursor = end;

  while (cursor > 0 && isIdentifierCharacter(line[cursor - 1])) {
    cursor -= 1;
  }

  if (cursor === end) {
    return null;
  }

  if (cursor > 0 && line[cursor - 1] === "$") {
    cursor -= 1;
  }

  return { end, start: cursor };
}

function identifierRangeStartingAt(
  line: string,
  start: number,
): EditorSelectionTextRange | null {
  let cursor = start;

  if (line[cursor] === "$") {
    cursor += 1;
  }

  if (!isIdentifierCharacter(line[cursor])) {
    return null;
  }

  while (cursor < line.length && isIdentifierCharacter(line[cursor])) {
    cursor += 1;
  }

  return { end: cursor, start };
}

function findMatchingForward(
  line: string,
  openIndex: number,
  openCharacter: string,
  closeCharacter: string,
): number | null {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let index = openIndex; index < line.length; index += 1) {
    const character = line[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }

    if (character === openCharacter) {
      depth += 1;
    } else if (character === closeCharacter) {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return null;
}

function findMatchingBackward(
  line: string,
  closeIndex: number,
  openCharacter: string,
  closeCharacter: string,
): number | null {
  let depth = 0;

  for (let index = closeIndex; index >= 0; index -= 1) {
    const character = line[index];

    if (character === closeCharacter) {
      depth += 1;
    } else if (character === openCharacter) {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return null;
}

function skipWhitespaceLeft(line: string, index: number): number {
  let cursor = Math.max(0, Math.min(index, line.length));

  while (cursor > 0 && /\s/.test(line[cursor - 1])) {
    cursor -= 1;
  }

  return cursor;
}

function skipWhitespaceRight(line: string, index: number): number {
  let cursor = Math.max(0, Math.min(index, line.length));

  while (cursor < line.length && /\s/.test(line[cursor])) {
    cursor += 1;
  }

  return cursor;
}

function containsEditorTextRange(
  range: EditorSelectionTextRange,
  current: EditorSelectionTextRange,
): boolean {
  return range.start <= current.start && range.end >= current.end;
}

function editorTextRangeLength(range: EditorSelectionTextRange): number {
  return range.end - range.start;
}

function uniqueEditorTextRanges(
  ranges: EditorSelectionTextRange[],
): EditorSelectionTextRange[] {
  const seen = new Set<string>();
  const unique: EditorSelectionTextRange[] = [];

  for (const range of ranges) {
    const key = `${range.start}:${range.end}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(range);
  }

  return unique;
}

function isIdentifierCharacter(character: string | undefined): boolean {
  return Boolean(character && /[A-Za-z0-9_$]/.test(character));
}
