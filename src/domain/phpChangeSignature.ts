export interface PhpChangeSignatureParameter {
  /** Existing parameter name without `$`; null means a newly added parameter. */
  sourceName: string | null;
  /** Complete PHP parameter declaration, for example `?User $user = null`. */
  declaration: string;
  /** Expression inserted at existing call sites. Required for a new required parameter. */
  callArgument?: string;
}

export interface PhpChangeSignatureEditableParameter {
  byReference: boolean;
  defaultValue: string;
  modifiers: string;
  name: string;
  sourceName: string;
  type: string;
  variadic: boolean;
}

export interface PhpChangeSignatureCallable {
  parameters: readonly PhpChangeSignatureEditableParameter[];
}

export type PhpChangeSignatureCompletenessTarget =
  | { kind: "safe"; name: string; target: "function" | "method" }
  | {
      kind: "rejected";
      reason: "hierarchyAmbiguity" | "unsupportedDeclaration";
    };

export type PhpChangeSignatureReferenceShape =
  | "declaration"
  | "directCall"
  | "unsupported";

export interface PhpChangeSignatureDocument {
  /** Content hash captured from the native file snapshot for a closed file. */
  contentHash?: string | null;
  content: string;
  path: string;
  /** Monaco/LSP version. `null` means the file is not an open, versioned buffer. */
  version: number | null;
}

export interface PhpChangeSignatureReference {
  offset: number;
  path: string;
  /** Semantic role assigned by the reference resolver. Inference is a compatibility fallback. */
  role?: "call" | "declaration";
}

export interface PhpChangeSignatureEdit {
  end: number;
  path: string;
  start: number;
  text: string;
  version: number | null;
}

export interface PhpChangeSignaturePreview {
  edits: readonly PhpChangeSignatureEdit[];
  filesChanged: number;
  referencesChanged: number;
  signature: string;
}

export type PhpChangeSignatureResult =
  | { kind: "planned"; preview: PhpChangeSignaturePreview }
  | {
      kind: "rejected";
      reason:
        | "ambiguousReference"
        | "duplicateParameter"
        | "invalidDeclaration"
        | "invalidReference"
        | "missingArgument"
        | "unsupportedSignature"
        | "overlappingEdits"
        | "unknownParameter";
    };

interface ParsedParameter {
  byReference: boolean;
  declaration: string;
  name: string;
  optional: boolean;
  variadic: boolean;
}

type RejectedChangeSignature = Extract<
  PhpChangeSignatureResult,
  { kind: "rejected" }
>;

interface ParsedArgument {
  expression: string;
  name: string | null;
}

interface ParenthesizedList {
  end: number;
  items: Array<{ end: number; start: number; text: string }>;
  start: number;
}

/**
 * Pure, strategy-neutral Change Signature planner. Reference discovery is kept
 * outside this module: callers must provide only semantically resolved LSP
 * references. Any reference that cannot be proven to be a declaration or a
 * direct call rejects the complete transaction.
 */
