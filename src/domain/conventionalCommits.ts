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

  if (/[:\s]/.test(firstLine)) {
    return [];
  }

  const prefix = firstLine.toLowerCase();
  return CONVENTIONAL_COMMIT_TYPES.filter((type) => type.startsWith(prefix));
}

export function completeConventionalType(
  message: string,
  type: ConventionalCommitType,
): string {
  const rest = message.replace(/^[^:\s]*(?::)?[ \t]*/, "");
  return `${type}: ${rest}`;
}
