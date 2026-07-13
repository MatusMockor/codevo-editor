import {
  neonServiceSetupMethodsFromSource,
  type NeonServiceSetupMethod,
} from "./netteDiContainer";

export interface LatteFilterRegistration {
  name: string;
  offset: number;
}

const ADD_FILTER_METHOD = "addFilter";
const REGISTER_METHOD = "register";
const FILTER_SERVICE_HINT = "filter";

export function latteFilterRegistrationsFromSource(
  source: string,
): LatteFilterRegistration[] {
  const registrations: LatteFilterRegistration[] = [];

  for (const method of neonServiceSetupMethodsFromSource(source)) {
    if (!isFilterRegistrationMethod(method)) {
      continue;
    }

    const registration = firstStringLiteralArgument(source, method.span.end);

    if (!registration) {
      continue;
    }

    registrations.push(registration);
  }

  return registrations;
}

function isFilterRegistrationMethod(method: NeonServiceSetupMethod): boolean {
  if (method.methodName === ADD_FILTER_METHOD) {
    return true;
  }

  if (method.methodName !== REGISTER_METHOD) {
    return false;
  }

  const serviceName = method.service.serviceName;

  if (!serviceName) {
    return false;
  }

  return serviceName.toLowerCase().includes(FILTER_SERVICE_HINT);
}

function firstStringLiteralArgument(
  source: string,
  methodNameEnd: number,
): LatteFilterRegistration | null {
  let cursor = skipInlineSpaces(source, methodNameEnd);

  if (source[cursor] !== "(") {
    return null;
  }

  cursor = skipInlineSpaces(source, cursor + 1);
  const quote = source[cursor] ?? "";

  if (quote !== "'" && quote !== '"') {
    return null;
  }

  const offset = cursor + 1;
  const name =
    quote === "'"
      ? singleQuotedContent(source, offset)
      : doubleQuotedContent(source, offset);

  if (!name) {
    return null;
  }

  return { name, offset };
}

function skipInlineSpaces(source: string, start: number): number {
  let cursor = start;

  while (source[cursor] === " " || source[cursor] === "\t") {
    cursor += 1;
  }

  return cursor;
}

function singleQuotedContent(source: string, start: number): string | null {
  let content = "";
  let cursor = start;

  while (cursor < source.length) {
    const character = source[cursor] ?? "";

    if (character === "\n") {
      return null;
    }

    if (character === "'" && source[cursor + 1] === "'") {
      content += "'";
      cursor += 2;
      continue;
    }

    if (character === "'") {
      return content;
    }

    content += character;
    cursor += 1;
  }

  return null;
}

function doubleQuotedContent(source: string, start: number): string | null {
  let content = "";
  let cursor = start;

  while (cursor < source.length) {
    const character = source[cursor] ?? "";

    if (character === "\n") {
      return null;
    }

    if (character === "\\") {
      content += source[cursor + 1] ?? "";
      cursor += 2;
      continue;
    }

    if (character === '"') {
      return content;
    }

    content += character;
    cursor += 1;
  }

  return null;
}