export function planPhpChangeSignature(options: {
  declaration: PhpChangeSignatureReference;
  documents: readonly PhpChangeSignatureDocument[];
  parameters: readonly PhpChangeSignatureParameter[];
  references: readonly PhpChangeSignatureReference[];
}): PhpChangeSignatureResult {
  const documents = new Map(
    options.documents.map((document) => [document.path, document]),
  );
  const declarationDocument = documents.get(options.declaration.path);

  if (!declarationDocument) {
    return { kind: "rejected", reason: "invalidDeclaration" };
  }

  const declarationList = callableParameterListAt(
    declarationDocument.content,
    options.declaration.offset,
  );

  if (
    !declarationList ||
    !isFunctionDeclaration(declarationDocument.content, declarationList.start)
  ) {
    return { kind: "rejected", reason: "invalidDeclaration" };
  }

  const oldParameters = declarationList.items.map((item) =>
    parseParameter(item.text),
  );

  if (oldParameters.some((parameter) => parameter === null)) {
    return { kind: "rejected", reason: "invalidDeclaration" };
  }

  const parsedOldParameters = oldParameters as ParsedParameter[];
  const requested = options.parameters.map((parameter) => ({
    ...parameter,
    parsed: parseParameter(parameter.declaration),
  }));

  if (requested.some((parameter) => parameter.parsed === null)) {
    return { kind: "rejected", reason: "invalidDeclaration" };
  }

  const requestedNames = requested.map((parameter) => parameter.parsed!.name);
  if (new Set(requestedNames).size !== requestedNames.length) {
    return { kind: "rejected", reason: "duplicateParameter" };
  }

  if (
    !isSupportedRequestedSignature(
      requested.map((parameter) => parameter.parsed!),
    )
  ) {
    return { kind: "rejected", reason: "unsupportedSignature" };
  }

  const sourceNames = requested.flatMap((parameter) =>
    parameter.sourceName === null ? [] : [normalizeName(parameter.sourceName)],
  );
  if (new Set(sourceNames).size !== sourceNames.length) {
    return { kind: "rejected", reason: "duplicateParameter" };
  }

  const oldByName = new Map(
    parsedOldParameters.map((parameter) => [parameter.name, parameter]),
  );
  for (const parameter of requested) {
    if (
      parameter.sourceName !== null &&
      !oldByName.has(normalizeName(parameter.sourceName))
    ) {
      return { kind: "rejected", reason: "unknownParameter" };
    }

    if (
      parameter.sourceName === null &&
      !parameter.parsed!.optional &&
      parameter.callArgument?.trim().length === 0
    ) {
      return { kind: "rejected", reason: "missingArgument" };
    }

    if (
      parameter.sourceName === null &&
      !parameter.parsed!.optional &&
      !parameter.callArgument
    ) {
      return { kind: "rejected", reason: "missingArgument" };
    }
  }

  const edits: PhpChangeSignatureEdit[] = [];
  const signatureText = requested
    .map((parameter) => parameter.declaration.trim())
    .join(", ");
  const referencesWithDeclaration = [
    options.declaration,
    ...options.references,
  ];
  if (hasConflictingReferenceRoles(referencesWithDeclaration)) {
    return { kind: "rejected", reason: "ambiguousReference" };
  }
  const allReferences = deduplicateReferences(referencesWithDeclaration);
  let referencesChanged = 0;

  for (const reference of allReferences) {
    const document = documents.get(reference.path);
    if (!document) {
      return { kind: "rejected", reason: "invalidReference" };
    }

    const list = callableParameterListAt(document.content, reference.offset);
    if (!list) {
      return { kind: "rejected", reason: "invalidReference" };
    }

    const isDeclaration =
      reference.role === "declaration" ||
      (reference.role !== "call" &&
        isFunctionDeclaration(document.content, list.start));
    if (isDeclaration) {
      const referenceParameters = list.items.map((item) =>
        parseParameter(item.text),
      );
      if (
        referenceParameters.some((parameter) => parameter === null) ||
        !sameParameterIdentity(
          parsedOldParameters,
          referenceParameters as ParsedParameter[],
        )
      ) {
        return { kind: "rejected", reason: "ambiguousReference" };
      }
      edits.push(editFor(document, list, signatureText));
      continue;
    }

    if (!isDirectCall(document.content, list.start)) {
      return { kind: "rejected", reason: "ambiguousReference" };
    }

    const argumentsResult = rewriteArguments(
      list.items.map((item) => item.text),
      parsedOldParameters,
      requested as Array<
        (typeof requested)[number] & { parsed: ParsedParameter }
      >,
    );
    if (argumentsResult.kind === "rejected") {
      return argumentsResult;
    }

    edits.push(editFor(document, list, argumentsResult.text));
    referencesChanged += 1;
  }

  const overlap = firstOverlappingEdit(edits);
  if (overlap) {
    return { kind: "rejected", reason: "overlappingEdits" };
  }

  return {
    kind: "planned",
    preview: {
      edits,
      filesChanged: new Set(edits.map((edit) => edit.path)).size,
      referencesChanged,
      signature: `(${signatureText})`,
    },
  };
}

