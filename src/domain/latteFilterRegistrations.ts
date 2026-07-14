import {
  neonServiceSetupMethodsFromSource,
  type NeonServiceSetupMethod,
} from "./netteDiContainer";

export interface LatteFilterRegistration {
  callable?: LatteFilterRegistrationCallable;
  name: string;
  offset: number;
}

export interface LatteFilterRegistrationCallable {
  methodName: string;
  methodOffset: number;
  serviceClassName?: string;
  serviceName: string;
  serviceOffset: number;
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

    const registration = filterRegistrationFromMethod(source, method);

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

function filterRegistrationFromMethod(
  source: string,
  method: NeonServiceSetupMethod,
): LatteFilterRegistration | null {
  const registration = firstStringLiteralArgument(source, method.span.end);

  if (!registration) {
    return null;
  }

  const callable = filterCallableArgument(source, method);

  return callable ? { ...registration, callable } : registration;
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

function filterCallableArgument(
  source: string,
  method: NeonServiceSetupMethod,
): LatteFilterRegistrationCallable | null {
  let cursor = skipInlineSpaces(source, method.span.end);

  if (source[cursor] !== "(") {
    return null;
  }

  cursor = skipInlineSpaces(source, cursor + 1);
  const firstQuote = source[cursor] ?? "";

  if (firstQuote !== "'" && firstQuote !== '"') {
    return null;
  }

  const firstLiteralEnd = quotedLiteralEnd(source, cursor, firstQuote);

  if (firstLiteralEnd === null) {
    return null;
  }

  cursor = skipInlineSpaces(source, firstLiteralEnd + 1);

  if (source[cursor] !== ",") {
    return null;
  }

  cursor = skipInlineSpaces(source, cursor + 1);

  if (source[cursor] !== "[") {
    return null;
  }

  cursor = skipInlineSpaces(source, cursor + 1);

  if (source[cursor] !== "@") {
    return null;
  }

  const serviceOffset = cursor + 1;
  let serviceEnd = serviceOffset;

  while (isServiceNameChar(source[serviceEnd] ?? "")) {
    serviceEnd += 1;
  }

  if (serviceEnd === serviceOffset) {
    return null;
  }

  const serviceName = source.slice(serviceOffset, serviceEnd);
  cursor = skipInlineSpaces(source, serviceEnd);

  if (source[cursor] !== ",") {
    return null;
  }

  cursor = skipInlineSpaces(source, cursor + 1);
  const methodOffset = cursor;

  if (!isMethodNameStart(source[methodOffset] ?? "")) {
    return null;
  }

  let methodEnd = cursor;

  while (isMethodNameChar(source[methodEnd] ?? "")) {
    methodEnd += 1;
  }

  if (methodEnd === methodOffset) {
    return null;
  }

  const methodName = source.slice(methodOffset, methodEnd);
  cursor = skipInlineSpaces(source, methodEnd);

  if (source[cursor] !== "]") {
    return null;
  }

  return {
    methodName,
    methodOffset,
    ...(serviceName === "self"
      ? serviceClassNamePayload(method.service)
      : {}),
    serviceName,
    serviceOffset,
  };
}

function serviceClassNamePayload(service: NeonServiceSetupMethod["service"]):
  | { serviceClassName: string }
  | {} {
  const className = selfServiceClassName(service);

  return className ? { serviceClassName: className } : {};
}

function selfServiceClassName(service: NeonServiceSetupMethod["service"]): string | null {
  if (service.className) {
    return service.className;
  }

  if (!service.factory) {
    return service.serviceName && service.serviceName.includes("\\")
      ? service.serviceName
      : null;
  }

  const factoryClass = service.factory.split("::")[0]?.trim() ?? "";

  if (!factoryClass || factoryClass.startsWith("@")) {
    return null;
  }

  return factoryClass;
}

function quotedLiteralEnd(
  source: string,
  quoteOffset: number,
  quote: string,
): number | null {
  let cursor = quoteOffset + 1;

  while (cursor < source.length) {
    const character = source[cursor] ?? "";

    if (character === "\n") {
      return null;
    }

    if (quote === "'" && character === "'" && source[cursor + 1] === "'") {
      cursor += 2;
      continue;
    }

    if (quote === '"' && character === "\\") {
      cursor += 2;
      continue;
    }

    if (character === quote) {
      return cursor;
    }

    cursor += 1;
  }

  return null;
}

function skipInlineSpaces(source: string, start: number): number {
  let cursor = start;

  while (source[cursor] === " " || source[cursor] === "\t") {
    cursor += 1;
  }

  return cursor;
}

function isServiceNameChar(character: string): boolean {
  return /[A-Za-z0-9_.\\-]/.test(character);
}

function isMethodNameChar(character: string): boolean {
  return /[A-Za-z0-9_]/.test(character);
}

function isMethodNameStart(character: string): boolean {
  return /[A-Za-z_]/.test(character);
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
