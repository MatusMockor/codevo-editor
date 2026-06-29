import type { PhpPropertyMember } from "./phpClassStructure";

/**
 * Pure PHP code generation for getters / setters from the structural property
 * model produced by `parsePhpClassStructure`.
 *
 * Design constraints:
 *  - Pure string rendering — no side-effects, no I/O.
 *  - Accessors are always `public` (the PhpStorm "Generate getters/setters"
 *    convention); the source property visibility is intentionally ignored.
 *  - Naming follows PhpStorm: `getX` / `setX`, but a boolean property gets an
 *    `isX` getter. The PHP property name is preserved verbatim in `$this->x`.
 *  - A `readonly` property is immutable, so it never gets a setter.
 *  - The native type drives the hint; a legal native `@var` PHPDoc type is a
 *    fallback when there is no native type.
 *  - Rich PHPDoc-only types (`string[]`, `array<int, User>`, generics) stay in
 *    generated PHPDoc instead of being emitted as invalid native PHP types.
 */

export type PhpAccessorMode = "get" | "set" | "both";

export interface RenderGetterOptions {
  indent?: string;
}

export interface RenderSetterOptions {
  fluent?: boolean;
  indent?: string;
}

export interface RenderAccessorsOptions {
  fluent?: boolean;
  indent?: string;
  mode?: PhpAccessorMode;
}

const DEFAULT_INDENT = "";
const BODY_INDENT = "    ";
const BOOL_TYPE_TOKENS = new Set(["bool", "null"]);
const NATIVE_TYPE_TOKEN_PATTERN = "\\\\?[A-Za-z_][\\\\A-Za-z0-9_]*";
const NATIVE_TYPE_PATTERN = new RegExp(
  `^\\??${NATIVE_TYPE_TOKEN_PATTERN}(?:\\s*[|&]\\s*${NATIVE_TYPE_TOKEN_PATTERN})*$`,
);

export function renderGetter(
  property: PhpPropertyMember,
  options: RenderGetterOptions = {},
): string {
  const indent = options.indent ?? DEFAULT_INDENT;
  const accessorType = getterType(property);
  const returnSuffix = accessorType ? `: ${accessorType}` : "";
  const methodName = `${getterPrefix(accessorType)}${pascalCase(property.name)}`;
  const signature = `public function ${methodName}()${returnSuffix}`;
  const body = `return $this->${property.name};`;
  const docLines = phpDocLines([phpDocTag("return", property)]);

  return renderMethod(signature, [body], indent, docLines);
}

export function renderSetter(
  property: PhpPropertyMember,
  options: RenderSetterOptions = {},
): string | null {
  if (property.isReadonly) {
    return null;
  }

  const indent = options.indent ?? DEFAULT_INDENT;
  const fluent = options.fluent ?? false;
  const parameterType = setterParameterType(property);
  const typePrefix = parameterType ? `${parameterType} ` : "";
  const methodName = `set${pascalCase(property.name)}`;
  const returnSuffix = fluent ? ": static" : ": void";
  const signature = `public function ${methodName}(${typePrefix}$${property.name})${returnSuffix}`;
  const body = setterBody(property, fluent);
  const docLines = phpDocLines([phpDocTag("param", property)]);

  return renderMethod(signature, body, indent, docLines);
}

export function renderAccessors(
  properties: PhpPropertyMember[],
  options: RenderAccessorsOptions = {},
): string {
  const mode = options.mode ?? "both";

  return properties
    .flatMap((property) => accessorsForProperty(property, mode, options))
    .join("\n\n");
}

function accessorsForProperty(
  property: PhpPropertyMember,
  mode: PhpAccessorMode,
  options: RenderAccessorsOptions,
): string[] {
  const accessors: string[] = [];

  if (mode !== "set") {
    accessors.push(renderGetter(property, { indent: options.indent }));
  }

  if (mode === "get") {
    return accessors;
  }

  const setter = renderSetter(property, {
    fluent: options.fluent,
    indent: options.indent,
  });

  if (setter) {
    accessors.push(setter);
  }

  return accessors;
}

function setterBody(property: PhpPropertyMember, fluent: boolean): string[] {
  const assignment = `$this->${property.name} = $${property.name};`;

  if (!fluent) {
    return [assignment];
  }

  return [assignment, "", "return $this;"];
}

function renderMethod(
  signature: string,
  bodyLines: string[],
  indent: string,
  docLines: string[] = [],
): string {
  const body = bodyLines.map((line) => indentBodyLine(line, indent));

  return [
    ...docLines.map((line) => `${indent}${line}`),
    `${indent}${signature}`,
    `${indent}{`,
    ...body,
    `${indent}}`,
  ].join("\n");
}

function indentBodyLine(line: string, indent: string): string {
  if (line.length === 0) {
    return "";
  }

  return `${indent}${BODY_INDENT}${line}`;
}

function getterType(property: PhpPropertyMember): string | null {
  if (property.type && isLegalNativeReturnType(property.type)) {
    return property.type;
  }

  const docType = property.phpDoc?.varType ?? null;

  return docType && isLegalNativeReturnType(docType) ? docType : null;
}

function setterParameterType(property: PhpPropertyMember): string | null {
  if (property.type && isLegalNativeParameterType(property.type)) {
    return property.type;
  }

  return null;
}

function phpDocTag(
  kind: "param" | "return",
  property: PhpPropertyMember,
): string | null {
  const docType = property.phpDoc?.varType;

  if (!docType || docType === getterType(property)) {
    return null;
  }

  if (kind === "param") {
    return `@param ${docType} $${property.name}`;
  }

  return `@return ${docType}`;
}

function phpDocLines(tags: Array<string | null>): string[] {
  const renderedTags = tags.filter((tag): tag is string => tag !== null);

  if (renderedTags.length === 0) {
    return [];
  }

  return ["/**", ...renderedTags.map((tag) => ` * ${tag}`), " */"];
}

function isLegalNativeReturnType(type: string): boolean {
  return isLegalNativeType(type, "return");
}

function isLegalNativeParameterType(type: string): boolean {
  return isLegalNativeType(type, "parameter");
}

function isLegalNativeType(
  type: string,
  position: "parameter" | "return",
): boolean {
  const normalized = type.trim();

  if (!NATIVE_TYPE_PATTERN.test(normalized)) {
    return false;
  }

  if (normalized.includes("?") && /[|&]/.test(normalized)) {
    return false;
  }

  if (normalized.includes("|") && normalized.includes("&")) {
    return false;
  }

  const tokens = normalized
    .replace(/^\?/, "")
    .split(/[|&]/)
    .map((token) => token.trim().replace(/^\\+/, "").toLowerCase());

  if (tokens.some((token) => token === "void" || token === "never")) {
    return false;
  }

  if (position === "parameter" && tokens.includes("static")) {
    return false;
  }

  return true;
}

function getterPrefix(accessorType: string | null): string {
  if (isBoolType(accessorType)) {
    return "is";
  }

  return "get";
}

function isBoolType(accessorType: string | null): boolean {
  if (!accessorType) {
    return false;
  }

  const tokens = accessorType
    .toLowerCase()
    .replace(/^\?/, "null|")
    .split("|")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (!tokens.includes("bool")) {
    return false;
  }

  return tokens.every((token) => BOOL_TYPE_TOKENS.has(token));
}

function pascalCase(name: string): string {
  return name
    .split(/[_\s-]+/)
    .filter((segment) => segment.length > 0)
    .map(capitalizeFirst)
    .join("");
}

function capitalizeFirst(segment: string): string {
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}
