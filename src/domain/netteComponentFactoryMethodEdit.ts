import type { LanguageServerTextEdit } from "./languageServerFeatures";
import { canProveNoUnresolvedNetteAddComponentCalls } from "./netteComponentRegistrationProof";
import { netteAddComponentRegistrations, netteCreateComponentMethodName } from "./netteComponents";
import type {
  SemanticEditClosedDocumentIdentity,
  SemanticEditOpenDocumentIdentity,
  SemanticEditWorkspaceIdentity,
} from "./semanticWorkspaceEditCas";
import {
  parsePhpClassStructure,
  phpTopLevelTypeDeclarationNames,
  type PhpClassStructure,
} from "./phpClassStructure";
import { maskPhpSource } from "./phpSourceMask";

export type NetteComponentFactoryDocumentIdentity =
  SemanticEditClosedDocumentIdentity | SemanticEditOpenDocumentIdentity;

export interface NetteComponentFactoryParserCleanProof {
  readonly contentHash: string;
  readonly kind: "parser-clean";
  readonly pathKey: string;
}

export interface NetteComponentFactoryHierarchyClass {
  /** Exact fully-qualified class name without a leading backslash. */
  readonly className: string;
  readonly identity: NetteComponentFactoryDocumentIdentity;
  /** Full-parser proof bound to this exact document identity. */
  readonly parserProof: NetteComponentFactoryParserCleanProof;
  readonly source: string;
}

export type NetteComponentFactorySyntaxStrategy =
  | Readonly<{
      capability: "nette-ui-native-types-v1";
      kind: "native";
      phpVersion: "7.1" | "7.2" | "7.3" | "7.4" | "8.0" | "8.1" | "8.2" | "8.3" | "8.4";
    }>
  | Readonly<{
      capability: "nette-ui-phpdoc-types-v1";
      kind: "phpdoc";
      phpVersion: "7.0" | "7.1" | "7.2" | "7.3" | "7.4" | "8.0" | "8.1" | "8.2" | "8.3" | "8.4";
    }>;

export interface NetteComponentFactoryMethodEditRequest {
  readonly ancestors: readonly NetteComponentFactoryHierarchyClass[];
  readonly componentName: string;
  readonly methodName: string;
  readonly owner: NetteComponentFactoryHierarchyClass;
  readonly syntax: NetteComponentFactorySyntaxStrategy;
  readonly usageKind: "control" | "form";
  readonly workspace: SemanticEditWorkspaceIdentity;
}

export interface NetteComponentFactoryMethodEditPlan {
  readonly edit: LanguageServerTextEdit;
  readonly methodName: string;
  readonly ownerPath: string;
}

interface NamespaceRegion {
  end: number;
  name: string;
  start: number;
}

interface MemberProof {
  hasTraitUse: boolean;
  memberStarts: number[];
  methodNames: string[];
}

interface ClassAnalysis {
  memberProof: MemberProof;
  parentClassName: string;
  region: NamespaceRegion;
  structure: PhpClassStructure;
}

interface InsertionStyle {
  bodyIndent: string;
  classIndent: string;
  kind: "closing-line" | "inline-empty";
  memberIndent: string;
  offset: number;
}

const MAX_SOURCE_CHARACTERS = 750_000;
const MAX_COMPONENT_NAME_CHARACTERS = 128;
const MAX_IDENTITY_CHARACTERS = 4_096;
const MAX_HIERARCHY_DEPTH = 32;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const GENERIC_FACTORY_METHOD = "createcomponent";
const NETTE_UI_BASES = new Set([
  "nette\\application\\ui\\control",
  "nette\\application\\ui\\presenter",
]);
const SUPPORTED_PHP_VERSIONS = new Set([
  "7.0",
  "7.1",
  "7.2",
  "7.3",
  "7.4",
  "8.0",
  "8.1",
  "8.2",
  "8.3",
  "8.4",
]);
const NATIVE_RETURN_TYPE_PHP_VERSIONS = new Set([
  "7.1",
  "7.2",
  "7.3",
  "7.4",
  "8.0",
  "8.1",
  "8.2",
  "8.3",
  "8.4",
]);
const MEMBER_MODIFIER = /^(?:abstract|final|private|protected|public|readonly|static)\b/i;

