import { isInsideBladeComment } from "./bladeNavigation";
import {
  parsePhpClassStructure,
  type PhpStructuredParameter,
} from "./phpClassStructure";

const PROP_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

const BUILT_IN_PARAMETER_TYPES: ReadonlySet<string> = new Set([
  "array",
  "bool",
  "false",
  "float",
  "int",
  "iterable",
  "mixed",
  "null",
  "object",
  "string",
  "true",
]);

export function bladeComponentPropsAttributes(source: string): string[] {
  const openBracket = bladePropsArrayStart(source);

  if (openBracket === null) {
    return [];
  }

  const names = parsePropsArrayEntries(source, openBracket);

  if (names === null) {
    return [];
  }

  return dedupe(names.map(kebabCaseAttributeName));
}

export function bladeClassComponentConstructorAttributes(
  source: string,
): string[] {
  const structure = parsePhpClassStructure(source);
  const constructor = structure.methods.find(
    (method) => method.name === "__construct",
  );

  if (!constructor) {
    return [];
  }

  return dedupe(
    constructor.parameters
      .filter(isAttributeParameter)
      .map((parameter) =>
        kebabCaseAttributeName(parameter.name.replace(/^\$/, "")),
      ),
  );
}

function isAttributeParameter(parameter: PhpStructuredParameter): boolean {
  if (parameter.isVariadic) {
    return false;
  }

  if (parameter.defaultValue !== null) {
    return true;
  }

  if (parameter.type === null) {
    return true;
  }

  const type = parameter.type.trim();

  if (type.startsWith("?")) {
    return true;
  }

  const unionParts = type
    .split("|")
    .map((part) => part.trim().replace(/^\\/, "").toLowerCase());

  if (unionParts.includes("null")) {
    return true;
  }

  return unionParts.every((part) => BUILT_IN_PARAMETER_TYPES.has(part));
}

function bladePropsArrayStart(source: string): number | null {
  const directive = "@props";

  for (
    let start = source.indexOf(directive);
    start >= 0;
    start = source.indexOf(directive, start + directive.length)
  ) {
    if (isInsideBladeComment(source, start + 1)) {
      continue;
    }

    const openParen = skipWhitespace(source, start + directive.length);

    if (source[openParen] !== "(") {
      continue;
    }

    const openBracket = skipWhitespace(source, openParen + 1);

    if (source[openBracket] !== "[") {
      return null;
    }

    return openBracket;
  }

  return null;
}

function parsePropsArrayEntries(
  source: string,
  openBracket: number,
): string[] | null {
  const names: string[] = [];
  let index = skipWhitespace(source, openBracket + 1);

  while (index < source.length) {
    const character = source[index] ?? "";

    if (character === "]") {
      return names;
    }

    if (character !== "'" && character !== "\"") {
      return null;
    }

    const literalEnd = propsStringLiteralEnd(source, index);

    if (literalEnd >= source.length) {
      return null;
    }

    const name = source.slice(index + 1, literalEnd);

    if (!PROP_NAME_PATTERN.test(name)) {
      return null;
    }

    names.push(name);
    index = skipWhitespace(source, literalEnd + 1);

    if (source.startsWith("=>", index)) {
      const valueEnd = skipDefaultValue(source, index + 2);

      if (valueEnd === null) {
        return null;
      }

      index = skipWhitespace(source, valueEnd);
    }

    const separator = source[index] ?? "";

    if (separator === "]") {
      return names;
    }

    if (separator !== ",") {
      return null;
    }

    index = skipWhitespace(source, index + 1);
  }

  return null;
}

function skipDefaultValue(source: string, start: number): number | null {
  let depth = 0;
  let index = start;

  while (index < source.length) {
    const character = source[index] ?? "";

    if (character === "'" || character === "\"") {
      const end = propsStringLiteralEnd(source, index);

      if (end >= source.length) {
        return null;
      }

      index = end + 1;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      index += 1;
      continue;
    }

    if (character === ")" || character === "}") {
      if (depth === 0) {
        return null;
      }

      depth -= 1;
      index += 1;
      continue;
    }

    if (character === "]") {
      if (depth === 0) {
        return index;
      }

      depth -= 1;
      index += 1;
      continue;
    }

    if (character === "," && depth === 0) {
      return index;
    }

    index += 1;
  }

  return null;
}

function propsStringLiteralEnd(source: string, quoteStart: number): number {
  const quote = source[quoteStart];

  for (let index = quoteStart + 1; index < source.length; index += 1) {
    const character = source[index];

    if (character === "\\") {
      index += 1;
      continue;
    }

    if (character === quote) {
      return index;
    }
  }

  return source.length;
}

function skipWhitespace(source: string, start: number): number {
  let index = start;

  while (index < source.length && /\s/.test(source[index] ?? "")) {
    index += 1;
  }

  return index;
}

function kebabCaseAttributeName(name: string): string {
  return name.replace(/(.)(?=[A-Z])/g, "$1-").toLowerCase();
}

function dedupe(names: readonly string[]): string[] {
  return Array.from(new Set(names));
}
