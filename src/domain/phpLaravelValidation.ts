import type { EditorPosition } from "./languageServerFeatures";

export const laravelBuiltInValidationRuleNames = [
  "accepted",
  "accepted_if",
  "active_url",
  "after",
  "after_or_equal",
  "alpha",
  "alpha_dash",
  "alpha_num",
  "array",
  "ascii",
  "bail",
  "before",
  "before_or_equal",
  "between",
  "boolean",
  "confirmed",
  "current_password",
  "date",
  "date_equals",
  "date_format",
  "decimal",
  "declined",
  "declined_if",
  "different",
  "digits",
  "digits_between",
  "dimensions",
  "distinct",
  "doesnt_start_with",
  "doesnt_end_with",
  "email",
  "ends_with",
  "enum",
  "exclude",
  "exclude_if",
  "exclude_unless",
  "exclude_with",
  "exclude_without",
  "exists",
  "extensions",
  "file",
  "filled",
  "gt",
  "gte",
  "hex_color",
  "image",
  "in",
  "in_array",
  "integer",
  "ip",
  "ipv4",
  "ipv6",
  "json",
  "lowercase",
  "lt",
  "lte",
  "mac_address",
  "max",
  "max_digits",
  "mimetypes",
  "mimes",
  "min",
  "min_digits",
  "missing",
  "missing_if",
  "missing_unless",
  "missing_with",
  "missing_with_all",
  "multiple_of",
  "not_in",
  "not_regex",
  "nullable",
  "numeric",
  "password",
  "present",
  "present_if",
  "present_unless",
  "present_with",
  "present_with_all",
  "prohibited",
  "prohibited_if",
  "prohibited_unless",
  "prohibits",
  "regex",
  "required",
  "required_if",
  "required_if_accepted",
  "required_unless",
  "required_with",
  "required_with_all",
  "required_without",
  "required_without_all",
  "required_array_keys",
  "same",
  "size",
  "sometimes",
  "starts_with",
  "string",
  "timezone",
  "ulid",
  "unique",
  "uppercase",
  "url",
  "uuid",
] as const;

export type LaravelBuiltInValidationRuleName =
  (typeof laravelBuiltInValidationRuleNames)[number];

export interface PhpLaravelValidationRuleStringContext {
  position: EditorPosition;
  prefix: string;
}

export interface PhpLaravelValidationRuleCompletion {
  insertText: string;
  name: LaravelBuiltInValidationRuleName;
}

export interface PhpLaravelValidationRuleTableReference {
  endOffset: number;
  startOffset: number;
  tableName: string;
}

interface PhpStringLiteral {
  closed: boolean;
  quote: "'" | "\"";
  quoteEnd: number;
  quoteStart: number;
  value: string;
}

export const validationRulesArgumentIndexByCall = {
  "$this->validate": 1,
  "Validator::make": 1,
  validate: 0,
} as const;

type ValidationRuleCall = keyof typeof validationRulesArgumentIndexByCall;

export function phpLaravelValidationRuleStringContextAt(
  source: string,
  position: EditorPosition,
): PhpLaravelValidationRuleStringContext | null {
  const offset = offsetAtPosition(source, position);
  const literal = stringLiteralAtOffset(source, offset);

  if (!literal) {
    return null;
  }

  const arrayOpen = validationRulesArrayOpenAt(source, literal);

  if (arrayOpen === null) {
    return null;
  }

  const call = validationRulesArgumentCallAt(source, arrayOpen);

  if (!call && !isRulesMethodReturnArray(source, arrayOpen)) {
    return null;
  }

  const valuePrefix = source.slice(
    literal.quoteStart + 1,
    Math.min(offset, literal.quoteEnd),
  );

  return {
    position,
    prefix: rulePrefixAfterLastSeparator(valuePrefix),
  };
}