/**
 * Plans one insertion from an immutable, authority-checked hierarchy capture.
 * This pure boundary never applies the edit and has no UI/CAS/native wiring.
 */
export function planNetteComponentFactoryMethodEdit(
  request: NetteComponentFactoryMethodEditRequest,
): NetteComponentFactoryMethodEditPlan | null {
  if (!validRequest(request)) {
    return null;
  }

  const canonicalMethodName = netteCreateComponentMethodName(request.componentName);

  if (canonicalMethodName.toLowerCase() !== request.methodName.toLowerCase()) {
    return null;
  }

  const hierarchy = [request.owner, ...request.ancestors];
  const analyses: ClassAnalysis[] = [];

  for (const capture of hierarchy) {
    const analysis = analyzeHierarchyClass(capture);

    if (
      !analysis ||
      analysis.memberProof.hasTraitUse ||
      !hasProvenFactoryAbsence(capture.source, request.componentName, canonicalMethodName, analysis)
    ) {
      return null;
    }
    analyses.push(analysis);
  }

  if (!hasExactNetteHierarchy(hierarchy, analyses)) {
    return null;
  }

  const newline = sourceNewline(request.owner.source);
  const ownerAnalysis = analyses[0];

  if (!newline || !ownerAnalysis) {
    return null;
  }

  const insertion = insertionStyle(request.owner.source, ownerAnalysis, newline);

  if (!insertion) {
    return null;
  }

  const stub = componentFactoryStub(
    canonicalMethodName,
    request.usageKind,
    request.syntax,
    insertion.memberIndent,
    insertion.bodyIndent,
    newline,
  );

  if (!stub) {
    return null;
  }

  const newText =
    insertion.kind === "closing-line"
      ? `${stub}${newline}${newline}`
      : `${newline}${stub}${newline}${insertion.classIndent}`;
  const position = lspPositionAt(request.owner.source, insertion.offset);
  const edit = Object.freeze({
    newText,
    range: Object.freeze({
      end: Object.freeze({ ...position }),
      start: Object.freeze({ ...position }),
    }),
  });

  return Object.freeze({
    edit,
    methodName: canonicalMethodName,
    ownerPath: request.owner.identity.pathKey,
  });
}

function validRequest(request: NetteComponentFactoryMethodEditRequest): boolean {
  if (
    request === null ||
    typeof request !== "object" ||
    !Array.isArray(request.ancestors) ||
    request.ancestors.length > MAX_HIERARCHY_DEPTH ||
    typeof request.componentName !== "string" ||
    request.componentName.length > MAX_COMPONENT_NAME_CHARACTERS ||
    !/^[a-z][A-Za-z0-9_]*$/.test(request.componentName) ||
    !validPhpIdentifier(request.methodName) ||
    (request.usageKind !== "control" && request.usageKind !== "form") ||
    !validSyntax(request.syntax)
  ) {
    return false;
  }

  const captures = [request.owner, ...request.ancestors];
  const pathKeys = new Set<string>();

  return (
    validWorkspaceIdentity(request.workspace) &&
    captures.every((capture) => {
      if (
        !validCapture(capture) ||
        pathKeys.has(capture.identity.pathKey) ||
        capture.parserProof.pathKey !== capture.identity.pathKey ||
        capture.parserProof.contentHash !== capture.identity.contentHash ||
        !pathWithinWorkspace(request.workspace.rootKey, capture.identity.pathKey)
      ) {
        return false;
      }
      pathKeys.add(capture.identity.pathKey);
      return true;
    })
  );
}

function validCapture(capture: NetteComponentFactoryHierarchyClass): boolean {
  return (
    capture !== null &&
    typeof capture === "object" &&
    validQualifiedPhpName(capture.className) &&
    typeof capture.source === "string" &&
    capture.source.length <= MAX_SOURCE_CHARACTERS &&
    validDocumentIdentity(capture.identity) &&
    capture.parserProof?.kind === "parser-clean" &&
    validIdentity(capture.parserProof.pathKey) &&
    validHash(capture.parserProof.contentHash)
  );
}

