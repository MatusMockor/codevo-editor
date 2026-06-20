import type { LanguageServerDiagnostic } from "./languageServerDiagnostics";
import {
  defaultPhpFrameworkProviders,
  isKnownPhpFrameworkMemberMethod,
  isKnownPhpFrameworkStaticMethod,
  type PhpFrameworkProvider,
} from "./phpFrameworkProviders";
import {
  PHP_EXPRESSION_RECEIVER_PATTERN,
  phpNormalizeReceiverExpression,
  phpStatementPrefixRangeBeforeOffset,
} from "./phpReceiverExpressions";

export interface PhpTraitHostMethodDiagnosticContext {
  methodName: string;
  traitName: string;
}

export interface PhpTraitHostPropertyDiagnosticContext {
  propertyName: string;
  traitName: string;
}

export interface PhpMemberMethodDiagnosticContext {
  methodName: string;
  receiverExpression: string;
}

export interface PhpStaticMethodDiagnosticContext {
  className: string;
  methodName: string;
}

const ignoredPhpactorDocblockDiagnosticCodes = new Set([
  "worse.docblock_missing_param",
  "worse.docblock_missing_return_type",
]);

const unresolvedMethodDiagnosticPattern =
  /\b(could not find|does not exist|not defined|not found|undefined|unknown|unresolved)\b.*\bmethod\b|\bmethod\b.*\b(could not find|does not exist|not defined|not found|undefined|unknown|unresolved)\b/i;
