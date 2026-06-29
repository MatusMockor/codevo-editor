import type { EditorPosition } from "./languageServerFeatures";
import {
  firstPhpDocTypeToken,
  phpDocClassStringReturnTemplate,
  phpDocReturnTypeToken,
} from "./phpDocTemplates";
import {
  PHP_EXPRESSION_RECEIVER_PATTERN,
  PHP_MEMBER_ACCESS_PATTERN,
  PHP_MEMBER_CHAIN_SEGMENT_PATTERN,
  phpNormalizeReceiverExpression,
  phpSimpleVariableName,
  phpStatementPrefixBeforeOffset,
} from "./phpReceiverExpressions";
import {
  defaultPhpFrameworkProviders,
  phpFrameworkMemberCompletionsFromSource,
  type PhpFrameworkProvider,
} from "./phpFrameworkProviders";

export interface PhpMemberAccessCompletionContext {
  prefix: string;
  receiverExpression: string;
  variableName: string | null;
}

export type PhpMemberVisibility = "public" | "protected" | "private";

export interface PhpMethodCompletion {
  classStringTemplate?: string;
  declaringClassName: string;
  insertText?: string;
  isStatic?: boolean;
  kind?:
    | "config"
    | "env"
    | "property"
    | "relation"
    | "route"
    | "scope"
    | "translation"
    | "view";
  name: string;
  parameters: string;
  returnType: string | null;
  visibility?: PhpMemberVisibility;
}

export interface PhpMethodParameter {
  defaultValue: string | null;
  name: string;
  optional: boolean;
  raw: string;
  type: string | null;
}

export interface PhpMethodSignatureContext {
  argumentName?: string;
  argumentIndex: number;
  className: string | null;
  methodName: string;
  receiverExpression: string | null;
  variableName: string | null;
}

export interface PhpStaticAccessCompletionContext {
  className: string;
  prefix: string;
}

export interface PhpMethodSignature {
  argumentIndex: number;
  method: PhpMethodCompletion;
  parameters: PhpMethodParameter[];
}

interface PhpMethodSignatureCallContext {
  argumentsSource: string;
  className: string | null;
  methodName: string;
  openParenOffset: number;
  receiverExpression: string | null;
  variableName: string | null;
}

export interface PhpMethodCompletionOptions {
  frameworkProviders?: readonly PhpFrameworkProvider[];
}

export function phpMemberAccessCompletionContextAt(
  source: string,
  position: EditorPosition,
): PhpMemberAccessCompletionContext | null {
  const offset = offsetAtPosition(source, position);
  const statementUntilCursor = phpStatementPrefixBeforeOffset(source, offset);
  const match = new RegExp(
    `(${PHP_EXPRESSION_RECEIVER_PATTERN}(?:${PHP_MEMBER_CHAIN_SEGMENT_PATTERN})*)${PHP_MEMBER_ACCESS_PATTERN}([A-Za-z_][A-Za-z0-9_]*)?$`,
  ).exec(statementUntilCursor);

  if (!match?.[1]) {
    return null;
  }

  const receiverExpression = phpNormalizeReceiverExpression(match[1]);

  return {
    prefix: match[2] ?? "",
    receiverExpression,
    variableName: phpSimpleVariableName(receiverExpression),
  };
}

