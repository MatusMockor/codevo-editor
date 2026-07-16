import { parsePhpClassStructure } from "./phpClassStructure";
import { resolvePhpClassName } from "./phpClassNameResolution";
import { maskPhpSource } from "./phpSourceMask";

export interface NetteTemplatePathReference {
  kind: "factoryDirectory" | "literal";
  path: string;
}

export interface NetteTemplateOwnership {
  ownerClassName: string;
  receiverLocal: string;
  template: NetteTemplatePathReference;
}

const MAX_FACTORY_SOURCE_CHARACTERS = 750_000;
const MAX_METHOD_BODY_CHARACTERS = 120_000;
const MAX_TEMPLATE_CALLS = 40;
const UNSOUND_CONSTRUCTED_CLASS_NAMES = new Set([
  "class",
  "parent",
  "namespace",
  "readonly",
  "self",
  "static",
]);

/**
 * Extracts unambiguous template ownership established inside direct PHP method
 * bodies. It intentionally models only `$local = new Type`, a static
 * `setTemplateFile()` path on that local, and a compatible direct return.
 */
export function netteTemplateOwnershipsFromPhpFactorySource(
  source: string,
): NetteTemplateOwnership[] {
  if (!source || source.length > MAX_FACTORY_SOURCE_CHARACTERS) {
    return [];
  }

  const masked = maskPhpSource(source);
  const structure = parsePhpClassStructure(source);

  if (structure.kind !== "class" && structure.kind !== "abstract-class") {
    return [];
  }

  const candidates: NetteTemplateOwnership[] = [];

  for (const method of structure.methods) {
    if (method.bodyStartOffset === null) {
      continue;
    }

    const bodyEnd = matchingBraceOffset(masked, method.bodyStartOffset);

    if (
      bodyEnd === null ||
      bodyEnd - method.bodyStartOffset > MAX_METHOD_BODY_CHARACTERS
    ) {
      continue;
    }

    candidates.push(
      ...ownershipsFromMethodBody(
        source,
        masked,
        method.bodyStartOffset + 1,
        bodyEnd,
      ),
    );

    if (candidates.length > MAX_TEMPLATE_CALLS) {
      return [];
    }
  }

  return unambiguousOwnerships(candidates);
}

export const netteTemplateOwnershipsFromPhpSource =
  netteTemplateOwnershipsFromPhpFactorySource;