function validDocumentIdentity(identity: NetteComponentFactoryDocumentIdentity): boolean {
  if (!identity || typeof identity !== "object") {
    return false;
  }

  return (
    validHash(identity.contentHash) &&
    validIdentity(identity.pathKey) &&
    safeNonNegativeInteger(identity.hostEpoch) &&
    (identity.kind === "open"
      ? safeNonNegativeInteger(identity.lifecycle) &&
        safeNonNegativeInteger(identity.sessionId) &&
        safeNonNegativeInteger(identity.version)
      : identity.kind === "closed" && safeNonNegativeInteger(identity.revision))
  );
}

function validSyntax(strategy: NetteComponentFactorySyntaxStrategy): boolean {
  if (!strategy || typeof strategy !== "object") {
    return false;
  }

  return strategy.kind === "phpdoc"
    ? strategy.capability === "nette-ui-phpdoc-types-v1" &&
        SUPPORTED_PHP_VERSIONS.has(strategy.phpVersion)
    : strategy.kind === "native" &&
        strategy.capability === "nette-ui-native-types-v1" &&
        NATIVE_RETURN_TYPE_PHP_VERSIONS.has(strategy.phpVersion);
}

function analyzeHierarchyClass(capture: NetteComponentFactoryHierarchyClass): ClassAnalysis | null {
  const classParts = capture.className.split("\\");
  const shortName = classParts[classParts.length - 1];
  const namespace = classParts.slice(0, -1).join("\\");
  const regions = phpNamespaceRegions(capture.source);

  if (!shortName || !regions) {
    return null;
  }

  const matchingRegions = regions.filter(
    (region) => region.name.toLowerCase() === namespace.toLowerCase(),
  );

  if (matchingRegions.length !== 1) {
    return null;
  }

  const region = matchingRegions[0]!;
  const regionSource = capture.source.slice(region.start, region.end);
  const declarations = phpTopLevelTypeDeclarationNames(regionSource).filter(
    (name) => name.toLowerCase() === shortName.toLowerCase(),
  );

  if (declarations.length !== 1) {
    return null;
  }

  const declaredName = declarations[0]!;
  const structure = parsePhpClassStructure(regionSource, declaredName);

  if (
    !structure.typeDeclaration ||
    structure.typeDeclaration.name.toLowerCase() !== shortName.toLowerCase() ||
    (structure.kind !== "class" && structure.kind !== "abstract-class") ||
    !structure.propertyParsingComplete
  ) {
    return null;
  }

  const memberProof = proveCompleteClassMembers(regionSource, structure);
  const parentToken = declaredParentToken(regionSource, declaredName, structure);

  if (!memberProof || !parentToken) {
    return null;
  }

  const parentClassName = resolveClassName(parentToken, namespace, namespaceImports(regionSource));

  return parentClassName ? { memberProof, parentClassName, region, structure } : null;
}

function hasExactNetteHierarchy(
  captures: readonly NetteComponentFactoryHierarchyClass[],
  analyses: readonly ClassAnalysis[],
): boolean {
  for (let index = 0; index < captures.length; index += 1) {
    const parent = analyses[index]?.parentClassName.toLowerCase();

    if (!parent) {
      return false;
    }

    const next = captures[index + 1];

    if (next) {
      if (parent !== next.className.toLowerCase()) {
        return false;
      }
    } else if (!NETTE_UI_BASES.has(parent)) {
      return false;
    }
  }

  return true;
}

function hasProvenFactoryAbsence(
  source: string,
  componentName: string,
  canonicalMethodName: string,
  analysis: ClassAnalysis,
): boolean {
  const declaration = analysis.structure.typeDeclaration;

  if (!declaration) {
    return false;
  }

  const desired = canonicalMethodName.toLowerCase();
  const body = source
    .slice(analysis.region.start, analysis.region.end)
    .slice(declaration.bodyStartOffset + 1, declaration.bodyEndOffset);

  return (
    !analysis.memberProof.methodNames.some((name) => {
      const normalized = name.toLowerCase();
      return normalized === desired || normalized === GENERIC_FACTORY_METHOD;
    }) &&
    !netteAddComponentRegistrations(body).some(
      (registration) => registration.name.toLowerCase() === componentName.toLowerCase(),
    ) &&
    canProveNoUnresolvedNetteAddComponentCalls(body)
  );
}