export function phpStaticAccessCompletionContextAt(
  source: string,
  position: EditorPosition,
): PhpStaticAccessCompletionContext | null {
  const offset = offsetAtPosition(source, position);
  const statementUntilCursor = phpStatementPrefixBeforeOffset(source, offset);
  const match =
    /((?:\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*|self|static|parent)\s*::\s*([A-Za-z_][A-Za-z0-9_]*)?$/.exec(
      statementUntilCursor,
    );

  if (!match?.[1]) {
    return null;
  }

  return {
    className: match[1].replace(/^\\+/, ""),
    prefix: match[2] ?? "",
  };
}

export function phpMethodSignatureContextAt(
  source: string,
  position: EditorPosition,
): PhpMethodSignatureContext | null {
  const offset = offsetAtPosition(source, position);
  const statementUntilCursor = phpStatementPrefixBeforeOffset(source, offset);
  const context = phpActiveMethodSignatureCallContext(statementUntilCursor);

  if (!context) {
    return null;
  }

  return {
    ...phpArgumentName(context.argumentsSource),
    argumentIndex: phpArgumentIndex(context.argumentsSource),
    className: context.className,
    methodName: context.methodName,
    receiverExpression: context.receiverExpression,
    variableName: context.variableName,
  };
}

export function phpMethodCompletionsFromSource(
  source: string,
  declaringClassName: string,
  options: PhpMethodCompletionOptions = {},
): PhpMethodCompletion[] {
  const members: PhpMethodCompletion[] = [];
  const masked = maskPhpStringsAndComments(source);
  const pattern =
    /(?:^|\n)\s*((?:(?:abstract|final|private|protected|public|static)\s+)*)function\s+&?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?::\s*([^{;\n]+))?/g;

  for (const match of masked.matchAll(pattern)) {
    const modifiers = (match[1] ?? "").toLowerCase();
    const name = match[2];

    if (!name) {
      continue;
    }

    const functionOffset = (match.index ?? 0) + match[0].lastIndexOf("function");
    const attributes = phpAttributeNamesBefore(source, functionOffset);
    const isScopeAttribute = phpHasAttributeName(attributes, "Scope");

    if (
      /\bprivate\b/.test(modifiers) ||
      /\bstatic\b/.test(modifiers) && isScopeAttribute ||
      (/\bprotected\b/.test(modifiers) && !isScopeAttribute)
    ) {
      continue;
    }

    const docBlock = phpDocBlockBefore(source, functionOffset);
    const parameters = phpFunctionParametersAt(source, functionOffset) ?? match[3] ?? "";
    const declaredReturnType = normalizeReturnType(match[4] ?? null);
    const documentedReturnType = phpDocReturnTypeFromBlock(docBlock);
    const classStringTemplate = phpDocClassStringReturnTemplate(docBlock);
    const visibility = phpMemberVisibilityFromModifiers(modifiers);

    members.push({
      ...(classStringTemplate ? { classStringTemplate } : {}),
      declaringClassName,
      ...(isScopeAttribute ? { kind: "scope" as const } : {}),
      name,
      parameters: enrichParametersFromPhpDoc(
        normalizeWhitespace(parameters),
        docBlock,
      ),
      returnType: bestPhpReturnType(declaredReturnType, documentedReturnType),
      ...(modifiers.includes("static") ? { isStatic: true } : {}),
      ...(visibility ? { visibility } : {}),
    });
  }

  members.push(...phpDocMethodCompletionsFromSource(source, declaringClassName));
  members.push(
    ...phpPropertyCompletionsFromSource(source, declaringClassName, options),
  );

  return dedupePhpMembers(members);
}

function phpDocMethodCompletionsFromSource(
  source: string,
  declaringClassName: string,
): PhpMethodCompletion[] {
  const members: PhpMethodCompletion[] = [];

  for (const match of source.matchAll(
    /@(?:(?:phpstan|psalm)-)?method\s+([^\r\n*]*?)([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/g,
  )) {
    const name = match[2];

    if (!name) {
      continue;
    }

    const prefix = normalizeWhitespace(match[1] ?? "");
    const prefixParts = prefix ? prefix.split(" ") : [];
    const visibility = phpMemberVisibilityFromToken(prefixParts[0]);
    const partsWithoutVisibility = visibility ? prefixParts.slice(1) : prefixParts;
    const isStatic = partsWithoutVisibility[0]?.toLowerCase() === "static";
    const returnType = normalizeReturnType(
      (isStatic ? partsWithoutVisibility.slice(1) : partsWithoutVisibility).join(
        " ",
      ),
    );

    members.push({
      declaringClassName,
      ...(isStatic ? { isStatic: true } : {}),
      name,
      parameters: normalizeWhitespace(match[3] ?? ""),
      returnType,
      ...(visibility ? { visibility } : {}),
    });
  }

  return members;
}

function phpPropertyCompletionsFromSource(
  source: string,
  declaringClassName: string,
  options: PhpMethodCompletionOptions,
): PhpMethodCompletion[] {
  const members: PhpMethodCompletion[] = [];

  for (const match of source.matchAll(
    /@(?:(?:phpstan|psalm)-)?property(?:-read|-write)?\s+([^\r\n*]+?)\s+\$([A-Za-z_][A-Za-z0-9_]*)\b/g,
  )) {
    const returnType = normalizeReturnType(firstPhpDocTypeToken(match[1] ?? null));
    const name = match[2];

    if (!name) {
      continue;
    }

    members.push({
      declaringClassName,
      kind: "property",
      name,
      parameters: "",
      returnType,
    });
  }

  const masked = maskPhpStringsAndComments(source);
  const propertyPattern =
    /(?:^|\n)\s*((?:(?:public|protected|private|readonly|static)\s+)*)((?:\??[\\A-Za-z_][\\A-Za-z0-9_]*(?:\|[\\A-Za-z_][\\A-Za-z0-9_]*)?\s+)?)\$([A-Za-z_][A-Za-z0-9_]*)\b/g;

  for (const match of masked.matchAll(propertyPattern)) {
    const modifiers = (match[1] ?? "").toLowerCase();

    if (!modifiers.includes("public")) {
      continue;
    }

    if (/\bprivate\b|\bprotected\b/.test(modifiers)) {
      continue;
    }

    const name = match[3];

    if (!name) {
      continue;
    }

    members.push({
      declaringClassName,
      ...(modifiers.includes("static") ? { isStatic: true } : {}),
      kind: "property",
      name,
      parameters: "",
      returnType: normalizeReturnType(match[2] ?? null),
      visibility: "public",
    });
  }

  members.push(
    ...phpFrameworkMemberCompletionsFromSource(
      source,
      declaringClassName,
      options.frameworkProviders ?? defaultPhpFrameworkProviders,
    ),
  );

  return members;
}

function phpFunctionParametersAt(
  source: string,
  functionOffset: number,
): string | null {
  const openOffset = source.indexOf("(", functionOffset);

  if (openOffset < 0) {
    return null;
  }

  const closeOffset = matchingPairOffset(source, openOffset, "(", ")");

  if (closeOffset === null) {
    return null;
  }

  return source.slice(openOffset + 1, closeOffset);
}

function dedupePhpMembers(members: PhpMethodCompletion[]): PhpMethodCompletion[] {
  const seen = new Set<string>();
  const unique: PhpMethodCompletion[] = [];

  for (const member of members) {
    const key = `${member.kind ?? "method"}:${member.name.toLowerCase()}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(member);
  }

  return unique;
}

function phpMemberVisibilityFromModifiers(
  modifiers: string,
): PhpMemberVisibility | null {
  if (/\bpublic\b/.test(modifiers)) {
    return "public";
  }

  if (/\bprotected\b/.test(modifiers)) {
    return "protected";
  }

  if (/\bprivate\b/.test(modifiers)) {
    return "private";
  }

  return null;
}

function phpMemberVisibilityFromToken(
  token: string | undefined,
): PhpMemberVisibility | null {
  const normalized = token?.toLowerCase();

  if (
    normalized === "public" ||
    normalized === "protected" ||
    normalized === "private"
  ) {
    return normalized;
  }

  return null;
}

export function phpMethodParameters(parameters: string): PhpMethodParameter[] {
  return splitPhpParameterList(parameters).map((parameter) => {
    const defaultIndex = topLevelEqualsIndex(parameter);
    const withoutDefault =
      defaultIndex >= 0 ? parameter.slice(0, defaultIndex).trim() : parameter;
    const defaultValue =
      defaultIndex >= 0 ? parameter.slice(defaultIndex + 1).trim() : null;
    const nameMatch = /(?:\.\.\.)?(?:&\s*)?(\$[A-Za-z_][A-Za-z0-9_]*)\b/.exec(
      withoutDefault,
    );
    const name = nameMatch?.[1] ?? withoutDefault;
    const beforeName = nameMatch
      ? withoutDefault.slice(0, nameMatch.index).trim()
      : "";

    return {
      defaultValue,
      name,
      optional: defaultValue !== null,
      raw: parameter,
      type: normalizeParameterType(beforeName),
    };
  });
}

export function phpTraitClassNames(source: string): string[] {
  const typeMatch = /\b(?:class|trait|enum)\s+[A-Za-z_][A-Za-z0-9_]*/.exec(
    source,
  );

  if (!typeMatch) {
    return [];
  }

  const bodyStart = source.indexOf("{", typeMatch.index + typeMatch[0].length);

  if (bodyStart < 0) {
    return [];
  }

  const bodyEnd = matchingPairOffset(source, bodyStart, "{", "}") ?? source.length;
  const body = source.slice(bodyStart + 1, bodyEnd);
  const traits: string[] = [];

  for (const match of body.matchAll(/^\s*use\s+([^;{]+)\s*(?:;|\{)/gm)) {
    for (const trait of (match[1] ?? "").split(",")) {
      const normalized = trait.trim().replace(/^\\+/, "");

      if (!normalized || /\s/.test(normalized)) {
        continue;
      }

      traits.push(normalized);
    }
  }

  return Array.from(new Set(traits));
}

export function phpMixinClassNames(source: string): string[] {
  const mixins: string[] = [];

  for (const match of source.matchAll(
    /@(?:(?:phpstan|psalm)-)?mixin\s+([^\r\n*]+)/g,
  )) {
    const typeName = firstPhpDocTypeToken(match[1] ?? "")
      ?.split("<")[0]
      ?.trim()
      .replace(/^\\+/, "");

    if (!typeName || !/^[A-Za-z_][A-Za-z0-9_\\]*$/.test(typeName)) {
      continue;
    }

    mixins.push(typeName);
  }

  return Array.from(new Set(mixins));
}

function phpAttributeNamesBefore(
  source: string,
  functionOffset: number,
): string[] {
  const beforeFunction = source
    .slice(0, functionOffset)
    .replace(/\s*(?:(?:abstract|final|private|protected|public|static)\s+)*$/, "");
  const attributesSource = phpStackedAttributeBlockBefore(beforeFunction);
  const attributeNames: string[] = [];

  for (const attributeMatch of attributesSource.matchAll(
    /(?:^|[\s,#[])(\\?[A-Za-z_][A-Za-z0-9_]*(?:\\[A-Za-z_][A-Za-z0-9_]*)*)\b/g,
  )) {
    const attributeName = attributeMatch[1]?.replace(/^\\+/, "");

    if (attributeName) {
      attributeNames.push(attributeName);
    }
  }

  return attributeNames;
}

// Returns the run of stacked `#[...]` attribute blocks that immediately precede
// `text` (i.e. sit at its end), as a substring of `text`. The previous
// `((?:\s*#\[[\s\S]*?\]\s*)+)$` regex combined a quantified group with a lazy
// `[\s\S]*?` span and an end anchor, which backtracks exponentially when the
// trailing text is not a closed attribute block (the per-keystroke case while a
// method's attributes are still being typed). This walks backward instead,
// matching each `]` to its `#[` via a balanced-bracket scan over a
// string/comment-masked copy, so a literal `]` inside an attribute string
// argument never confuses the boundary and the whole pass is linear.
function phpStackedAttributeBlockBefore(text: string): string {
  // Mask strings and `//`/`/* */` comments (but NOT `#`, which begins a PHP
  // attribute `#[...]`) so bracket matching ignores `]`/`[` that live inside
  // quoted arguments or comments. Offsets are preserved, so boundaries found in
  // the mask map straight back onto the original text we return.
  const masked = maskPhpStringsForAttributeScan(text);
  let blockStart = text.length;

  for (;;) {
    let cursor = blockStart - 1;

    while (cursor >= 0 && /\s/.test(masked[cursor] ?? "")) {
      cursor -= 1;
    }

    if (cursor < 0 || masked[cursor] !== "]") {
      break;
    }

    const openOffset = phpAttributeOpenOffsetBefore(masked, cursor);

    if (openOffset === null) {
      break;
    }

    blockStart = openOffset;
  }

  return text.slice(blockStart);
}

// Given the offset of a `]` that closes an attribute block in a string-masked
// copy, scan backward to its matching `[`. Returns the offset of the `#` of
// `#[`, or null when the matched `[` is not preceded by `#` (i.e. not a PHP
// attribute open). Linear in the size of the block.
function phpAttributeOpenOffsetBefore(
  masked: string,
  closeOffset: number,
): number | null {
  let depth = 0;

  for (let index = closeOffset; index >= 0; index -= 1) {
    const character = masked[index] || "";

    if (character === "]") {
      depth += 1;
      continue;
    }

    if (character !== "[") {
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return masked[index - 1] === "#" ? index - 1 : null;
    }
  }

  return null;
}

// Forward, offset-preserving mask of PHP string literals and `//` / `/* */`
// comments. Unlike `maskPhpStringsAndComments`, it deliberately leaves `#`
// untouched so `#[` attribute syntax survives for bracket matching.
function maskPhpStringsForAttributeScan(source: string): string {
  let output = "";
  let quote: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] || "";
    const next = source[index + 1] || "";

    if (inLineComment) {
      output += character === "\n" ? "\n" : " ";

      if (character === "\n") {
        inLineComment = false;
      }

      continue;
    }

    if (inBlockComment) {
      output += character === "\n" ? "\n" : " ";

      if (character === "*" && next === "/") {
        output += " ";
        index += 1;
        inBlockComment = false;
      }

      continue;
    }

    if (quote) {
      output += character === "\n" ? "\n" : " ";

      if (character === "\\" && quote !== "`") {
        output += next === "\n" ? "\n" : " ";
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "/" && next === "/") {
      output += "  ";
      index += 1;
      inLineComment = true;
      continue;
    }

    if (character === "/" && next === "*") {
      output += "  ";
      index += 1;
      inBlockComment = true;
      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
      output += " ";
      quote = character;
      continue;
    }

    output += character;
  }

  return output;
}

function phpHasAttributeName(
  attributeNames: readonly string[],
  expectedName: string,
): boolean {
  const normalizedExpectedName = expectedName.toLowerCase();

  return attributeNames.some((attributeName) => {
    const shortName = attributeName.split("\\").pop()?.toLowerCase();

    return (
      attributeName.toLowerCase() === normalizedExpectedName ||
      shortName === normalizedExpectedName
    );
  });
}

function phpDocBlockBefore(source: string, functionOffset: number): string | null {
  const beforeFunction = source.slice(0, functionOffset);
  const docStart = beforeFunction.lastIndexOf("/**");
  const docEnd = beforeFunction.lastIndexOf("*/");

  if (docStart < 0 || docEnd < docStart) {
    return null;
  }

  const betweenDocAndFunction = beforeFunction
    .slice(docEnd + 2)
    .replace(/#\[[\s\S]*?\]/g, " ")
    .replace(/\b(?:abstract|final|private|protected|public|static)\b/g, " ")
    .trim();

  if (betweenDocAndFunction) {
    return null;
  }

  return beforeFunction.slice(docStart, docEnd + 2);
}

function phpDocReturnTypeFromBlock(docBlock: string | null): string | null {
  return normalizeReturnType(phpDocReturnTypeToken(docBlock));
}

function enrichParametersFromPhpDoc(
  parameters: string,
  docBlock: string | null,
): string {
  if (!parameters || !docBlock) {
    return parameters;
  }

  const docTypes = phpDocParameterTypes(docBlock);

  if (!docTypes.size) {
    return parameters;
  }

  return splitPhpParameterList(parameters)
    .map((parameter) => enrichParameterFromPhpDoc(parameter, docTypes))
    .join(", ");
}

function enrichParameterFromPhpDoc(
  parameter: string,
  docTypes: Map<string, string>,
): string {
  const parsedParameter = phpMethodParameters(parameter)[0];

  if (!parsedParameter || parsedParameter.type) {
    return parameter;
  }

  const docType = docTypes.get(parsedParameter.name.slice(1).toLowerCase());

  if (!docType) {
    return parameter;
  }

  return `${docType} ${parameter}`;
}

function phpDocParameterTypes(docBlock: string): Map<string, string> {
  const types = new Map<string, string>();

  for (const match of docBlock.matchAll(
    /@(?:(?:phpstan|psalm)-)?param\s+([^\s*]+)\s+(?:&\s*)?(?:\.\.\.)?\$([A-Za-z_][A-Za-z0-9_]*)\b/g,
  )) {
    const type = normalizeReturnType(match[1] ?? "");
    const name = match[2]?.toLowerCase();

    if (!type || !name) {
      continue;
    }

    types.set(name, type);
  }

  return types;
}

function phpArgumentIndex(argumentsSource: string): number {
  let argumentIndex = 0;
  let depth = 0;
  let quote: string | null = null;

  for (let index = 0; index < argumentsSource.length; index += 1) {
    const character = argumentsSource[index] || "";

    if (quote) {
      if (character === "\\" && quote !== "`") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
      quote = character;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (character === "," && depth === 0) {
      argumentIndex += 1;
    }
  }

  return argumentIndex;
}

function phpArgumentName(
  argumentsSource: string,
): Pick<PhpMethodSignatureContext, "argumentName"> {
  const segmentStart = phpCurrentArgumentSegmentStart(argumentsSource);
  const argumentSegment = argumentsSource.slice(segmentStart);
  const colonOffset = phpTopLevelNamedArgumentColonOffset(argumentSegment);

  if (colonOffset < 0) {
    return {};
  }

  const name = argumentSegment.slice(0, colonOffset).trim();

  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? { argumentName: name } : {};
}

function phpCurrentArgumentSegmentStart(argumentsSource: string): number {
  let segmentStart = 0;
  let depth = 0;
  let quote: string | null = null;

  for (let index = 0; index < argumentsSource.length; index += 1) {
    const character = argumentsSource[index] || "";

    if (quote) {
      if (character === "\\" && quote !== "`") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
      quote = character;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (character === "," && depth === 0) {
      segmentStart = index + 1;
    }
  }

  return segmentStart;
}

function phpTopLevelNamedArgumentColonOffset(argumentSegment: string): number {
  let depth = 0;
  let quote: string | null = null;

  for (let index = 0; index < argumentSegment.length; index += 1) {
    const character = argumentSegment[index] || "";

    if (quote) {
      if (character === "\\" && quote !== "`") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
      quote = character;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (character !== ":" || depth !== 0) {
      continue;
    }

    if (argumentSegment[index + 1] === ":") {
      index += 1;
      continue;
    }

    return index;
  }

  return -1;
}

function phpActiveMethodSignatureCallContext(
  statementUntilCursor: string,
): PhpMethodSignatureCallContext | null {
  const memberContext = lastOpenMemberSignatureCallContext(statementUntilCursor);
  const staticContext = lastOpenStaticSignatureCallContext(statementUntilCursor);

  if (!memberContext) {
    return staticContext;
  }

  if (!staticContext) {
    return memberContext;
  }

  return memberContext.openParenOffset > staticContext.openParenOffset
    ? memberContext
    : staticContext;
}

function lastOpenMemberSignatureCallContext(
  statementUntilCursor: string,
): PhpMethodSignatureCallContext | null {
  const pattern = new RegExp(
    `(${PHP_EXPRESSION_RECEIVER_PATTERN}(?:${PHP_MEMBER_CHAIN_SEGMENT_PATTERN})*)${PHP_MEMBER_ACCESS_PATTERN}([A-Za-z_][A-Za-z0-9_]*)\\s*\\(`,
    "g",
  );
  let context: PhpMethodSignatureCallContext | null = null;

  for (const match of statementUntilCursor.matchAll(pattern)) {
    const receiverExpressionSource = match[1];
    const methodName = match[2];

    if (!receiverExpressionSource || !methodName) {
      continue;
    }

    const openParenOffset =
      (match.index ?? 0) + match[0].lastIndexOf("(");

    if (!phpCallIsOpenAtCursor(statementUntilCursor, openParenOffset)) {
      continue;
    }

    const receiverExpression = phpNormalizeReceiverExpression(
      receiverExpressionSource,
    );

    context = {
      argumentsSource: statementUntilCursor.slice(openParenOffset + 1),
      className: null,
      methodName,
      openParenOffset,
      receiverExpression,
      variableName: phpSimpleVariableName(receiverExpression),
    };
  }

  return context;
}

function lastOpenStaticSignatureCallContext(
  statementUntilCursor: string,
): PhpMethodSignatureCallContext | null {
  const pattern =
    /((?:\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*|self|static|parent)\s*::\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let context: PhpMethodSignatureCallContext | null = null;

  for (const match of statementUntilCursor.matchAll(pattern)) {
    const className = match[1]?.replace(/^\\+/, "");
    const methodName = match[2];

    if (!className || !methodName) {
      continue;
    }

    const openParenOffset =
      (match.index ?? 0) + match[0].lastIndexOf("(");

    if (!phpCallIsOpenAtCursor(statementUntilCursor, openParenOffset)) {
      continue;
    }

    context = {
      argumentsSource: statementUntilCursor.slice(openParenOffset + 1),
      className,
      methodName,
      openParenOffset,
      receiverExpression: null,
      variableName: null,
    };
  }

  return context;
}

function phpCallIsOpenAtCursor(
  source: string,
  openParenOffset: number,
): boolean {
  let depth = 0;
  let quote: string | null = null;

  for (let index = openParenOffset; index < source.length; index += 1) {
    const character = source[index] || "";

    if (quote) {
      if (character === "\\" && quote !== "`") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
      quote = character;
      continue;
    }

    if (character === "(") {
      depth += 1;
      continue;
    }

    if (character !== ")") {
      continue;
    }

    depth = Math.max(0, depth - 1);
  }

  return depth > 0;
}

function normalizeParameterType(beforeName: string): string | null {
  const normalized = normalizeWhitespace(
    beforeName.replace(/\b(?:public|protected|private|readonly|static)\b/g, " "),
  );

  return normalized || null;
}

function topLevelEqualsIndex(source: string): number {
  let depth = 0;
  let quote: string | null = null;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] || "";

    if (quote) {
      if (character === "\\" && quote !== "`") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
      quote = character;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (character === "=" && depth === 0) {
      return index;
    }
  }

  return -1;
}

function normalizeReturnType(returnType: string | null): string | null {
  const normalized = normalizeWhitespace(returnType ?? "")
    .replace(/\s*\|\s*/g, "|")
    .replace(/\s*&\s*/g, "&");

  return normalized || null;
}

function bestPhpReturnType(
  declaredReturnType: string | null,
  documentedReturnType: string | null,
): string | null {
  if (
    documentedReturnType &&
    hasPhpGenericTypeArguments(documentedReturnType) &&
    !hasPhpGenericTypeArguments(declaredReturnType)
  ) {
    return documentedReturnType;
  }

  return declaredReturnType ?? documentedReturnType;
}

function hasPhpGenericTypeArguments(typeName: string | null): boolean {
  return Boolean(typeName && /<[^>]+>/.test(typeName));
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function splitPhpParameterList(parameters: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;

  for (let index = 0; index < parameters.length; index += 1) {
    const character = parameters[index] || "";

    if (quote) {
      if (character === "\\" && quote !== "`") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
      quote = character;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (character !== "," || depth > 0) {
      continue;
    }

    parts.push(parameters.slice(start, index).trim());
    start = index + 1;
  }

  parts.push(parameters.slice(start).trim());
  return parts.filter(Boolean);
}

function maskPhpStringsAndComments(source: string): string {
  let output = "";
  let quote: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] || "";
    const next = source[index + 1] || "";

    if (inLineComment) {
      output += character === "\n" ? "\n" : " ";

      if (character === "\n") {
        inLineComment = false;
      }

      continue;
    }

    if (inBlockComment) {
      output += character === "\n" ? "\n" : " ";

      if (character === "*" && next === "/") {
        output += " ";
        index += 1;
        inBlockComment = false;
      }

      continue;
    }

    if (quote) {
      output += character === "\n" ? "\n" : " ";

      if (character === "\\" && quote !== "`") {
        output += next === "\n" ? "\n" : " ";
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "/" && next === "/") {
      output += "  ";
      index += 1;
      inLineComment = true;
      continue;
    }

    if (character === "#" && source[index - 1] !== "$") {
      output += " ";
      inLineComment = true;
      continue;
    }

    if (character === "/" && next === "*") {
      output += "  ";
      index += 1;
      inBlockComment = true;
      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
      output += " ";
      quote = character;
      continue;
    }

    output += character;
  }

  return output;
}

function matchingPairOffset(
  source: string,
  openOffset: number,
  open: string,
  close: string,
): number | null {
  let depth = 0;
  let quote: string | null = null;

  for (let index = openOffset; index < source.length; index += 1) {
    const character = source[index] || "";

    if (quote) {
      if (character === "\\" && quote !== "`") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
      quote = character;
      continue;
    }

    if (character === open) {
      depth += 1;
      continue;
    }

    if (character !== close) {
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return index;
    }
  }

  return null;
}

function offsetAtPosition(source: string, position: EditorPosition): number {
  let line = 1;
  let column = 1;

  for (let index = 0; index < source.length; index += 1) {
    if (line === position.lineNumber && column === position.column) {
      return index;
    }

    if (source[index] === "\n") {
      line += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return source.length;
}
