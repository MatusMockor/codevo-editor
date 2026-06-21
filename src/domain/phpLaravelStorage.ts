import type { EditorPosition } from "./languageServerFeatures";

const laravelStorageDiskConfigPrefix = "filesystems.disks.";
const storageDiskCallMethods = {
  disk: "Storage::disk",
  drive: "Storage::drive",
  fake: "Storage::fake",
  persistentfake: "Storage::persistentFake",
} as const;

type StorageDiskMethodName = keyof typeof storageDiskCallMethods;

export type PhpLaravelStorageDiskReferenceCall =
  (typeof storageDiskCallMethods)[StorageDiskMethodName];

export interface PhpLaravelStorageDiskReferenceContext {
  call: PhpLaravelStorageDiskReferenceCall;
  diskName: string;
  position: EditorPosition;
  prefix: string;
}

interface PhpStringLiteral {
  closed: boolean;
  quote: "'" | "\"";
  quoteEnd: number;
  quoteStart: number;
  value: string;
}

interface PhpArgumentContext {
  argumentIndex: number;
  argumentName: string | null;
  openParen: number;
}

export function phpLaravelStorageDiskReferenceContextAt(
  source: string,
  position: EditorPosition,
): PhpLaravelStorageDiskReferenceContext | null {
  const offset = offsetAtPosition(source, position);
  const literal = stringLiteralAtOffset(source, offset);

  if (!literal) {
    return null;
  }

  const prefix = source.slice(
    literal.quoteStart + 1,
    Math.min(offset, literal.quoteEnd),
  );
  const diskName = literal.closed ? literal.value : prefix;

  if (!isUsableLaravelStorageDiskName(prefix) ||
    !isUsableLaravelStorageDiskName(diskName)
  ) {
    return null;
  }

  const argument = argumentContextAt(source, literal);

  if (!argument || !isStorageDiskArgument(argument) ||
    !isPhpCodeOffset(source, argument.openParen)
  ) {
    return null;
  }

  const call = laravelStorageDiskReferenceCallAt(source, argument);

  if (!call) {
    return null;
  }

  return {
    call,
    diskName,
    position: editorPositionAtOffset(source, literal.quoteStart + 1),
    prefix,
  };
}

export function phpLaravelStorageDiskConfigKey(diskName: string): string | null {
  return isUsableLaravelStorageDiskName(diskName)
    ? `${laravelStorageDiskConfigPrefix}${diskName}`
    : null;
}

export function phpLaravelStorageDiskNameFromConfigKey(
  configKey: string,
): string | null {
  if (!configKey.startsWith(laravelStorageDiskConfigPrefix)) {
    return null;
  }

  const diskName = configKey.slice(laravelStorageDiskConfigPrefix.length);

  return diskName.includes(".") || !isUsableLaravelStorageDiskName(diskName)
    ? null
    : diskName;
}

export function phpLaravelStorageDiskCompletionInsertText(
  diskName: string,
): string {
  return diskName;
}

export function isUsableLaravelStorageDiskName(diskName: string): boolean {
  return (
    diskName.length > 0 &&
    /^[A-Za-z0-9_.-]+$/.test(diskName) &&
    !diskName.startsWith(".") &&
    !diskName.endsWith(".") &&
    !diskName.includes("..")
  );
}

function laravelStorageDiskReferenceCallAt(
  source: string,
  argument: PhpArgumentContext,
): PhpLaravelStorageDiskReferenceCall | null {
  const beforeCall = source.slice(0, argument.openParen);
  const match = /\bStorage\s*::\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(
    beforeCall,
  );
  const methodName = match?.[1]?.toLowerCase() ?? null;

  if (!methodName || !isStorageDiskMethodName(methodName)) {
    return null;
  }

  return storageDiskCallMethods[methodName];
}

function isStorageDiskMethodName(
  methodName: string,
): methodName is StorageDiskMethodName {
  return methodName in storageDiskCallMethods;
}

function isStorageDiskArgument(argument: PhpArgumentContext): boolean {
  if (argument.argumentIndex === 0) {
    return true;
  }

  const argumentName = argument.argumentName?.toLowerCase();

  return argumentName === "name" || argumentName === "disk";
}

function argumentContextAt(
  source: string,
  literal: PhpStringLiteral,
): PhpArgumentContext | null {
  for (
    let openParen = source.lastIndexOf("(", literal.quoteStart);
    openParen >= 0;
    openParen = source.lastIndexOf("(", openParen - 1)
  ) {
    const closeParen = matchingBracketOffset(source, openParen, "(", ")");

    if (closeParen !== null && literal.quoteStart > closeParen) {
      continue;
    }

    const argumentIndex = topLevelArgumentIndexAtOffset(
      source,
      openParen,
      literal.quoteStart,
    );

    if (argumentIndex === null) {
      continue;
    }

    const argumentName = namedArgumentNameBeforeLiteral(
      source,
      openParen + 1,
      literal.quoteStart,
    );

    if (argumentName === undefined) {
      continue;
    }

    return { argumentIndex, argumentName, openParen };
  }

  return null;
}