function phpNamespaceRegions(source: string): NamespaceRegion[] | null {
  const masked = maskPhpSource(source);
  const pattern = /\bnamespace\s*([A-Za-z_][A-Za-z0-9_]*(?:\\[A-Za-z_][A-Za-z0-9_]*)*)?\s*([;{])/g;
  const matches = [...masked.matchAll(pattern)];

  if (matches.length === 0) {
    return [{ end: source.length, name: "", start: 0 }];
  }

  const style = matches[0]?.[2];

  if (!style || matches.some((match) => match[2] !== style)) {
    return null;
  }

  const regions: NamespaceRegion[] = [];

  if (style === ";") {
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index]!;
      regions.push({
        end: matches[index + 1]?.index ?? source.length,
        name: match[1] ?? "",
        start: (match.index ?? 0) + match[0].length,
      });
    }
    return regions;
  }

  let previousEnd = -1;

  for (const match of matches) {
    const opening = (match.index ?? 0) + match[0].lastIndexOf("{");

    if (opening < previousEnd) {
      return null;
    }

    const closing = matchingOffset(masked, opening, "{", "}");

    if (closing === null) {
      return null;
    }
    previousEnd = closing;
    regions.push({ end: closing, name: match[1] ?? "", start: opening + 1 });
  }

  return regions;
}

function namespaceImports(source: string): ReadonlyMap<string, string> | null {
  const masked = maskPhpSource(source);
  const imports = new Map<string, string>();
  const statements = /\buse\b[\s\S]*?;/gi;
  const singleImport =
    /^use\s+([A-Za-z_][A-Za-z0-9_]*(?:\\[A-Za-z_][A-Za-z0-9_]*)*)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?\s*;$/i;

  for (const statement of masked.matchAll(statements)) {
    if (braceDepthAt(masked, statement.index ?? 0) !== 0) {
      continue;
    }

    const match = singleImport.exec(statement[0]);

    if (!match) {
      return null;
    }

    const imported = match[1];
    const importedParts = imported?.split("\\") ?? [];
    const alias = match[2] ?? importedParts[importedParts.length - 1];

    if (!imported || !alias || imports.has(alias.toLowerCase())) {
      return null;
    }
    imports.set(alias.toLowerCase(), imported);
  }

  return imports;
}

function declaredParentToken(
  source: string,
  className: string,
  structure: PhpClassStructure,
): string | null {
  const bodyStart = structure.typeDeclaration?.bodyStartOffset;

  if (bodyStart === undefined) {
    return null;
  }

  const masked = maskPhpSource(source);
  const pattern = new RegExp(
    `\\b(?:abstract\\s+|final\\s+|readonly\\s+)*class\\s+${escapeRegExp(className)}\\b([^{}]*)`,
    "gi",
  );

  for (const match of masked.matchAll(pattern)) {
    const opening = masked.indexOf("{", (match.index ?? 0) + match[0].length);

    if (opening !== bodyStart) {
      continue;
    }

    return /\bextends\s+([\\A-Za-z_][\\A-Za-z0-9_]*)/i.exec(match[1] ?? "")?.[1] ?? null;
  }

  return null;
}

function resolveClassName(
  token: string,
  namespace: string,
  imports: ReadonlyMap<string, string> | null,
): string | null {
  if (!imports) {
    return null;
  }

  if (token.startsWith("\\")) {
    return token.slice(1);
  }

  if (token.toLowerCase().startsWith("namespace\\")) {
    const relative = token.slice("namespace\\".length);
    return namespace ? `${namespace}\\${relative}` : relative;
  }

  if (token.includes("\\")) {
    const [head, ...tail] = token.split("\\");
    const imported = imports.get(head!.toLowerCase());

    return imported ? [imported, ...tail].join("\\") : namespace ? `${namespace}\\${token}` : token;
  }

  return imports.get(token.toLowerCase()) ?? (namespace ? `${namespace}\\${token}` : token);
}

