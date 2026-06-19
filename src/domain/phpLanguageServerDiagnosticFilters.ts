import type { LanguageServerDiagnostic } from "./languageServerDiagnostics";
import {
  defaultPhpFrameworkProviders,
  isKnownPhpFrameworkStaticMethod,
  type PhpFrameworkProvider,
} from "./phpFrameworkProviders";
import {
  PHP_EXPRESSION_RECEIVER_PATTERN,
  phpNormalizeReceiverExpression,
} from "./phpReceiverExpressions";

export interface PhpTraitHostMethodDiagnosticContext {
  methodName: string;
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
      !isPhpactorTraitHostMethodDiagnostic(
        source,
        diagnostic,
        Boolean(options.allowDependencyTraitFallback),
        options.contextualTraitHostMethods,
        options.path,
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
      String.raw`(?:\$this\s*->|(?:self|static)\s*::)\s*${escapeRegExp(methodName)}\s*\(`,
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

export function phpUnresolvedMemberMethodDiagnosticContext(
  source: string,
  diagnostic: LanguageServerDiagnostic,
): PhpMemberMethodDiagnosticContext | null {
  if (!unresolvedMethodDiagnosticPattern.test(diagnostic.message)) {
    return null;
  }

  const line = lineAt(source, diagnostic.line);

  if (!line) {
    return null;
  }

  for (const call of line.matchAll(memberMethodCallPattern)) {
    const receiverExpression = call[1] ?? "";
    const methodName = call[2] ?? "";

    if (!receiverExpression || !methodName) {
      continue;
    }

    const callStart = call.index ?? 0;
    const methodStart = callStart + call[0].lastIndexOf(methodName);
    const methodEnd = methodStart + methodName.length;

    if (diagnosticTouchesMethod(diagnostic, methodName, methodStart, methodEnd)) {
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

  const line = lineAt(source, diagnostic.line);

  if (!line) {
    return null;
  }

  for (const call of line.matchAll(staticMethodCallPattern)) {
    const className = call[1]?.replace(/^\\+/, "") ?? "";
    const methodName = call[2] ?? "";

    if (!className || !methodName) {
      continue;
    }

    const callStart = call.index ?? 0;
    const methodStart = callStart + call[0].lastIndexOf(methodName);
    const methodEnd = methodStart + methodName.length;

    if (diagnosticTouchesMethod(diagnostic, methodName, methodStart, methodEnd)) {
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
  methodStart: number,
  methodEnd: number,
): boolean {
  if (diagnostic.message.toLowerCase().includes(method.toLowerCase())) {
    return true;
  }

  return (
    diagnostic.character >= methodStart - 2 &&
    diagnostic.character <= methodEnd + 2
  );
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