function ownershipsFromMethodBody(
  source: string,
  masked: string,
  bodyStart: number,
  bodyEnd: number,
): NetteTemplateOwnership[] {
  const maskedBody = masked.slice(bodyStart, bodyEnd);
  const calls = Array.from(
    maskedBody.matchAll(
      /\$([A-Za-z_][A-Za-z0-9_]*)\s*->\s*setTemplateFile\s*\(/gi,
    ),
  );
  const ownerships: NetteTemplateOwnership[] = [];

  for (const call of calls.slice(0, MAX_TEMPLATE_CALLS + 1)) {
    const callOffset = bodyStart + (call.index ?? 0);

    if (braceDepthBetween(masked, bodyStart, callOffset) !== 0) {
      continue;
    }

    const receiverLocal = call[1];
    const openParen = masked.indexOf("(", callOffset);
    const closeParen = matchingPairOffset(masked, openParen, "(", ")");

    if (!receiverLocal || closeParen === null || closeParen > bodyEnd) {
      continue;
    }

    const template = staticTemplateReference(
      source.slice(openParen + 1, closeParen),
    );

    if (!template) {
      continue;
    }

    const assignment = uniqueConstructingAssignment(
      source,
      masked,
      bodyStart,
      bodyEnd,
      receiverLocal,
    );

    if (!assignment || assignment.offset >= callOffset) {
      continue;
    }

    if (
      !returnsAreCompatible(
        masked,
        bodyStart,
        bodyEnd,
        receiverLocal,
        callOffset,
      )
    ) {
      continue;
    }

    const ownerClassName = resolvePhpClassName(masked, assignment.className);

    if (!ownerClassName) {
      continue;
    }

    ownerships.push({ ownerClassName, receiverLocal, template });
  }

  return ownerships;
}

function uniqueConstructingAssignment(
  source: string,
  masked: string,
  bodyStart: number,
  bodyEnd: number,
  local: string,
): { className: string; offset: number } | null {
  const escapedLocal = escapeRegExp(local);
  const body = masked.slice(bodyStart, bodyEnd);
  const rawBody = source.slice(bodyStart, bodyEnd);
  const writes = Array.from(
    body.matchAll(
      new RegExp(
        `\\$${escapedLocal}\\s*(?:\\+\\+|--|(?:\\?\\?|[+\\-*/%.&|^]|<<|>>)?=(?!=|>))`,
        "g",
      ),
    ),
  );

  if (
    writes.length !== 1 ||
    receiverHasInvalidatingBinding(body, rawBody, escapedLocal)
  ) {
    return null;
  }

  const write = writes[0];

  if (!write) {
    return null;
  }

  const offset = bodyStart + (write.index ?? 0);

  if (braceDepthBetween(masked, bodyStart, offset) !== 0) {
    return null;
  }

  const tail = masked.slice(offset, bodyEnd);
  const construction = new RegExp(
    `^\\$${escapedLocal}\\s*=\\s*new\\s+(\\\\?[A-Za-z_][A-Za-z0-9_]*(?:\\\\[A-Za-z_][A-Za-z0-9_]*)*)\\b`,
  ).exec(tail);
  const className = construction?.[1];

  if (!className || !isConcreteConstructedClassName(className)) {
    return null;
  }

  return { className, offset };
}

function receiverHasInvalidatingBinding(
  maskedBody: string,
  rawBody: string,
  escapedLocal: string,
): boolean {
  const patterns = [
    new RegExp(
      `\\bforeach\\s*\\([^;{}]*\\bas\\s+(?:&\\s*)?(?:\\$[A-Za-z_][A-Za-z0-9_]*\\s*=>\\s*&?\\s*)?(?:\\$${escapedLocal}\\b|list\\s*\\([^;{}]*\\$${escapedLocal}\\b|\\[[^;{}]*\\$${escapedLocal}\\b)`,
      "i",
    ),
    new RegExp(`\\blist\\s*\\([^;{}]*\\$${escapedLocal}\\b[^;{}]*\\)\\s*=`, "i"),
    new RegExp(`\\[[^;{}]*\\$${escapedLocal}\\b[^;{}]*\\]\\s*=`),
    new RegExp(`\\bunset\\s*\\([^;{}]*\\$${escapedLocal}\\b`, "i"),
    new RegExp(`\\bcatch\\s*\\([^;{}]*\\$${escapedLocal}\\s*\\)`, "i"),
    new RegExp(`\\b(?:global|static)\\s+[^;{}]*\\$${escapedLocal}\\b`, "i"),
    new RegExp(`\\buse\\s*\\([^;{}]*&\\s*\\$${escapedLocal}\\b`, "i"),
    new RegExp(`(?:\\+\\+|--)\\s*\\$${escapedLocal}\\b`),
    new RegExp(
      `\\$[A-Za-z_][A-Za-z0-9_]*\\s*=\\s*&\\s*\\$${escapedLocal}\\b`,
    ),
    new RegExp(`&\\s*\\$${escapedLocal}\\b`),
  ];

  if (patterns.some((pattern) => pattern.test(maskedBody))) {
    return true;
  }

  if (
    /\b(?:eval|extract)\s*\(/i.test(maskedBody) ||
    /\$\$/.test(maskedBody)
  ) {
    return true;
  }

  return hasUnresolvedReceiverDynamicVariable(
    maskedBody,
    rawBody,
    escapedLocal,
  );
}

function hasUnresolvedReceiverDynamicVariable(
  maskedBody: string,
  rawBody: string,
  escapedLocal: string,
): boolean {
  for (const match of maskedBody.matchAll(/\$\{/g)) {
    const offset = match.index ?? -1;
    const closeBrace = matchingPairOffset(maskedBody, offset + 1, "{", "}");

    if (offset < 0 || closeBrace === null) {
      return true;
    }

    const expression = rawBody.slice(offset + 2, closeBrace).trim();
    const staticName = staticPhpString(expression);

    if (staticName === null) {
      return true;
    }

    if (new RegExp(`^${escapedLocal}$`).test(staticName)) {
      return true;
    }
  }

  return false;
}

function isConcreteConstructedClassName(className: string): boolean {
  const normalized = className.replace(/^\\+/, "").toLowerCase();
  const firstSegment = normalized.split("\\", 1)[0] ?? "";
  return !UNSOUND_CONSTRUCTED_CLASS_NAMES.has(firstSegment);
}

function returnsAreCompatible(
  masked: string,
  bodyStart: number,
  bodyEnd: number,
  local: string,
  callOffset: number,
): boolean {
  const returns = Array.from(
    masked.slice(bodyStart, bodyEnd).matchAll(/\breturn\b/g),
  );

  if (returns.length !== 1) {
    return false;
  }

  const expected = new RegExp(
    `^return\\s+\\$${escapeRegExp(local)}\\s*;`,
  );

  const directReturn = returns[0];

  if (!directReturn) {
    return false;
  }

  const returnOffset = bodyStart + (directReturn.index ?? 0);

  if (
    braceDepthBetween(masked, bodyStart, returnOffset) !== 0 ||
    returnIsControlledByBracelessStatement(masked, bodyStart, returnOffset)
  ) {
    return false;
  }

  return returnOffset > callOffset && expected.test(masked.slice(returnOffset));
}

function returnIsControlledByBracelessStatement(
  masked: string,
  bodyStart: number,
  returnOffset: number,
): boolean {
  let boundary = bodyStart;
  let bracketDepth = 0;
  let parenDepth = 0;

  for (let index = bodyStart; index < returnOffset; index += 1) {
    const character = masked[index] ?? "";

    if (character === "(") {
      parenDepth += 1;
      continue;
    }

    if (character === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }

    if (character === "[") {
      bracketDepth += 1;
      continue;
    }

    if (character === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (
      parenDepth === 0 &&
      bracketDepth === 0 &&
      /[;{}]/.test(character)
    ) {
      boundary = index + 1;
    }
  }

  const prefix = masked.slice(boundary, returnOffset);
  return /\b(?:do|else|elseif|for|foreach|if|switch|while)\b/i.test(prefix);
}

function staticTemplateReference(
  argumentSource: string,
): NetteTemplatePathReference | null {
  const argument = argumentSource.trim();
  const directoryMatch = /^__DIR__\s*\.\s*([\s\S]+)$/i.exec(argument);

  if (directoryMatch?.[1]) {
    const path = staticPhpString(directoryMatch[1].trim());
    return path ? { kind: "factoryDirectory", path } : null;
  }

  const path = staticPhpString(argument);
  return path ? { kind: "literal", path } : null;
}

function staticPhpString(value: string): string | null {
  if (value.length < 2) {
    return null;
  }

  const quote = value[0];

  if ((quote !== "'" && quote !== '"') || value[value.length - 1] !== quote) {
    return null;
  }

  const body = value.slice(1, -1);

  if (quote === '"' && /[$\{]/.test(body)) {
    return null;
  }

  let decoded = "";

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index] ?? "";

    if (character === quote) {
      return null;
    }

    if (character !== "\\") {
      decoded += character;
      continue;
    }

    const escaped = body[index + 1];

    if (!escaped) {
      return null;
    }

    if (escaped === "\\" || escaped === quote) {
      decoded += escaped;
      index += 1;
      continue;
    }

    if (quote === "'") {
      decoded += `\\${escaped}`;
      index += 1;
      continue;
    }

    if (escaped === "n") {
      decoded += "\n";
      index += 1;
      continue;
    }

    if (escaped === "r") {
      decoded += "\r";
      index += 1;
      continue;
    }

    if (escaped === "t") {
      decoded += "\t";
      index += 1;
      continue;
    }

    decoded += `\\${escaped}`;
    index += 1;
  }

  return decoded;
}

function unambiguousOwnerships(
  candidates: readonly NetteTemplateOwnership[],
): NetteTemplateOwnership[] {
  const byTemplate = new Map<string, NetteTemplateOwnership[]>();

  for (const candidate of candidates) {
    const key = `${candidate.template.kind}\0${normalizeTemplatePath(candidate.template.path)}`;
    const existing = byTemplate.get(key) ?? [];
    existing.push(candidate);
    byTemplate.set(key, existing);
  }

  const result: NetteTemplateOwnership[] = [];

  for (const matches of byTemplate.values()) {
    const owners = new Set(
      matches.map((match) => match.ownerClassName.toLowerCase()),
    );

    if (owners.size !== 1) {
      continue;
    }

    const first = matches[0];

    if (first) {
      result.push(first);
    }
  }

  return result;
}

function normalizeTemplatePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function matchingBraceOffset(source: string, openOffset: number): number | null {
  return matchingPairOffset(source, openOffset, "{", "}");
}

function matchingPairOffset(
  source: string,
  openOffset: number,
  open: string,
  close: string,
): number | null {
  if (openOffset < 0 || source[openOffset] !== open) {
    return null;
  }

  let depth = 0;

  for (let index = openOffset; index < source.length; index += 1) {
    if (source[index] === open) {
      depth += 1;
      continue;
    }

    if (source[index] !== close) {
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return index;
    }
  }

  return null;
}

function braceDepthBetween(source: string, start: number, end: number): number {
  let depth = 0;

  for (let index = start; index < end; index += 1) {
    if (source[index] === "{") {
      depth += 1;
      continue;
    }

    if (source[index] === "}") {
      depth -= 1;
    }
  }

  return depth;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