function proveCompleteClassMembers(
  source: string,
  structure: PhpClassStructure,
): MemberProof | null {
  const declaration = structure.typeDeclaration;

  if (!declaration) {
    return null;
  }

  const masked = maskPhpSource(source);
  const memberStarts: number[] = [];
  const methodNames: string[] = [];
  let hasTraitUse = false;
  let offset = declaration.bodyStartOffset + 1;

  while (offset < declaration.bodyEndOffset) {
    const gapStart = offset;
    offset = skipWhitespace(masked, offset, declaration.bodyEndOffset);

    if (offset >= declaration.bodyEndOffset) {
      break;
    }

    const attributeStart = completeLeadingAttributeStart(source, gapStart, offset);

    if (attributeStart === false) {
      return null;
    }

    const memberStart = attributeStart ?? offset;
    const prefix = consumeMemberPrefix(masked, offset, declaration.bodyEndOffset);

    if (!prefix) {
      return null;
    }
    offset = prefix.offset;
    const remainder = masked.slice(offset, declaration.bodyEndOffset);

    if (/^use\b/i.test(remainder)) {
      hasTraitUse = true;
    }

    const method = /^function\s+&?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/i.exec(remainder);

    if (method) {
      const end = completeMethodEnd(masked, offset, declaration.bodyEndOffset);

      if (end === null) {
        return null;
      }
      const parsedMethod = structure.methods.find(
        (candidate) => candidate.declarationOffset === offset,
      );
      memberStarts.push(parsedMethod?.memberStartOffset ?? memberStart);
      methodNames.push(method[1]!);
      offset = end;
      continue;
    }

    const statementEnd = completeStatementEnd(masked, offset, declaration.bodyEndOffset);

    if (statementEnd === null) {
      return null;
    }

    const statement = masked.slice(offset, statementEnd);
    const originalStatement = source.slice(offset, statementEnd);
    const isTrait = /^use\b/i.test(statement);
    const isConstant = validConstantStatement(originalStatement);
    const isProperty = structure.propertyDeclarations.some(
      (property) =>
        property.isComplete &&
        property.startOffset >= memberStart &&
        property.endOffset <= statementEnd,
    );

    if (!isTrait && !isConstant && !isProperty) {
      return null;
    }

    memberStarts.push(memberStart);
    offset = statementEnd;
  }

  return { hasTraitUse, memberStarts, methodNames };
}

function completeLeadingAttributeStart(
  source: string,
  gapStart: number,
  tokenOffset: number,
): number | null | false {
  const gap = source.slice(gapStart, tokenOffset);
  const attribute = gap.indexOf("#[");

  if (attribute < 0) {
    return null;
  }

  const absolute = gapStart + attribute;
  const start = lineStartAt(source, absolute);
  const lines = source.slice(start, tokenOffset).split(/\r?\n/);

  if (lines.some((line) => line.trim() && !/^[ \t]*#\[[^\r\n]*\][ \t]*$/.test(line))) {
    return false;
  }

  return absolute;
}

function consumeMemberPrefix(
  source: string,
  start: number,
  limit: number,
): { offset: number } | null {
  let offset = start;

  while (offset < limit) {
    offset = skipWhitespace(source, offset, limit);

    if (source.startsWith("#[", offset)) {
      const end = matchingOffset(source, offset + 1, "[", "]");

      if (end === null || end >= limit) {
        return null;
      }
      offset = end + 1;
      continue;
    }

    const modifier = MEMBER_MODIFIER.exec(source.slice(offset, limit));

    if (!modifier) {
      break;
    }
    offset += modifier[0].length;
  }

  return { offset: skipWhitespace(source, offset, limit) };
}

function completeMethodEnd(source: string, start: number, limit: number): number | null {
  let parentheses = 0;
  let brackets = 0;

  for (let offset = start; offset < limit; offset += 1) {
    const character = source[offset];

    if (character === "(") parentheses += 1;
    else if (character === ")") {
      parentheses -= 1;
      if (parentheses < 0) return null;
    } else if (character === "[") brackets += 1;
    else if (character === "]") {
      brackets -= 1;
      if (brackets < 0) return null;
    } else if (parentheses === 0 && brackets === 0 && character === ";") {
      return offset + 1;
    } else if (parentheses === 0 && brackets === 0 && character === "{") {
      const closing = matchingOffset(source, offset, "{", "}");
      return closing === null || closing >= limit ? null : closing + 1;
    }
  }

  return null;
}

function completeStatementEnd(source: string, start: number, limit: number): number | null {
  const stack: string[] = [];

  for (let offset = start; offset < limit; offset += 1) {
    const character = source[offset]!;

    if (character === "(" || character === "[" || character === "{") {
      stack.push(character);
    } else if (character === ")" || character === "]" || character === "}") {
      const expected = character === ")" ? "(" : character === "]" ? "[" : "{";
      if (stack.pop() !== expected) return null;
    } else if (character === ";" && stack.length === 0) {
      return offset + 1;
    }
  }

  return null;
}

function validConstantStatement(statement: string): boolean {
  const value = statement.trim().replace(/;$/, "").trim();

  if (!/^const\b/i.test(value)) {
    return false;
  }

  const assignments = splitTopLevel(value.replace(/^const\b/i, "").trim(), ",");

  return (
    assignments.length > 0 &&
    assignments.every((assignment) => {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\S[\s\S]*)$/.exec(assignment.trim());
      return Boolean(match);
    })
  );
}