/**
 * Describes a declaration for the Change Signature dialog without exposing the
 * planner's parser internals. Calls deliberately return null: the application
 * layer must resolve the symbol to its declaration before opening the dialog.
 */
export function inspectPhpChangeSignatureDeclaration(
  source: string,
  offset: number,
): PhpChangeSignatureCallable | null {
  const list = callableParameterListAt(source, offset);
  if (!list || !isFunctionDeclaration(source, list.start)) return null;

  const parameters: PhpChangeSignatureEditableParameter[] = [];
  for (const item of list.items) {
    const parsed = editableParameter(item.text);
    if (!parsed) return null;
    parameters.push(parsed);
  }

  return { parameters };
}

/**
 * Establishes whether an LSP reference set can be treated as complete for the
 * declaration. Global functions are not virtual. Methods are safe only when
 * PHP cannot dispatch them through an unknown override hierarchy.
 */
export function inspectPhpChangeSignatureCompletenessTarget(
  source: string,
  offset: number,
): PhpChangeSignatureCompletenessTarget {
  const list = callableParameterListAt(source, offset);
  if (!list || !isFunctionDeclaration(source, list.start)) {
    return { kind: "rejected", reason: "unsupportedDeclaration" };
  }

  const declaration = functionDeclarationPrefix(source, list.start);
  if (!declaration) {
    return { kind: "rejected", reason: "unsupportedDeclaration" };
  }
  const classLike = enclosingClassLike(source, list.start);
  if (!classLike) {
    return { kind: "safe", name: declaration.name, target: "function" };
  }
  if (classLike.kind !== "class") {
    return { kind: "rejected", reason: "hierarchyAmbiguity" };
  }
  if (/\babstract\b/i.test(declaration.modifiers)) {
    return { kind: "rejected", reason: "hierarchyAmbiguity" };
  }
  if (/\b(?:private|final)\b/i.test(declaration.modifiers)) {
    return { kind: "safe", name: declaration.name, target: "method" };
  }
  if (classLike.final) {
    return { kind: "safe", name: declaration.name, target: "method" };
  }
  return { kind: "rejected", reason: "hierarchyAmbiguity" };
}

export function inspectPhpChangeSignatureReferenceShape(
  source: string,
  offset: number,
): PhpChangeSignatureReferenceShape {
  const list = callableParameterListAt(source, offset);
  if (!list) return "unsupported";
  if (isFunctionDeclaration(source, list.start)) return "declaration";
  if (list.items.some((item) => item.text.trim().startsWith("..."))) {
    return "unsupported";
  }
  if (isDirectCall(source, list.start)) return "directCall";
  return "unsupported";
}

export function auditPhpChangeSignatureReferenceCoverage(
  source: string,
  callableName: string,
  coveredOffsets: readonly number[],
): { complete: true } | { complete: false; reason: "uncoveredStaticReference" | "dynamicCallable" } {
  const escaped = callableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const callableArray = new RegExp(
    `(?:\\[|,)\\s*(['\"])${escaped}\\1\\s*(?:,|\\])`,
    "i",
  );
  if (callableArray.test(source)) {
    return { complete: false, reason: "dynamicCallable" };
  }

  const masked = maskPhp(source);
  const token = new RegExp(`\\b${escaped}\\b`, "gi");
  for (const match of masked.matchAll(token)) {
    const offset = match.index;
    if (offset === undefined) continue;
    const shape = inspectPhpChangeSignatureReferenceShape(source, offset);
    if (shape === "unsupported") continue;
    if (coveredOffsets.some((covered) => covered === offset)) continue;
    return { complete: false, reason: "uncoveredStaticReference" };
  }
  return { complete: true };
}

export function isPhpChangeSignatureTarget(
  source: string,
  offset: number,
): boolean {
  const list = callableParameterListAt(source, offset);
  return Boolean(
    list &&
    (isFunctionDeclaration(source, list.start) ||
      isDirectCall(source, list.start)),
  );
}

