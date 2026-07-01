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
 *    modifiers are never emitted. Visibility is preserved from the missing
 *    abstract/interface member; interface members are already modeled as public.
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

/**
 * Renders an OVERRIDE stub for a concrete parent method (PhpStorm "Override
 * Methods"). Unlike `renderMethodStub` (which implements abstract/interface
 * members with a placeholder body), an override:
 *  - PRESERVES the parent's visibility (`public` / `protected`) and the
 *    `static` modifier — overriding must not narrow visibility, and a static
 *    override stays static.
 *  - delegates to the parent via `parent::method(...)`, forwarding every
 *    parameter by name. A variadic parameter is spread (`...$rest`); a by-ref
 *    parameter is forwarded as a plain argument (the `&` lives only in the
 *    signature, never at the call site).
 *  - `return`s the delegated value unless the return type is `void` / `never`
 *    (those must not return a value).
 *  - carries an `@inheritDoc` PHPDoc block (PhpStorm convention) so the
 *    inherited documentation is reused.
 * The `abstract` / `final` modifiers are never emitted on the override.
 */
export function renderOverrideMethodStub(
  member: PhpMethodMember,
  options: RenderMethodStubOptions = {},
): string {
  const indent = options.indent ?? DEFAULT_INDENT;

  const header = `${indent}${renderOverrideSignature(member)}`;
  const body = renderOverrideBody(member, indent);
  const stub = [header, `${indent}{`, ...body, `${indent}}`].join("\n");
  const docBlock = renderInheritDocBlock(indent);

  return `${docBlock}\n${stub}`;
}

export function renderOverrideMethodsStubs(
  members: PhpMethodMember[],
  options: RenderMethodStubOptions = {},
): string {
  return members
    .map((member) => renderOverrideMethodStub(member, options))
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

  return `${member.visibility} ${staticKeyword}function ${member.name}(${params})${returnSuffix}`;
}

function renderOverrideSignature(member: PhpMethodMember): string {
  const staticKeyword = member.isStatic ? "static " : "";
  const params = member.parameters.map(renderParameter).join(", ");
  const returnSuffix = member.returnType ? `: ${member.returnType}` : "";

  return `${member.visibility} ${staticKeyword}function ${member.name}(${params})${returnSuffix}`;
}

function renderOverrideBody(member: PhpMethodMember, indent: string): string[] {
  const bodyIndent = `${indent}${BODY_STEP}`;
  const args = member.parameters.map(renderParentCallArgument).join(", ");
  const call = `parent::${member.name}(${args});`;

  if (isNoReturnType(member.returnType)) {
    return [`${bodyIndent}${call}`];
  }

  return [`${bodyIndent}return ${call}`];
}

function renderParentCallArgument(parameter: PhpStructuredParameter): string {
  const spread = parameter.isVariadic ? "..." : "";

  return `${spread}${parameter.name}`;
}

function renderInheritDocBlock(indent: string): string {
  return [`${indent}/**`, `${indent} * @inheritDoc`, `${indent} */`].join("\n");
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