function splitTopLevel(value: string, delimiter: string): string[] {
  const result: string[] = [];
  const stack: string[] = [];
  let start = 0;

  for (let offset = 0; offset < value.length; offset += 1) {
    const character = value[offset]!;
    if (character === "(" || character === "[" || character === "{") stack.push(character);
    else if (character === ")" || character === "]" || character === "}") stack.pop();
    else if (character === delimiter && stack.length === 0) {
      result.push(value.slice(start, offset));
      start = offset + 1;
    }
  }
  result.push(value.slice(start));
  return result;
}

function insertionStyle(
  source: string,
  analysis: ClassAnalysis,
  newline: "\n" | "\r\n",
): InsertionStyle | null {
  const declaration = analysis.structure.typeDeclaration;

  if (!declaration) {
    return null;
  }

  const bodyStart = analysis.region.start + declaration.bodyStartOffset;
  const bodyEnd = analysis.region.start + declaration.bodyEndOffset;

  if (source[bodyEnd] !== "}") {
    return null;
  }

  const classLineStart = lineStartAt(source, bodyStart);
  const classIndent = /^[ \t]*/.exec(source.slice(classLineStart, bodyStart))?.[0] ?? "";
  const memberOffsets = analysis.memberProof.memberStarts.map(
    (offset) => analysis.region.start + offset,
  );
  const existingIndent = existingMemberIndent(source, memberOffsets, classIndent);

  if (existingIndent === false) {
    return null;
  }

  const memberIndent = existingIndent ?? `${classIndent}    `;
  const indentUnit = memberIndent.slice(classIndent.length);

  if (!indentUnit || !/^[ \t]+$/.test(indentUnit)) {
    return null;
  }

  const bodyIndent = `${memberIndent}${indentUnit}`;
  const closingLineStart = lineStartAt(source, bodyEnd);
  const closingPrefix = source.slice(closingLineStart, bodyEnd);

  if (/^[ \t]*$/.test(closingPrefix)) {
    return {
      bodyIndent,
      classIndent,
      kind: "closing-line",
      memberIndent,
      offset: closingLineStart,
    };
  }

  const body = source.slice(bodyStart + 1, bodyEnd);

  if (body.trim() || body.includes(newline)) {
    return null;
  }

  return {
    bodyIndent,
    classIndent,
    kind: "inline-empty",
    memberIndent,
    offset: bodyEnd,
  };
}

function existingMemberIndent(
  source: string,
  offsets: readonly number[],
  classIndent: string,
): string | null | false {
  const indents = new Set(
    offsets.map((offset) => {
      const start = lineStartAt(source, offset);
      const prefix = source.slice(start, offset);
      return /^[ \t]*$/.test(prefix) ? prefix : "";
    }),
  );

  if (indents.has("")) {
    return false;
  }
  if (indents.size === 0) {
    return null;
  }
  if (indents.size !== 1) {
    return false;
  }

  const [indent] = indents;
  return indent?.startsWith(classIndent) && indent.length > classIndent.length ? indent : false;
}