export function phpLaravelValidationRuleTableReferenceAt(
  source: string,
  position: EditorPosition,
): PhpLaravelValidationRuleTableReference | null {
  if (!phpLaravelValidationRuleStringContextAt(source, position)) {
    return null;
  }

  const offset = offsetAtPosition(source, position);
  const literal = stringLiteralAtOffset(source, offset);

  if (!literal) {
    return null;
  }

  const valueStart = literal.quoteStart + 1;
  const value = source.slice(valueStart, literal.quoteEnd);
  const pattern = /(?:^|\|)\s*(?:exists|unique)\s*:\s*([^,|]*)/gi;

  for (const match of value.matchAll(pattern)) {
    const parameter = match[1] ?? "";
    const trimmedParameter = parameter.trim();
    const tableName = trimmedParameter.split(".").pop()?.trim() ?? "";

    if (!tableName) {
      continue;
    }

    const parameterOffset = match.index + match[0].lastIndexOf(parameter);
    const tableOffset = parameter.lastIndexOf(tableName);
    const startOffset = valueStart + parameterOffset + tableOffset;
    const endOffset = startOffset + tableName.length;

    if (offset < startOffset || offset >= endOffset) {
      continue;
    }

    return { endOffset, startOffset, tableName };
  }

  return null;
}

export function phpLaravelValidationRuleCompletions(
  prefix: string,
): PhpLaravelValidationRuleCompletion[] {
  const normalizedPrefix = prefix.toLowerCase();

  return laravelBuiltInValidationRuleNames
    .filter((name) => name.startsWith(normalizedPrefix))
    .map((name) => ({ insertText: name, name }));
}

function rulePrefixAfterLastSeparator(valuePrefix: string): string {
  const lastSeparator = valuePrefix.lastIndexOf("|");

  return lastSeparator < 0 ? valuePrefix : valuePrefix.slice(lastSeparator + 1);
}

function isMapValueLiteral(
  source: string,
  arrayOpen: number,
  literal: PhpStringLiteral,
): boolean {
  const arrayClose = matchingBracketOffset(source, arrayOpen, "[", "]");

  if (arrayClose !== null && literal.quoteStart > arrayClose) {
    return false;
  }

  if (!isTopLevelBetween(source, arrayOpen + 1, literal.quoteStart)) {
    return false;
  }

  const itemStart = previousTopLevelArrayDelimiter(
    source,
    arrayOpen,
    literal.quoteStart,
  );
  const beforeLiteral = source.slice(itemStart, literal.quoteStart);

  return hasTopLevelDoubleArrow(beforeLiteral);
}

function validationRulesArrayOpenAt(
  source: string,
  literal: PhpStringLiteral,
): number | null {
  const arrayOpen = enclosingShortArrayOpenAt(source, literal);

  if (arrayOpen === null) {
    return null;
  }

  if (isMapValueLiteral(source, arrayOpen, literal)) {
    return arrayOpen;
  }

  const parentArrayOpen = enclosingShortArrayOpenBefore(source, arrayOpen);

  if (parentArrayOpen === null) {
    return null;
  }

  if (!isMapValueOffset(source, parentArrayOpen, arrayOpen)) {
    return null;
  }

  return parentArrayOpen;
}

function enclosingShortArrayOpenBefore(
  source: string,
  targetOffset: number,
): number | null {
  for (
    let arrayOpen = source.lastIndexOf("[", targetOffset - 1);
    arrayOpen >= 0;
    arrayOpen = source.lastIndexOf("[", arrayOpen - 1)
  ) {
    const arrayClose = matchingBracketOffset(source, arrayOpen, "[", "]");

    if (arrayClose === null || targetOffset <= arrayClose) {
      return arrayOpen;
    }
  }

  return null;
}

function isMapValueOffset(
  source: string,
  arrayOpen: number,
  valueOffset: number,
): boolean {
  if (!isTopLevelBetween(source, arrayOpen + 1, valueOffset)) {
    return false;
  }

  const itemStart = previousTopLevelArrayDelimiter(
    source,
    arrayOpen,
    valueOffset,
  );

  return hasTopLevelDoubleArrow(source.slice(itemStart, valueOffset));
}