function editableParameter(
  raw: string,
): PhpChangeSignatureEditableParameter | null {
  const parsed = parseParameter(raw);
  if (!parsed) return null;
  const declaration = raw.trim();
  const masked = maskPhp(declaration);
  const variable = /\$([A-Za-z_][A-Za-z0-9_]*)\b/.exec(masked);
  if (!variable || variable.index < 0) return null;

  let prefix = declaration.slice(0, variable.index).trim();
  const marker = parsed.variadic
    ? parsed.byReference
      ? /&\s*\.\.\.\s*$/
      : /\.\.\.\s*$/
    : parsed.byReference
      ? /&\s*$/
      : null;
  if (marker) prefix = prefix.replace(marker, "").trim();
  if (prefix.startsWith("#[")) return null;

  const modifierMatch = /^(?:(?:public|protected|private|readonly)\s+)*/i.exec(
    prefix,
  );
  const modifiers = modifierMatch?.[0].trim() ?? "";
  const type = prefix.slice(modifierMatch?.[0].length ?? 0).trim();
  const suffix = declaration.slice(variable.index + variable[0].length).trim();

  return {
    byReference: parsed.byReference,
    defaultValue: suffix.startsWith("=") ? suffix.slice(1).trim() : "",
    modifiers,
    name: parsed.name,
    sourceName: parsed.name,
    type,
    variadic: parsed.variadic,
  };
}

function rewriteArguments(
  rawArguments: string[],
  oldParameters: ParsedParameter[],
  requested: Array<PhpChangeSignatureParameter & { parsed: ParsedParameter }>,
): RejectedChangeSignature | { kind: "rewritten"; text: string } {
  const parsedArguments = rawArguments
    .filter((argument) => argument.trim().length > 0)
    .map(parseArgument);
  if (parsedArguments.some((argument) => argument === null)) {
    return { kind: "rejected", reason: "ambiguousReference" };
  }

  const argumentsByParameter = new Map<string, ParsedArgument[]>();
  let positionalIndex = 0;
  let sawNamedArgument = false;
  for (const argument of parsedArguments as ParsedArgument[]) {
    if (argument.name) {
      sawNamedArgument = true;
      if (
        !oldParameters.some((parameter) => parameter.name === argument.name)
      ) {
        return { kind: "rejected", reason: "ambiguousReference" };
      }
      if (argumentsByParameter.has(argument.name)) {
        return { kind: "rejected", reason: "ambiguousReference" };
      }
      argumentsByParameter.set(argument.name, [argument]);
      continue;
    }

    if (sawNamedArgument) {
      return { kind: "rejected", reason: "ambiguousReference" };
    }

    const parameter = oldParameters[positionalIndex];
    if (!parameter || argument.expression.trim().startsWith("...")) {
      return { kind: "rejected", reason: "ambiguousReference" };
    }
    const existing = argumentsByParameter.get(parameter.name) ?? [];
    argumentsByParameter.set(parameter.name, [...existing, argument]);
    if (!parameter.variadic) positionalIndex += 1;
  }

  const values = requested.map((parameter) => {
    const sourceName =
      parameter.sourceName === null
        ? null
        : normalizeName(parameter.sourceName);
    const existing = sourceName ? argumentsByParameter.get(sourceName) : null;
    if (existing) {
      if (!parameter.parsed.variadic && existing.length > 1) {
        return { expressions: [], invalid: true, present: false };
      }
      return {
        expressions: existing.map((argument) => argument.expression),
        invalid:
          parameter.parsed.byReference &&
          existing.some(
            (argument) => !isReferenceableExpression(argument.expression),
          ),
        present: true,
      };
    }
    if (parameter.sourceName === null && parameter.callArgument) {
      const expression = parameter.callArgument.trim();
      return {
        expressions: [expression],
        invalid:
          !isSafeCallArgument(expression) ||
          (parameter.parsed.byReference &&
            !isReferenceableExpression(expression)),
        present: true,
      };
    }
    return { expressions: [], invalid: false, present: false };
  });

  if (values.some((value) => value.invalid)) {
    return { kind: "rejected", reason: "ambiguousReference" };
  }

  const lastPresentIndex = values.reduce(
    (last, value, index) => (value.present ? index : last),
    -1,
  );
  const requiresNamedRewrite =
    sawNamedArgument ||
    values.slice(0, lastPresentIndex).some((value) => !value.present);
  const rewritten: string[] = [];
  for (const parameter of requested) {
    const index = requested.indexOf(parameter);
    const value = values[index];
    if (value.present) {
      if (requiresNamedRewrite && value.expressions.length > 1) {
        return { kind: "rejected", reason: "ambiguousReference" };
      }
      rewritten.push(
        ...value.expressions.map((expression) =>
          requiresNamedRewrite
            ? `${parameter.parsed.name}: ${expression}`
            : expression,
        ),
      );
      continue;
    }

    if (!parameter.parsed.optional) {
      return { kind: "rejected", reason: "missingArgument" };
    }
  }

  return { kind: "rewritten", text: rewritten.join(", ") };
}

