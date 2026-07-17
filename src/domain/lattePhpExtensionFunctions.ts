import {
  lattePhpExtensionArrayCallableAt,
  lattePhpExtensionCallableMapEntriesFromSource,
  lattePhpStringLiteralAt,
  type LattePhpExtensionFilter,
} from "./lattePhpExtensionFilters";
import { maskPhpSource } from "./phpSourceMask";

export type LattePhpExtensionFunction = LattePhpExtensionFilter;

export const LATTE_BUILTIN_FUNCTIONS: readonly string[] = [
  "clamp",
  "divisibleBy",
  "even",
  "first",
  "group",
  "hasBlock",
  "hasTemplate",
  "last",
  "odd",
  "slice",
];

const ADD_FUNCTION_CALL_PATTERN = /->\s*addFunction\s*\(/g;

export function lattePhpExtensionFunctionsFromSource(
  source: string,
): LattePhpExtensionFunction[] {
  return [
    ...lattePhpExtensionCallableMapEntriesFromSource(source, "getFunctions"),
    ...latteAddFunctionRegistrationsFromSource(source),
  ];
}

function latteAddFunctionRegistrationsFromSource(
  source: string,
): LattePhpExtensionFunction[] {
  const masked = maskPhpSource(source);
  const registrations: LattePhpExtensionFunction[] = [];

  for (
    let match = ADD_FUNCTION_CALL_PATTERN.exec(masked);
    match;
    match = ADD_FUNCTION_CALL_PATTERN.exec(masked)
  ) {
    const registration = addFunctionRegistrationAt(
      source,
      match.index + match[0].length,
      match.index,
    );

    if (!registration) {
      continue;
    }

    registrations.push(registration);
  }

  return registrations;
}

function addFunctionRegistrationAt(
  source: string,
  argumentsStart: number,
  callOffset: number,
): LattePhpExtensionFunction | null {
  const quoteOffset = skipSpaces(source, argumentsStart);
  const quote = source[quoteOffset] ?? "";

  if (quote !== "'" && quote !== '"') {
    return null;
  }

  const literal = lattePhpStringLiteralAt(source, quoteOffset, quote);

  if (!literal || literal.name.length === 0) {
    return null;
  }

  const registration: LattePhpExtensionFunction = {
    name: literal.name,
    offset: quoteOffset + 1,
  };
  const commaOffset = skipSpaces(source, literal.end + 1);

  if (source[commaOffset] !== ",") {
    return registration;
  }

  const callable = lattePhpExtensionArrayCallableAt(
    source,
    commaOffset + 1,
    callOffset,
  );

  if (!callable) {
    return registration;
  }

  return { ...callable, ...registration };
}

function skipSpaces(source: string, start: number): number {
  let index = start;

  while (/\s/.test(source[index] ?? "")) {
    index += 1;
  }

  return index;
}
