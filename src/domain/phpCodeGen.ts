import type {
  PhpMethodMember,
  PhpMethodPhpDoc,
  PhpStructuredParameter,
} from "./phpClassStructure";

/**
 * Pure PHP code generation for "implement interface methods" (and abstract
 * method implementation). Given the precise structural model produced by
 * `parsePhpClassStructure`, these functions render concrete method stub text
 * plus `use` import lines.
 *
 * Design constraints:
 *  - Pure string rendering — no side-effects, no I/O.
 *  - We generate a CONCRETE implementation, so the `abstract` / `final`
 *    modifiers are never emitted and the visibility is always `public`
 *    (interface members are implicitly public).
 *  - The default body is a safe `throw` (it type-checks against every return
 *    type); `void` / `never` returns get a TODO-only body since they must not
 *    return a value. We never emit a `return` that could mismatch the type.
 *  - A PHPDoc block is only emitted when it carries MORE information than the
 *    native signature (e.g. phpstan generics) — otherwise it is noise.
 */

export type PhpStubBodyStyle = "throw" | "todo";

export interface RenderMethodStubOptions {
  bodyStyle?: PhpStubBodyStyle;
  indent?: string;
}

const DEFAULT_INDENT = "    ";
const BODY_STEP = "    ";
const THROW_BODY = "throw new \\RuntimeException('Not implemented');";
const NO_RETURN_TYPES = new Set(["void", "never"]);

export function renderMethodStub(
  member: PhpMethodMember,
  options: RenderMethodStubOptions = {},
): string {
  const indent = options.indent ?? DEFAULT_INDENT;
  const bodyStyle = options.bodyStyle ?? "throw";

  const header = `${indent}${renderSignature(member)}`;
  const body = renderBody(member, bodyStyle, indent);
  const stub = [header, `${indent}{`, ...body, `${indent}}`].join("\n");

  const docBlock = renderPhpDocBlock(member, indent);

  if (!docBlock) {
    return stub;
  }

  return `${docBlock}\n${stub}`;
}

export function renderImplementMethodsStubs(
  members: PhpMethodMember[],
  options: RenderMethodStubOptions = {},
): string {
  return members
    .map((member) => renderMethodStub(member, options))
    .join("\n\n");
}

export function renderUseImports(fqns: string[]): string {
  const normalized = fqns
    .map(stripLeadingBackslash)
    .filter((fqn) => fqn.length > 0);

  const unique = Array.from(new Set(normalized)).sort((a, b) =>
    a.localeCompare(b),
  );

  return unique.map((fqn) => `use ${fqn};`).join("\n");
}

function renderSignature(member: PhpMethodMember): string {
  const staticKeyword = member.isStatic ? "static " : "";
  const params = member.parameters.map(renderParameter).join(", ");
  const returnSuffix = member.returnType ? `: ${member.returnType}` : "";

  return `public ${staticKeyword}function ${member.name}(${params})${returnSuffix}`;
}

function renderParameter(parameter: PhpStructuredParameter): string {
  const typePrefix = parameter.type ? `${parameter.type} ` : "";
  const byRef = parameter.isByRef ? "&" : "";
  const variadic = parameter.isVariadic ? "..." : "";
  const defaultSuffix =
    parameter.defaultValue === null ? "" : ` = ${parameter.defaultValue}`;

  return `${typePrefix}${byRef}${variadic}${parameter.name}${defaultSuffix}`;
}

function renderBody(
  member: PhpMethodMember,
  bodyStyle: PhpStubBodyStyle,
  indent: string,
): string[] {
  const bodyIndent = `${indent}${BODY_STEP}`;

  if (bodyStyle === "todo" || isNoReturnType(member.returnType)) {
    return [`${bodyIndent}// TODO: Implement ${member.name}().`];
  }

  return [`${bodyIndent}${THROW_BODY}`];
}

function isNoReturnType(returnType: string | null): boolean {
  if (!returnType) {
    return false;
  }

  return NO_RETURN_TYPES.has(returnType.toLowerCase());
}

function renderPhpDocBlock(
  member: PhpMethodMember,
  indent: string,
): string | null {
  if (!member.phpDoc || !phpDocAddsValue(member)) {
    return null;
  }

  const lines = phpDocLines(member.phpDoc.raw);

  if (lines.length === 0) {
    return null;
  }

  return lines.map((line) => `${indent}${line}`).join("\n");
}

function phpDocLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(normalizeDocLine);
}

function normalizeDocLine(line: string): string {
  if (line.startsWith("/**")) {
    return line;
  }

  if (line.startsWith("*")) {
    return ` ${line}`;
  }

  return ` * ${line}`;
}

function phpDocAddsValue(member: PhpMethodMember): boolean {
  const phpDoc = member.phpDoc;

  if (!phpDoc) {
    return false;
  }

  if (returnTypeAddsValue(phpDoc, member.returnType)) {
    return true;
  }

  return member.parameters.some((parameter) =>
    paramTypeAddsValue(phpDoc, parameter),
  );
}

function returnTypeAddsValue(
  phpDoc: PhpMethodPhpDoc,
  nativeReturnType: string | null,
): boolean {
  if (!phpDoc.returnType) {
    return false;
  }

  return !typesEquivalent(phpDoc.returnType, nativeReturnType);
}

function paramTypeAddsValue(
  phpDoc: PhpMethodPhpDoc,
  parameter: PhpStructuredParameter,
): boolean {
  const docType = phpDoc.params[stripDollar(parameter.name)];

  if (!docType) {
    return false;
  }

  return !typesEquivalent(docType, parameter.type);
}

function typesEquivalent(docType: string, nativeType: string | null): boolean {
  if (!nativeType) {
    return false;
  }

  return (
    normalizeTypeForComparison(docType) ===
    normalizeTypeForComparison(nativeType)
  );
}

function normalizeTypeForComparison(type: string): string {
  return type.replace(/\s+/g, "").toLowerCase();
}

function stripDollar(name: string): string {
  return name.startsWith("$") ? name.slice(1) : name;
}

function stripLeadingBackslash(fqn: string): string {
  return fqn.trim().replace(/^\\+/, "");
}