function parseParameter(raw: string): ParsedParameter | null {
  const declaration = raw.trim();
  if (!declaration) {
    return null;
  }

  const masked = maskPhp(declaration);
  const variableMatches = [...masked.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)\b/g)];
  if (variableMatches.length !== 1) {
    return null;
  }
  const variable = variableMatches[0];
  const variableOffset = variable.index ?? -1;
  if (variableOffset < 0) return null;

  const prefix = declaration.slice(0, variableOffset).trimEnd();
  const suffix = declaration.slice(variableOffset + variable[0].length).trim();
  const variadic = /\.\.\.\s*$/.test(prefix);
  const byReference = variadic
    ? /&\s*\.\.\.\s*$/.test(prefix)
    : /&\s*$/.test(prefix);
  if (!isSafeParameterPrefix(prefix, { byReference, variadic })) return null;
  if (suffix && !suffix.startsWith("=")) return null;
  if (suffix.startsWith("=") && !isSafeParameterDefault(suffix.slice(1))) {
    return null;
  }

  return {
    byReference,
    declaration,
    name: variable[1],
    optional: variadic || hasTopLevelEquals(declaration),
    variadic,
  };
}

function parseArgument(raw: string): ParsedArgument | null {
  const text = raw.trim();
  if (!text) {
    return null;
  }

  const colon = topLevelColon(text);
  if (colon < 0) {
    return { expression: text, name: null };
  }

  const name = text.slice(0, colon).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return null;
  }

  const expression = text.slice(colon + 1).trim();
  if (!expression) return null;
  return { expression, name };
}

function callableParameterListAt(
  source: string,
  offset: number,
): ParenthesizedList | null {
  if (!Number.isInteger(offset) || offset < 0 || offset > source.length) {
    return null;
  }

  const masked = maskPhp(source);
  const open = callableOpenParenAt(masked, offset);
  if (open === null) return null;

  const close = matchingParen(masked, open);
  if (close === null) {
    return null;
  }

  return {
    end: close,
    items: splitTopLevel(source, masked, open + 1, close),
    start: open,
  };
}

function callableOpenParenAt(masked: string, offset: number): number | null {
  const isCallableToken = (character: string | undefined) =>
    Boolean(character && /[A-Za-z0-9_\\]/.test(character));
  let tokenStart = offset;
  while (tokenStart > 0 && isCallableToken(masked[tokenStart - 1])) {
    tokenStart -= 1;
  }
  let tokenEnd = offset;
  while (tokenEnd < masked.length && isCallableToken(masked[tokenEnd])) {
    tokenEnd += 1;
  }
  if (tokenEnd === tokenStart) return null;
  let open = tokenEnd;
  while (/\s/.test(masked[open] ?? "")) open += 1;
  return masked[open] === "(" ? open : null;
}