function topLevelArgumentIndexAtOffset(
  source: string,
  openParenOffset: number,
  targetOffset: number,
): number | null {
  let argumentIndex = 0;
  let depth = 0;
  let quote: "'" | "\"" | null = null;

  for (let index = openParenOffset + 1; index < targetOffset; index += 1) {
    const character = source[index] ?? "";

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

    if (character === "'" || character === "\"") {
      quote = character;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth -= 1;

      if (depth < 0) {
        return null;
      }

      continue;
    }

    if (character === "," && depth === 0) {
      argumentIndex += 1;
    }
  }

  return quote || depth !== 0 ? null : argumentIndex;
}

function namedArgumentNameBeforeLiteral(
  source: string,
  argumentStart: number,
  literalStart: number,
): string | null | undefined {
  let depth = 0;
  let quote: "'" | "\"" | null = null;
  let lastColon = -1;

  for (let index = argumentStart; index < literalStart; index += 1) {
    const character = source[index] ?? "";

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

    if (character === "'" || character === "\"") {
      quote = character;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth -= 1;

      if (depth < 0) {
        return undefined;
      }

      continue;
    }

    if (character === ":" && depth === 0) {
      if (source[index + 1] === ":") {
        index += 1;
        continue;
      }

      lastColon = index;
    }
  }

  if (quote || depth !== 0) {
    return undefined;
  }

  if (lastColon < 0) {
    return null;
  }

  const beforeColon = source.slice(argumentStart, lastColon);
  const match = /([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(beforeColon);

  return match?.[1] ?? undefined;
}

function stringLiteralAtOffset(
  source: string,
  offset: number,
): PhpStringLiteral | null {
  let quote: "'" | "\"" | null = null;
  let quoteStart = -1;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";

    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }

      if (character !== quote) {
        continue;
      }

      if (offset > quoteStart && offset <= index) {
        const value = source.slice(quoteStart + 1, index);

        if (quote === "\"" && hasPhpVariableInterpolation(value)) {
          return null;
        }

        return {
          closed: true,
          quote,
          quoteEnd: index,
          quoteStart,
          value,
        };
      }

      quote = null;
      quoteStart = -1;
      continue;
    }

    if (character !== "'" && character !== "\"") {
      continue;
    }

    quote = character;
    quoteStart = index;
  }

  if (!quote || offset <= quoteStart) {
    return null;
  }

  const value = source.slice(quoteStart + 1);

  if (quote === "\"" && hasPhpVariableInterpolation(value)) {
    return null;
  }

  return {
    closed: false,
    quote,
    quoteEnd: source.length,
    quoteStart,
    value,
  };
}

function hasPhpVariableInterpolation(value: string): boolean {
  return /(^|[^\\])\$(?:[A-Za-z_]|[{])/.test(value);
}

function matchingBracketOffset(
  source: string,
  openOffset: number,
  open: "(" | "[" | "{",
  close: ")" | "]" | "}",
): number | null {
  let depth = 0;
  let quote: "'" | "\"" | null = null;

  for (let index = openOffset; index < source.length; index += 1) {
    const character = source[index] ?? "";

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

    if (character === "'" || character === "\"") {
      quote = character;
      continue;
    }

    if (character === open) {
      depth += 1;
      continue;
    }

    if (character === close) {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return null;
}

function isPhpCodeOffset(source: string, offset: number): boolean {
  let quote: "'" | "\"" | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < offset; index += 1) {
    const character = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
      }

      continue;
    }

    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }

      continue;
    }

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

    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }

    if (character === "#") {
      lineComment = true;
      continue;
    }

    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }

    if (character === "'" || character === "\"") {
      quote = character;
    }
  }

  return !quote && !lineComment && !blockComment;
}

function offsetAtPosition(source: string, position: EditorPosition): number {
  let lineNumber = 1;
  let column = 1;

  for (let index = 0; index < source.length; index += 1) {
    if (lineNumber === position.lineNumber && column === position.column) {
      return index;
    }

    if (source[index] === "\n") {
      lineNumber += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return source.length;
}

function editorPositionAtOffset(
  source: string,
  offset: number,
): EditorPosition {
  let lineNumber = 1;
  let column = 1;

  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\n") {
      lineNumber += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return { column, lineNumber };
}
