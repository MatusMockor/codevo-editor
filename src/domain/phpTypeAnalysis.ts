export function phpMethodReturnExpressions(
  source: string,
  methodName: string,
): string[] {
  const pattern = new RegExp(
    `\\bfunction\\s+&?\\s*${escapeRegExp(methodName)}\\s*\\(`,
    "g",
  );
  const expressions: string[] = [];

  for (const match of source.matchAll(pattern)) {
    const parametersStart = (match.index ?? 0) + match[0].length - 1;
    const parametersEnd = matchingPairOffset(source, parametersStart, "(", ")");

    if (parametersEnd === null) {
      continue;
    }

    const bodyStart = source.indexOf("{", parametersEnd);

    if (bodyStart < 0) {
      continue;
    }

    const bodyEnd = matchingPairOffset(source, bodyStart, "{", "}");

    if (bodyEnd === null) {
      continue;
    }

    expressions.push(
      ...topLevelReturnExpressions(source.slice(bodyStart + 1, bodyEnd)),
    );
  }

  return expressions;
}

export function phpDeclaredTypeCandidate(typeName: string): string | null {
  const normalized = typeName
    .trim()
    .replace(/\b(?:public|protected|private|readonly|static)\b/g, " ")
    .trim()
    .replace(/^\?/, "")
    .replace(/\[\]$/, "")
    .replace(/^\\+/, "");
  const candidate = splitPhpTypeUnion(normalized)
    .map((part) => part.trim().replace(/^\?/, "").replace(/^\\+/, ""))
    .map((part) => phpTypeBaseCandidate(part) ?? phpTypeGenericCandidate(part))
    .find((part) => part && !isPhpBuiltinType(part));

  return candidate ?? null;
}

export function phpDeclaredGenericTypeCandidates(typeName: string): string[] {
  return splitPhpTypeUnion(typeName)
    .flatMap((part) => phpGenericArguments(part))
    .map((part) => phpDeclaredTypeCandidate(part))
    .filter((part): part is string => Boolean(part));
}

function topLevelReturnExpressions(body: string): string[] {
  const expressions: string[] = [];
  let quote: string | null = null;
  let depth = 0;

  for (const match of body.matchAll(/\breturn\b/g)) {
    const returnOffset = match.index ?? 0;

    if (!isTopLevelKeywordOffset(body, returnOffset)) {
      continue;
    }

    let start = returnOffset + match[0].length;

    while (/\s/.test(body[start] || "")) {
      start += 1;
    }

    quote = null;
    depth = 0;

    for (let index = start; index < body.length; index += 1) {
      const character = body[index] || "";

      if (quote) {
        if (character === "\\" && quote !== "`") {
          index += 1;
          continue;
        }

        if (character === quote) {
          quote = null;
        }

        continue;
      }

      if (character === "'" || character === "\"" || character === "`") {
        quote = character;
        continue;
      }

      if (character === "(" || character === "[" || character === "{") {
        depth += 1;
        continue;
      }

      if (character === ")" || character === "]" || character === "}") {
        depth = Math.max(0, depth - 1);
        continue;
      }

      if (character !== ";" || depth > 0) {
        continue;
      }

      const expression = body.slice(start, index).trim();

      if (expression) {
        expressions.push(expression);
      }

      break;
    }
  }

  return expressions;
}

function isTopLevelKeywordOffset(source: string, offset: number): boolean {
  let quote: string | null = null;
  let depth = 0;

  for (let index = 0; index < offset; index += 1) {
    const character = source[index] || "";

    if (quote) {
      if (character === "\\" && quote !== "`") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
      quote = character;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
    }
  }

  return depth === 0;
}

function matchingPairOffset(
  source: string,
  openOffset: number,
  open: string,
  close: string,
): number | null {
  let quote: string | null = null;
  let depth = 0;

  for (let index = openOffset; index < source.length; index += 1) {
    const character = source[index] || "";

    if (quote) {
      if (character === "\\" && quote !== "`") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
      quote = character;
      continue;
    }

    if (character === open) {
      depth += 1;
      continue;
    }

    if (character !== close) {
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return index;
    }
  }

  return null;
}

function isPhpBuiltinType(typeName: string | undefined): boolean {
  const normalized = typeName?.replace(/^\\+/, "").toLowerCase();

  return (
    !normalized ||
    [
      "array",
      "bool",
      "callable",
      "false",
      "float",
      "int",
      "iterable",
      "mixed",
      "never",
      "null",
      "object",
      "string",
      "true",
      "void",
    ].includes(normalized)
  );
}

function splitPhpTypeUnion(typeName: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;

  for (let index = 0; index < typeName.length; index += 1) {
    const character = typeName[index] || "";

    if (character === "<" || character === "(" || character === "[") {
      depth += 1;
      continue;
    }

    if (character === ">" || character === ")" || character === "]") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if ((character === "|" || character === "&") && depth === 0) {
      parts.push(typeName.slice(start, index).trim());
      start = index + 1;
    }
  }

  parts.push(typeName.slice(start).trim());
  return parts.filter(Boolean);
}

function phpTypeBaseCandidate(typeName: string): string | null {
  const normalized = typeName
    .trim()
    .replace(/\[\]$/, "")
    .replace(/^\\+/, "");
  const genericStart = normalized.indexOf("<");
  const base = genericStart >= 0 ? normalized.slice(0, genericStart) : normalized;

  if (!base || isPhpBuiltinType(base)) {
    return null;
  }

  return base;
}

function phpTypeGenericCandidate(typeName: string): string | null {
  return phpGenericArguments(typeName)
    .map((argument) => phpDeclaredTypeCandidate(argument))
    .find((argument): argument is string => Boolean(argument)) ?? null;
}

function phpGenericArguments(typeName: string): string[] {
  const start = typeName.indexOf("<");

  if (start < 0) {
    return [];
  }

  let depth = 0;

  for (let index = start; index < typeName.length; index += 1) {
    const character = typeName[index] || "";

    if (character === "<") {
      depth += 1;
      continue;
    }

    if (character !== ">") {
      continue;
    }

    depth -= 1;

    if (depth !== 0) {
      continue;
    }

    return splitPhpTypeList(typeName.slice(start + 1, index));
  }

  return [];
}

function splitPhpTypeList(typeList: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;

  for (let index = 0; index < typeList.length; index += 1) {
    const character = typeList[index] || "";

    if (character === "<" || character === "(" || character === "[") {
      depth += 1;
      continue;
    }

    if (character === ">" || character === ")" || character === "]") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (character !== "," || depth > 0) {
      continue;
    }

    parts.push(typeList.slice(start, index).trim());
    start = index + 1;
  }

  parts.push(typeList.slice(start).trim());
  return parts.filter(Boolean);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