function splitTopLevel(
  source: string,
  masked: string,
  start: number,
  end: number,
) {
  const items: Array<{ end: number; start: number; text: string }> = [];
  let itemStart = start;
  let depth = 0;
  for (let index = start; index < end; index += 1) {
    const character = masked[index];
    if ("([{".includes(character)) depth += 1;
    if (")]}".includes(character)) depth = Math.max(0, depth - 1);
    if (character === "," && depth === 0) {
      items.push({
        end: index,
        start: itemStart,
        text: source.slice(itemStart, index),
      });
      itemStart = index + 1;
    }
  }
  if (itemStart < end || source.slice(start, end).trim()) {
    items.push({ end, start: itemStart, text: source.slice(itemStart, end) });
  }
  return items;
}

function isFunctionDeclaration(source: string, openParen: number): boolean {
  const prefix = maskPhp(source.slice(Math.max(0, openParen - 180), openParen));
  return /\bfunction\s*&?\s*[A-Za-z_][A-Za-z0-9_]*\s*$/.test(prefix);
}

function functionDeclarationPrefix(
  source: string,
  openParen: number,
): { modifiers: string; name: string } | null {
  const prefix = maskPhp(source.slice(Math.max(0, openParen - 260), openParen));
  const match =
    /((?:(?:public|protected|private|static|final|abstract|readonly)\s+)*)function\s*&?\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/i.exec(
      prefix,
    );
  if (!match) return null;
  return { modifiers: match[1], name: match[2] };
}

function enclosingClassLike(
  source: string,
  offset: number,
): { final: boolean; kind: "class" | "enum" | "interface" | "trait" } | null {
  const masked = maskPhp(source.slice(0, offset));
  const scopes: Array<
    { final: boolean; kind: "class" | "enum" | "interface" | "trait" } | null
  > = [];
  for (let index = 0; index < masked.length; index += 1) {
    if (masked[index] === "}") {
      scopes.pop();
      continue;
    }
    if (masked[index] !== "{") continue;
    const boundary = Math.max(
      masked.lastIndexOf(";", index - 1),
      masked.lastIndexOf("{", index - 1),
      masked.lastIndexOf("}", index - 1),
    );
    const header = masked.slice(boundary + 1, index);
    const match =
      /\b(final\s+)?(class|enum|interface|trait)\s+[A-Za-z_][A-Za-z0-9_]*(?:\s+[^{};]*)?$/i.exec(
        header,
      );
    if (match) {
      scopes.push({
        final: Boolean(match[1]),
        kind: match[2].toLowerCase() as
          | "class"
          | "enum"
          | "interface"
          | "trait",
      });
      continue;
    }
    scopes.push(scopes[scopes.length - 1] ?? null);
  }
  return scopes[scopes.length - 1] ?? null;
}