const staticMethodCallPattern =
  /\b((?:\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*|self|static|parent)::\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
const memberMethodCallPattern = new RegExp(
  String.raw`(` +
    PHP_EXPRESSION_RECEIVER_PATTERN +
    String.raw`(?:\s*->\s*[A-Za-z_][A-Za-z0-9_]*\s*(?:\([^)]*\))?)*?)\s*->\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(`,
  "g",
);

export function filterPhpLanguageServerDiagnostics(
  source: string,
  diagnostics: LanguageServerDiagnostic[],
  options: {
    allowDependencyTraitFallback?: boolean;
    contextualExistingMethods?: ReadonlySet<string>;
    contextualMemberMethods?: ReadonlySet<string>;
    contextualTraitHostMethods?: ReadonlySet<string>;
    contextualTraitHostProperties?: ReadonlySet<string>;
    frameworkProviders?: readonly PhpFrameworkProvider[];
    path?: string | null;
  } = {},
): LanguageServerDiagnostic[] {
  return diagnostics.filter(
    (diagnostic) =>
      !isIgnoredPhpactorDocblockDiagnostic(diagnostic) &&
      !isPhpactorKeywordMethodDiagnostic(source, diagnostic) &&
      !isPhpactorStaleReturnParseDiagnostic(source, diagnostic) &&
      !isContextualExistingMethodDiagnostic(
        source,
        diagnostic,
        options.contextualExistingMethods,
      ) &&
      !isContextualExistingMemberMethodDiagnostic(
        source,
        diagnostic,
        options.contextualMemberMethods,
      ) &&
      !isKnownPhpFrameworkMemberMethodDiagnostic(
        source,
        diagnostic,
        options.frameworkProviders ?? defaultPhpFrameworkProviders,
      ) &&
      !isPhpactorTraitHostMethodDiagnostic(
        source,
        diagnostic,
        Boolean(options.allowDependencyTraitFallback),
        options.contextualTraitHostMethods,
        options.path,
      ) &&
      !isPhpactorTraitHostPropertyDiagnostic(
        source,
        diagnostic,
        options.contextualTraitHostProperties,
      ) &&
      !isKnownPhpFrameworkStaticMethodDiagnostic(
        source,
        diagnostic,
        options.frameworkProviders ?? defaultPhpFrameworkProviders,
      ),
  );
}

function isIgnoredPhpactorDocblockDiagnostic(
  diagnostic: LanguageServerDiagnostic,
): boolean {
  if (typeof diagnostic.code === "string") {
    return ignoredPhpactorDocblockDiagnosticCodes.has(diagnostic.code);
  }

  if (diagnostic.source?.toLowerCase() !== "phpactor") {
    return false;
  }

  return /\bmissing (?:docblock return type|@param)\b/i.test(
    diagnostic.message,
  );
}

function isKnownPhpFrameworkStaticMethodDiagnostic(
  source: string,
  diagnostic: LanguageServerDiagnostic,
  frameworkProviders: readonly PhpFrameworkProvider[],
): boolean {
  const context = phpUnresolvedStaticMethodDiagnosticContext(source, diagnostic);

  return Boolean(
    context &&
      isKnownPhpFrameworkStaticMethod(
        source,
        context.className,
        context.methodName,
        frameworkProviders,
      ),
  );
}

function isKnownPhpFrameworkMemberMethodDiagnostic(
  source: string,
  diagnostic: LanguageServerDiagnostic,
  frameworkProviders: readonly PhpFrameworkProvider[],
): boolean {
  const context = phpUnresolvedMemberMethodDiagnosticContext(source, diagnostic);

  return Boolean(
    context &&
      isKnownPhpFrameworkMemberMethod(
        source,
        context.receiverExpression,
        context.methodName,
        frameworkProviders,
      ),
  );
}

function isContextualExistingMemberMethodDiagnostic(
  source: string,
  diagnostic: LanguageServerDiagnostic,
  contextualMemberMethods: ReadonlySet<string> | undefined,
): boolean {
  if (!contextualMemberMethods?.size) {
    return false;
  }

  const context = phpUnresolvedMemberMethodDiagnosticContext(source, diagnostic);

  if (!context) {
    return false;
  }

  return contextualMemberMethods.has(
    phpMemberMethodDiagnosticKey(context.receiverExpression, context.methodName),
  );
}

function isContextualExistingMethodDiagnostic(
  source: string,
  diagnostic: LanguageServerDiagnostic,
  contextualExistingMethods: ReadonlySet<string> | undefined,
): boolean {
  if (!contextualExistingMethods?.size) {
    return false;
  }

  const context = phpUnresolvedStaticMethodDiagnosticContext(source, diagnostic);

  if (!context) {
    return false;
  }

  return contextualExistingMethods.has(
    phpMethodDiagnosticKey(context.className, context.methodName),
  );
}

function isPhpactorKeywordMethodDiagnostic(
  source: string,
  diagnostic: LanguageServerDiagnostic,
): boolean {
  if (diagnostic.source?.toLowerCase() !== "phpactor") {
    return false;
  }

  if (!/\bmethod\b.*["']?return["']?.*\bdoes not exist\b/i.test(diagnostic.message)) {
    return false;
  }

  const line = lineAt(source, diagnostic.line);

  return Boolean(line && /^\s*return\b/.test(line));
}

function isPhpactorStaleReturnParseDiagnostic(
  source: string,
  diagnostic: LanguageServerDiagnostic,
): boolean {
  if (
    !/\bParse error:\s*syntax error,\s*unexpected token ["']return["'].*\bStandard input code\b/i.test(
      diagnostic.message,
    )
  ) {
    return false;
  }

  const line = lineAt(source, diagnostic.line);
  const previousLine = previousMeaningfulLine(source, diagnostic.line);

  return Boolean(
    line &&
      /^\s*return\b/.test(line) &&
      previousLine &&
      /[;{}]\s*$/.test(previousLine),
  );
}

function isPhpactorTraitHostMethodDiagnostic(
  source: string,
  diagnostic: LanguageServerDiagnostic,
  allowDependencyTraitFallback: boolean,
  contextualTraitHostMethods: ReadonlySet<string> | undefined,
  path: string | null | undefined,
): boolean {
  const context = phpTraitHostMethodDiagnosticContext(source, diagnostic);

  if (!context) {
    return false;
  }

  if (
    contextualTraitHostMethods?.has(
      phpTraitHostMethodDiagnosticKey(context.traitName, context.methodName),
    )
  ) {
    return true;
  }

  return allowDependencyTraitFallback && isDependencyPath(path);
}

function isPhpactorTraitHostPropertyDiagnostic(
  source: string,
  diagnostic: LanguageServerDiagnostic,
  contextualTraitHostProperties: ReadonlySet<string> | undefined,
): boolean {
  if (!contextualTraitHostProperties?.size) {
    return false;
  }

  const context = phpTraitHostPropertyDiagnosticContext(source, diagnostic);

  if (!context) {
    return false;
  }

  return contextualTraitHostProperties.has(
    phpTraitHostPropertyDiagnosticKey(context.traitName, context.propertyName),
  );
}

export function phpTraitHostMethodDiagnosticContext(
  source: string,
  diagnostic: LanguageServerDiagnostic,
): PhpTraitHostMethodDiagnosticContext | null {
  if (diagnostic.source?.toLowerCase() !== "phpactor") {
    return null;
  }

  const context = traitHostMethodDiagnosticContextFromMessage(
    diagnostic.message,
  );
  const methodName = context?.methodName ?? "";
  const traitName = context?.traitName ?? "";

  if (!methodName || !traitName) {
    return null;
  }

  const line = lineAt(source, diagnostic.line);

  if (
    !line ||
    !new RegExp(
      String.raw`(?:\$this\s*->|(?:self|static|parent)\s*::)\s*${escapeRegExp(methodName)}\s*\(`,
      "i",
    ).test(line)
  ) {
    return null;
  }

  return {
    methodName,
    traitName,
  };
}

export function phpTraitHostPropertyDiagnosticContext(
  source: string,
  diagnostic: LanguageServerDiagnostic,
): PhpTraitHostPropertyDiagnosticContext | null {
  if (diagnostic.source?.toLowerCase() !== "phpactor") {
    return null;
  }

  const context = traitHostPropertyDiagnosticContextFromMessage(
    diagnostic.message,
  );
  const propertyName = context?.propertyName ?? "";
  const traitName = context?.traitName ?? "";

  if (!propertyName || !traitName) {
    return null;
  }

  const line = lineAt(source, diagnostic.line);

  if (
    !line ||
    !new RegExp(
      String.raw`(?:\$this\s*->\s*${escapeRegExp(
        propertyName,
      )}\b(?!\s*\()|(?:self|static|parent)\s*::\s*\$${escapeRegExp(
        propertyName,
      )}\b)`,
      "i",
    ).test(line)
  ) {
    return null;
  }

  return {
    propertyName,
    traitName,
  };
}

function traitHostMethodDiagnosticContextFromMessage(
  message: string,
): PhpTraitHostMethodDiagnosticContext | null {
  const methodFirstPatterns = [
    /\bmethod\s+["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s+does not exist on trait\s+["']?([^"']+)["']?/i,
    /\bundefined\s+method\s+["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s+on trait\s+["']?([^"']+)["']?/i,
  ];

  for (const pattern of methodFirstPatterns) {
    const match = pattern.exec(message);
    const methodName = match?.[1]?.trim() ?? "";
    const traitName = match?.[2]?.trim().replace(/^\\+/, "") ?? "";

    if (methodName && traitName) {
      return { methodName, traitName };
    }
  }

  const traitFirstMatch =
    /\btrait\s+["']?([^"']+)["']?\s+(?:has no|does not have)\s+method\s+["']?([A-Za-z_][A-Za-z0-9_]*)["']?/i.exec(
      message,
    );
  const traitName = traitFirstMatch?.[1]?.trim().replace(/^\\+/, "") ?? "";
  const methodName = traitFirstMatch?.[2]?.trim() ?? "";

  return methodName && traitName ? { methodName, traitName } : null;
}

function traitHostPropertyDiagnosticContextFromMessage(
  message: string,
): PhpTraitHostPropertyDiagnosticContext | null {
  const propertyFirstPatterns = [
    /\bproperty\s+["']?\$?([A-Za-z_][A-Za-z0-9_]*)["']?\s+does not exist on trait\s+["']?([^"']+)["']?/i,
    /\bundefined\s+property\s+["']?\$?([A-Za-z_][A-Za-z0-9_]*)["']?\s+on trait\s+["']?([^"']+)["']?/i,
  ];

  for (const pattern of propertyFirstPatterns) {
    const match = pattern.exec(message);
    const propertyName = match?.[1]?.trim() ?? "";
    const traitName = match?.[2]?.trim().replace(/^\\+/, "") ?? "";

    if (propertyName && traitName) {
      return { propertyName, traitName };
    }
  }

  const traitFirstMatch =
    /\btrait\s+["']?([^"']+)["']?\s+(?:has no|does not have)\s+property\s+["']?\$?([A-Za-z_][A-Za-z0-9_]*)["']?/i.exec(
      message,
    );
  const traitName = traitFirstMatch?.[1]?.trim().replace(/^\\+/, "") ?? "";
  const propertyName = traitFirstMatch?.[2]?.trim() ?? "";

  return propertyName && traitName ? { propertyName, traitName } : null;
}

export function phpUnresolvedMemberMethodDiagnosticContext(
  source: string,
  diagnostic: LanguageServerDiagnostic,
): PhpMemberMethodDiagnosticContext | null {
  if (!unresolvedMethodDiagnosticPattern.test(diagnostic.message)) {
    return null;
  }

  const context = statementContextForDiagnostic(source, diagnostic);

  if (!context) {
    return null;
  }

  for (const call of context.text.matchAll(memberMethodCallPattern)) {
    const receiverExpression = call[1] ?? "";
    const methodName = call[2] ?? "";

    if (!receiverExpression || !methodName) {
      continue;
    }

    const callStart = call.index ?? 0;
    const methodStart = callStart + call[0].lastIndexOf(methodName);
    const methodEnd = methodStart + methodName.length;

    if (
      diagnosticTouchesMethod(
        diagnostic,
        methodName,
        context.diagnosticOffset,
        context.startOffset + methodStart,
        context.startOffset + methodEnd,
      )
    ) {
      return {
        methodName,
        receiverExpression: phpNormalizeReceiverExpression(receiverExpression),
      };
    }
  }

  return null;
}

export function phpUnresolvedStaticMethodDiagnosticContext(
  source: string,
  diagnostic: LanguageServerDiagnostic,
): PhpStaticMethodDiagnosticContext | null {
  if (!unresolvedMethodDiagnosticPattern.test(diagnostic.message)) {
    return null;
  }

  const context = statementContextForDiagnostic(source, diagnostic);

  if (!context) {
    return null;
  }

  for (const call of context.text.matchAll(staticMethodCallPattern)) {
    const className = call[1]?.replace(/^\\+/, "") ?? "";
    const methodName = call[2] ?? "";

    if (!className || !methodName) {
      continue;
    }

    const callStart = call.index ?? 0;
    const methodStart = callStart + call[0].lastIndexOf(methodName);
    const methodEnd = methodStart + methodName.length;

    if (
      diagnosticTouchesMethod(
        diagnostic,
        methodName,
        context.diagnosticOffset,
        context.startOffset + methodStart,
        context.startOffset + methodEnd,
      )
    ) {
      return {
        className,
        methodName,
      };
    }
  }

  return null;
}

export function phpTraitHostMethodDiagnosticKey(
  traitName: string,
  methodName: string,
): string {
  return `${traitName.trim().replace(/^\\+/, "").toLowerCase()}#${methodName
    .trim()
    .toLowerCase()}`;
}

export function phpTraitHostPropertyDiagnosticKey(
  traitName: string,
  propertyName: string,
): string {
  return `${traitName.trim().replace(/^\\+/, "").toLowerCase()}#$${propertyName
    .trim()
    .replace(/^\$+/, "")
    .toLowerCase()}`;
}

export function phpMethodDiagnosticKey(
  className: string,
  methodName: string,
): string {
  return `${className.trim().replace(/^\\+/, "").toLowerCase()}#${methodName
    .trim()
    .toLowerCase()}`;
}

export function phpMemberMethodDiagnosticKey(
  receiverExpression: string,
  methodName: string,
): string {
  return `${phpNormalizeReceiverExpression(receiverExpression).toLowerCase()}#${methodName
    .trim()
    .toLowerCase()}`;
}

function isDependencyPath(path: string | null | undefined): boolean {
  return Boolean(
    path && /(?:^|[/\\])(?:vendor|node_modules)(?:[/\\]|$)/.test(path),
  );
}

function diagnosticTouchesMethod(
  diagnostic: LanguageServerDiagnostic,
  method: string,
  diagnosticOffset: number,
  absoluteMethodStart: number,
  absoluteMethodEnd: number,
): boolean {
  if (diagnostic.message.toLowerCase().includes(method.toLowerCase())) {
    return true;
  }

  return (
    diagnosticOffset >= absoluteMethodStart - 2 &&
    diagnosticOffset <= absoluteMethodEnd + 2
  );
}

function statementContextForDiagnostic(
  source: string,
  diagnostic: LanguageServerDiagnostic,
): { diagnosticOffset: number; startOffset: number; text: string } | null {
  const diagnosticOffset = offsetAtZeroBasedPosition(
    source,
    diagnostic.line,
    diagnostic.character,
  );

  if (diagnosticOffset === null) {
    return null;
  }

  const lineEndOffset = lineEndOffsetAt(source, diagnostic.line);
  const contextEndOffset = trimTrailingStatementBoundaryBeforeOffset(
    source,
    lineEndOffset ?? diagnosticOffset,
  );
  const prefix = phpStatementPrefixRangeBeforeOffset(
    source,
    Math.max(contextEndOffset, diagnosticOffset),
  );

  return {
    diagnosticOffset,
    startOffset: prefix.startOffset,
    text: prefix.text,
  };
}

function trimTrailingStatementBoundaryBeforeOffset(
  source: string,
  offset: number,
): number {
  let cursor = Math.max(0, Math.min(source.length, offset));

  while (cursor > 0 && /[ \t\r]/.test(source[cursor - 1] ?? "")) {
    cursor -= 1;
  }

  if (source[cursor - 1] === ";") {
    return cursor - 1;
  }

  return cursor;
}

function offsetAtZeroBasedPosition(
  source: string,
  zeroBasedLine: number,
  zeroBasedCharacter: number,
): number | null {
  if (zeroBasedLine < 0 || zeroBasedCharacter < 0) {
    return null;
  }

  let line = 0;
  let lineStart = 0;

  for (let index = 0; index < source.length; index += 1) {
    if (line === zeroBasedLine) {
      return Math.min(lineStart + zeroBasedCharacter, source.length);
    }

    if (source[index] === "\n") {
      line += 1;
      lineStart = index + 1;
    }
  }

  if (line === zeroBasedLine) {
    return Math.min(lineStart + zeroBasedCharacter, source.length);
  }

  return null;
}

function lineEndOffsetAt(source: string, zeroBasedLine: number): number | null {
  const lineStart = offsetAtZeroBasedPosition(source, zeroBasedLine, 0);

  if (lineStart === null) {
    return null;
  }

  const nextLineOffset = source.indexOf("\n", lineStart);

  return nextLineOffset < 0 ? source.length : nextLineOffset;
}

function lineAt(source: string, zeroBasedLine: number): string | null {
  if (zeroBasedLine < 0) {
    return null;
  }

  return source.split(/\r?\n/)[zeroBasedLine] ?? null;
}

function previousMeaningfulLine(
  source: string,
  zeroBasedLine: number,
): string | null {
  const lines = source.split(/\r?\n/);

  for (let index = zeroBasedLine - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();

    if (line) {
      return line;
    }
  }

  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
