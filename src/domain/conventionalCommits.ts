export const CONVENTIONAL_COMMIT_TYPES = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
] as const;

export type ConventionalCommitType = (typeof CONVENTIONAL_COMMIT_TYPES)[number];

export function matchConventionalCommitTypes(
  firstLine: string,
): ConventionalCommitType[] {
  if (firstLine.length === 0) {
    return [];
  }

  if (firstLine.includes(":")) {
    return [];
  }

  const typeEnd = firstLine.search(/[(!\s]/);
  const prefixEnd = typeEnd === -1 ? firstLine.length : typeEnd;
  const suffix = firstLine.slice(prefixEnd);
  if (suffix.length > 0 && !suffix.startsWith("(") && !suffix.startsWith("!")) {
    return [];
  }

  const prefix = firstLine.slice(0, prefixEnd).toLowerCase();
  return CONVENTIONAL_COMMIT_TYPES.filter((type) => type.startsWith(prefix));
}

export function completeConventionalType(
  message: string,
  type: ConventionalCommitType,
): string {
  const lineBreakIndex = message.search(/\r?\n/);
  const firstLineEnd = lineBreakIndex === -1 ? message.length : lineBreakIndex;
  const firstLine = message.slice(0, firstLineEnd);
  const body = message.slice(firstLineEnd);
  const typeEnd = firstLine.search(/[(:!\s]/);
  let cursor = typeEnd === -1 ? firstLine.length : typeEnd;
  let decoration = "";

  if (firstLine[cursor] === "(") {
    const scopeEnd = firstLine.indexOf(")", cursor + 1);
    if (scopeEnd !== -1) {
      decoration = firstLine.slice(cursor, scopeEnd + 1);
      cursor = scopeEnd + 1;
    }

    if (scopeEnd === -1) {
      const subjectOffset = firstLine.slice(cursor).search(/[ \t]/);
      cursor = subjectOffset === -1 ? firstLine.length : cursor + subjectOffset;
    }
  }

  if (firstLine[cursor] === "!") {
    decoration += "!";
    cursor += 1;
  }

  if (firstLine[cursor] === ":") {
    cursor += 1;
  }

  while (firstLine[cursor] === " " || firstLine[cursor] === "\t") {
    cursor += 1;
  }

  return `${type}${decoration}: ${firstLine.slice(cursor)}${body}`;
}