function componentFactoryStub(
  methodName: string,
  kind: "control" | "form",
  strategy: NetteComponentFactorySyntaxStrategy,
  memberIndent: string,
  bodyIndent: string,
  newline: "\n" | "\r\n",
): string | null {
  const returnType =
    kind === "form" ? "\\Nette\\Application\\UI\\Form" : "\\Nette\\ComponentModel\\IComponent";
  const declaration =
    strategy.kind === "native"
      ? [`${memberIndent}protected function ${methodName}(): ${returnType}`]
      : [
          `${memberIndent}/** @return ${returnType} */`,
          `${memberIndent}protected function ${methodName}()`,
        ];
  const body =
    kind === "form"
      ? [
          `${memberIndent}{`,
          `${bodyIndent}$form = new \\Nette\\Application\\UI\\Form();`,
          `${bodyIndent}// TODO: Configure form fields and handlers.`,
          `${bodyIndent}return $form;`,
          `${memberIndent}}`,
        ]
      : [
          `${memberIndent}{`,
          `${bodyIndent}throw new \\RuntimeException('TODO: Implement ${methodName}().');`,
          `${memberIndent}}`,
        ];

  return [...declaration, ...body].join(newline);
}

function sourceNewline(source: string): "\n" | "\r\n" | null {
  const withoutCrlf = source.split("\r\n").join("");
  if (withoutCrlf.includes("\r")) return null;
  if (source.includes("\r\n") && withoutCrlf.includes("\n")) return null;
  return source.includes("\r\n") ? "\r\n" : "\n";
}

function lspPositionAt(source: string, offset: number): { character: number; line: number } {
  const before = source.slice(0, offset);
  const line = (before.match(/\n/g) ?? []).length;
  const lastNewline = before.lastIndexOf("\n");
  const lineStart = lastNewline < 0 ? 0 : lastNewline + 1;
  return { character: source.slice(lineStart, offset).length, line };
}

function lineStartAt(source: string, offset: number): number {
  const newline = source.lastIndexOf("\n", Math.max(0, offset - 1));
  return newline < 0 ? 0 : newline + 1;
}

function matchingOffset(
  source: string,
  opening: number,
  open: string,
  close: string,
): number | null {
  let depth = 0;
  for (let offset = opening; offset < source.length; offset += 1) {
    if (source[offset] === open) depth += 1;
    else if (source[offset] === close) {
      depth -= 1;
      if (depth === 0) return offset;
      if (depth < 0) return null;
    }
  }
  return null;
}

function braceDepthAt(source: string, target: number): number {
  let depth = 0;
  for (let offset = 0; offset < target; offset += 1) {
    if (source[offset] === "{") depth += 1;
    else if (source[offset] === "}") depth -= 1;
  }
  return depth;
}

function skipWhitespace(source: string, start: number, limit: number): number {
  let offset = start;
  while (offset < limit && /\s/.test(source[offset] ?? "")) offset += 1;
  return offset;
}

function validIdentity(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_IDENTITY_CHARACTERS &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function validPhpIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_COMPONENT_NAME_CHARACTERS &&
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
  );
}

function validQualifiedPhpName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_IDENTITY_CHARACTERS &&
    value.split("\\").every((part) => validPhpIdentifier(part))
  );
}

function validWorkspaceIdentity(identity: SemanticEditWorkspaceIdentity): boolean {
  return (
    identity !== null &&
    typeof identity === "object" &&
    validIdentity(identity.ownerKey) &&
    validIdentity(identity.rootKey) &&
    safeNonNegativeInteger(identity.generation) &&
    safeNonNegativeInteger(identity.sessionId)
  );
}

function validHash(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    /^[A-Za-z0-9:_-]+$/.test(value)
  );
}

function pathWithinWorkspace(rootKey: string, pathKey: string): boolean {
  const suffix = pathKey.startsWith(rootKey) ? pathKey.slice(rootKey.length) : "";
  return Boolean(suffix) && (suffix.startsWith("/") || suffix.startsWith("\\"));
}

function safeNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= MAX_SAFE_INTEGER;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