function isRulesMethodReturnArray(source: string, arrayOpen: number): boolean {
  const pattern = /\bfunction\s+rules\s*\([^)]*\)\s*(?::\s*[^\{]+)?\s*\{/g;

  for (const match of source.matchAll(pattern)) {
    const bodyStart = (match.index ?? 0) + match[0].lastIndexOf("{");
    const bodyEnd = matchingBracketOffset(source, bodyStart, "{", "}");

    if (bodyEnd === null || arrayOpen <= bodyStart || arrayOpen >= bodyEnd) {
      continue;
    }

    if (/\breturn\s*$/.test(source.slice(bodyStart + 1, arrayOpen))) {
      return true;
    }
  }

  return false;
}

function validationRulesArgumentCallAt(
  source: string,
  arrayOpen: number,
): ValidationRuleCall | null {
  for (
    let openParen = source.lastIndexOf("(", arrayOpen);
    openParen >= 0;
    openParen = source.lastIndexOf("(", openParen - 1)
  ) {
    const closeParen = matchingBracketOffset(source, openParen, "(", ")");

    if (closeParen !== null && arrayOpen > closeParen) {
      continue;
    }

    const argumentIndex = topLevelArgumentIndexAtOffset(
      source,
      openParen,
      arrayOpen,
    );

    if (argumentIndex === null) {
      continue;
    }

    if (!isDirectArrayArgumentValue(source, openParen, arrayOpen)) {
      continue;
    }

    if (!isPhpCodeOffset(source, openParen)) {
      continue;
    }

    const call = validationCallBeforeOpenParen(source, openParen);

    if (!call) {
      return null;
    }

    return argumentIndex === validationRulesArgumentIndexByCall[call]
      ? call
      : null;
  }

  return null;
}

function validationCallBeforeOpenParen(
  source: string,
  openParen: number,
): ValidationRuleCall | null {
  const beforeCall = source.slice(0, openParen);

  if (/\bValidator\s*::\s*make\s*$/.test(beforeCall)) {
    return "Validator::make";
  }

  if (/\$this\s*->\s*validate\s*$/.test(beforeCall)) {
    return "$this->validate";
  }

  const methodMatch = /->\s*validate\s*$/.test(beforeCall);

  if (methodMatch) {
    return "validate";
  }

  return null;
}

function isDirectArrayArgumentValue(
  source: string,
  openParen: number,
  arrayOpen: number,
): boolean {
  const argumentStart = previousTopLevelCallArgumentDelimiter(
    source,
    openParen,
    arrayOpen,
  );
  const beforeArray = source.slice(argumentStart, arrayOpen);

  return /^\s*$/.test(beforeArray) || /:\s*$/.test(beforeArray);
}

function previousTopLevelCallArgumentDelimiter(
  source: string,
  openParen: number,
  targetOffset: number,
): number {
  let delimiter = openParen + 1;

  scanTopLevel(source, openParen + 1, targetOffset, (index, character) => {
    if (character === ",") {
      delimiter = index + 1;
    }
  });

  return delimiter;
}

function enclosingShortArrayOpenAt(
  source: string,
  literal: PhpStringLiteral,
): number | null {
  for (
    let arrayOpen = source.lastIndexOf("[", literal.quoteStart);
    arrayOpen >= 0;
    arrayOpen = source.lastIndexOf("[", arrayOpen - 1)
  ) {
    const arrayClose = matchingBracketOffset(source, arrayOpen, "[", "]");

    if (arrayClose === null || literal.quoteStart <= arrayClose) {
      return arrayOpen;
    }
  }

  return null;
}

function isTopLevelBetween(
  source: string,
  startOffset: number,
  endOffset: number,
): boolean {
  return (
    topLevelArgumentIndexAtOffset(source, startOffset - 1, endOffset) !== null
  );
}

function previousTopLevelArrayDelimiter(
  source: string,
  arrayOpen: number,
  targetOffset: number,
): number {
  let delimiter = arrayOpen + 1;

  scanTopLevel(source, arrayOpen + 1, targetOffset, (index, character) => {
    if (character === ",") {
      delimiter = index + 1;
    }
  });

  return delimiter;
}

function hasTopLevelDoubleArrow(source: string): boolean {
  let found = false;

  scanTopLevel(source, 0, source.length, (index) => {
    if (source[index] === "=" && source[index + 1] === ">") {
      found = true;
      return false;
    }

    return true;
  });

  return found;
}

function scanTopLevel(
  source: string,
  startOffset: number,
  endOffset: number,
  visit: (index: number, character: string) => boolean | void,
): void {
  let depth = 0;
  let quote: "'" | "\"" | null = null;

  for (let index = startOffset; index < endOffset; index += 1) {
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
      continue;
    }

    if (depth === 0 && visit(index, character) === false) {
      return;
    }
  }
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

    if (character === "#" && next !== "[") {
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
