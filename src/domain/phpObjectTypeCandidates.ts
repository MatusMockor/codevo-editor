const PHP_NON_OBJECT_TYPE_NAMES = new Set([
  "array",
  "array-key",
  "binary",
  "bool",
  "boolean",
  "callable",
  "double",
  "false",
  "float",
  "int",
  "integer",
  "iterable",
  "list",
  "mixed",
  "never",
  "null",
  "numeric",
  "object",
  "real",
  "resource",
  "scalar",
  "string",
  "true",
  "void",
]);

const PHP_CLASS_TYPE_PATTERN =
  /^\\?[A-Za-z_][A-Za-z0-9_]*(?:\\[A-Za-z_][A-Za-z0-9_]*)*$/;

export function phpObjectTypeCandidates(
  typeName: string | null,
): string[] {
  const normalizedTypeName = typeName?.trim() ?? "";

  if (!normalizedTypeName) {
    return [];
  }

  if (normalizedTypeName.includes("&")) {
    return [];
  }

  const unionMembers = splitTopLevelPhpUnionTypes(normalizedTypeName);

  if (!unionMembers) {
    return [];
  }

  const candidates = new Map<string, string>();

  for (const unionMember of unionMembers) {
    const trimmedMember = unionMember.trim();
    const candidate =
      unionMembers.length === 1 && trimmedMember.startsWith("?")
        ? trimmedMember.slice(1).trim()
        : trimmedMember;

    if (PHP_NON_OBJECT_TYPE_NAMES.has(candidate.toLowerCase())) {
      continue;
    }

    if (!PHP_CLASS_TYPE_PATTERN.test(candidate)) {
      return [];
    }

    const key = candidate.replace(/^\\/, "").toLowerCase();

    if (!candidates.has(key)) {
      candidates.set(key, candidate);
    }
  }

  return Array.from(candidates.values());
}

function splitTopLevelPhpUnionTypes(typeName: string): string[] | null {
  const closingDelimiterFor: Record<string, string> = {
    "(": ")",
    "<": ">",
    "[": "]",
    "{": "}",
  };
  const closingDelimiters = new Set(Object.values(closingDelimiterFor));
  const delimiterStack: string[] = [];
  const members: string[] = [];
  let memberStart = 0;
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < typeName.length; index += 1) {
    const character = typeName[index] ?? "";

    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    const closingDelimiter = closingDelimiterFor[character];

    if (closingDelimiter) {
      delimiterStack.push(closingDelimiter);
      continue;
    }

    if (closingDelimiters.has(character)) {
      if (delimiterStack.pop() !== character) {
        return null;
      }

      continue;
    }

    if (character !== "|" || delimiterStack.length > 0) {
      continue;
    }

    members.push(typeName.slice(memberStart, index));
    memberStart = index + 1;
  }

  if (quote || delimiterStack.length > 0) {
    return null;
  }

  members.push(typeName.slice(memberStart));

  return members;
}