function isDirectCall(source: string, openParen: number): boolean {
  const prefix = maskPhp(source.slice(Math.max(0, openParen - 180), openParen));
  const match =
    /(?:\bnew\s+[A-Za-z_\\][A-Za-z0-9_\\]*|[A-Za-z_\\][A-Za-z0-9_\\]*(?:\s*::\s*[A-Za-z_][A-Za-z0-9_]*)?|\$(?:this|[A-Za-z_][A-Za-z0-9_]*)\s*(?:->|\?->)\s*[A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(
      prefix,
    );
  if (!match) return false;
  const preceding = match.index > 0 ? prefix[match.index - 1] : "";
  return !/[A-Za-z0-9_$\\]/.test(preceding);
}

function sameParameterIdentity(
  expected: readonly ParsedParameter[],
  actual: readonly ParsedParameter[],
): boolean {
  return (
    expected.length === actual.length &&
    expected.every(
      (parameter, index) =>
        parameter.name === actual[index].name &&
        parameter.variadic === actual[index].variadic &&
        parameter.byReference === actual[index].byReference,
    )
  );
}

function isSupportedRequestedSignature(
  parameters: readonly ParsedParameter[],
): boolean {
  let sawOptional = false;
  let sawVariadic = false;
  for (const [index, parameter] of parameters.entries()) {
    if (sawVariadic) return false;
    if (parameter.variadic) {
      if (index !== parameters.length - 1) return false;
      sawVariadic = true;
      continue;
    }
    if (parameter.optional) sawOptional = true;
    if (sawOptional && !parameter.optional) return false;
  }
  return true;
}

function editFor(
  document: PhpChangeSignatureDocument,
  list: ParenthesizedList,
  text: string,
): PhpChangeSignatureEdit {
  return {
    end: list.end,
    path: document.path,
    start: list.start + 1,
    text,
    version: document.version,
  };
}

function deduplicateReferences(
  references: readonly PhpChangeSignatureReference[],
) {
  return Array.from(
    new Map(
      references.map((reference) => [
        `${reference.path}:${reference.offset}`,
        reference,
      ]),
    ).values(),
  );
}

function hasConflictingReferenceRoles(
  references: readonly PhpChangeSignatureReference[],
): boolean {
  const roles = new Map<string, "call" | "declaration">();
  for (const reference of references) {
    if (!reference.role) continue;
    const key = `${reference.path}:${reference.offset}`;
    const existing = roles.get(key);
    if (existing && existing !== reference.role) return true;
    roles.set(key, reference.role);
  }
  return false;
}

function firstOverlappingEdit(
  edits: readonly PhpChangeSignatureEdit[],
): boolean {
  const byPath = new Map<string, PhpChangeSignatureEdit[]>();
  for (const edit of edits)
    byPath.set(edit.path, [...(byPath.get(edit.path) ?? []), edit]);
  for (const pathEdits of byPath.values()) {
    pathEdits.sort(
      (left, right) => left.start - right.start || left.end - right.end,
    );
    for (let index = 1; index < pathEdits.length; index += 1) {
      if (pathEdits[index].start < pathEdits[index - 1].end) return true;
    }
  }
  return false;
}

function normalizeName(name: string): string {
  return name.trim().replace(/^\$/, "");
}

function matchingParen(masked: string, open: number): number | null {
  let depth = 0;
  for (let index = open; index < masked.length; index += 1) {
    if (masked[index] === "(") depth += 1;
    if (masked[index] !== ")") continue;
    depth -= 1;
    if (depth === 0) return index;
  }
  return null;
}

function hasTopLevelEquals(text: string): boolean {
  return scanTopLevel(text, "=") >= 0;
}

function isSafeParameterDefault(expression: string): boolean {
  return isSafeExpression(expression, { allowVariables: false });
}

function isSafeCallArgument(expression: string): boolean {
  return isSafeExpression(expression, { allowVariables: true });
}

function isSafeExpression(
  expression: string,
  options: { allowVariables: boolean },
): boolean {
  const trimmed = expression.trim();
  if (!trimmed) return false;
  if (!hasClosedLexicalRegions(trimmed)) return false;
  const masked = maskPhp(trimmed);
  const delimiters: string[] = [];
  for (let index = 0; index < masked.length; index += 1) {
    const character = masked[index];
    if ("([{".includes(character)) delimiters.push(character);
    if (")]}".includes(character)) {
      const expected = { ")": "(", "]": "[", "}": "{" }[character];
      if (delimiters.pop() !== expected) return false;
    }
    if (delimiters.length === 0 && (character === "," || character === ";")) {
      return false;
    }
  }
  if (delimiters.length !== 0) return false;
  if (!options.allowVariables && /\$[A-Za-z_][A-Za-z0-9_]*/.test(masked)) {
    return false;
  }
  return true;
}

function isSafeParameterPrefix(
  prefix: string,
  flags: { byReference: boolean; variadic: boolean },
): boolean {
  const withoutAttributes = stripLeadingAttributes(prefix);
  if (withoutAttributes === null) return false;
  let type = withoutAttributes
    .replace(/^(?:(?:public|protected|private|readonly)\s+)*/i, "")
    .trim();
  if (flags.variadic) type = type.replace(/&?\s*\.\.\.\s*$/, "").trim();
  if (!flags.variadic && flags.byReference) {
    type = type.replace(/&\s*$/, "").trim();
  }
  if (!type) return true;
  if (!/^[A-Za-z0-9_\\?&|()\s]+$/.test(type)) return false;
  if (/[A-Za-z0-9_\\?]\s+[A-Za-z0-9_\\?]/.test(type)) return false;
  const compact = type.replace(/\s+/g, "");
  if (/\?\?|[|&]{2}|\(\)|^[|&]|[|&]$|\([|&]|[|&]\)/.test(compact)) {
    return false;
  }
  if (compact.startsWith("?") && /[|&]/.test(compact)) return false;
  return hasBalancedTypeParentheses(type);
}

function hasClosedLexicalRegions(source: string): boolean {
  let blockComment = false;
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (blockComment) {
      if (character === "*" && source[index + 1] === "/") {
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
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && source[index + 1] === "/") {
      const newline = source.indexOf("\n", index + 2);
      if (newline < 0) return true;
      index = newline;
      continue;
    }
    if (character === "#" && source[index + 1] !== "[") {
      const newline = source.indexOf("\n", index + 1);
      if (newline < 0) return true;
      index = newline;
    }
  }
  return !blockComment && quote === null;
}

function stripLeadingAttributes(prefix: string): string | null {
  let remaining = prefix.trimStart();
  while (remaining.startsWith("#[")) {
    const masked = maskPhp(remaining);
    let depth = 0;
    let end = -1;
    for (let index = 1; index < masked.length; index += 1) {
      if (masked[index] === "[") depth += 1;
      if (masked[index] !== "]") continue;
      depth -= 1;
      if (depth !== 0) continue;
      end = index;
      break;
    }
    if (end < 0) return null;
    remaining = remaining.slice(end + 1).trimStart();
  }
  return remaining;
}

function hasBalancedTypeParentheses(type: string): boolean {
  let depth = 0;
  for (const character of type) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function isReferenceableExpression(expression: string): boolean {
  const compact = expression.trim().replace(/\s+/g, "");
  if (
    /^\$[A-Za-z_][A-Za-z0-9_]*(?:(?:->[A-Za-z_][A-Za-z0-9_]*)|(?:\[[^\]]+\]))*$/.test(
      compact,
    )
  ) {
    return true;
  }
  return /^[A-Za-z_\\][A-Za-z0-9_\\]*::\$[A-Za-z_][A-Za-z0-9_]*$/.test(compact);
}

function topLevelColon(text: string): number {
  return scanTopLevel(text, ":");
}

function scanTopLevel(text: string, token: string): number {
  const masked = maskPhp(text);
  let depth = 0;
  for (let index = 0; index < masked.length; index += 1) {
    const character = masked[index];
    if ("([{".includes(character)) depth += 1;
    if (")]}".includes(character)) depth = Math.max(0, depth - 1);
    if (character === token && depth === 0) return index;
  }
  return -1;
}

function maskPhp(source: string): string {
  const chars = [...source];
  let quote: string | null = null;
  for (let index = 0; index < chars.length; index += 1) {
    const character = chars[index];
    if (quote) {
      if (character === "\\") {
        chars[index] = " ";
        if (index + 1 < chars.length) chars[++index] = " ";
        continue;
      }
      if (character === quote) quote = null;
      if (character !== "\n" && character !== "\r") chars[index] = " ";
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      chars[index] = " ";
      continue;
    }
    if (
      (character === "/" && chars[index + 1] === "/") ||
      (character === "#" && chars[index + 1] !== "[")
    ) {
      while (index < chars.length && chars[index] !== "\n")
        chars[index++] = " ";
      index -= 1;
      continue;
    }
    if (character === "/" && chars[index + 1] === "*") {
      chars[index++] = " ";
      chars[index] = " ";
      while (
        index + 1 < chars.length &&
        !(chars[index] === "*" && chars[index + 1] === "/")
      ) {
        if (chars[index] !== "\n" && chars[index] !== "\r") chars[index] = " ";
        index += 1;
      }
      if (index < chars.length) chars[index] = " ";
      if (index + 1 < chars.length) chars[++index] = " ";
    }
  }
  return chars.join("");
}
