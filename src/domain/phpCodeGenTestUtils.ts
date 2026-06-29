import {
  detectClassMemberIndent,
  findClassBodyInsertionOffset,
  indentLines,
} from "./phpInsertionPoint";

export function insertGeneratedClassMemberForTest(
  source: string,
  block: string,
): string {
  const insertionPoint = findClassBodyInsertionOffset(source);

  if (!insertionPoint) {
    throw new Error("class insertion point not found");
  }

  const leadingBlankLine = insertionPoint.needsLeadingBlankLine ? "\n" : "";
  const trailingBlankLine = insertionPoint.needsTrailingBlankLine ? "\n" : "";
  const text = `${leadingBlankLine}${indentLines(
    block,
    detectClassMemberIndent(source),
  )}\n${trailingBlankLine}`;

  return (
    source.slice(0, insertionPoint.offset) +
    text +
    source.slice(insertionPoint.offset)
  );
}
