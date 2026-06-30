import type { LanguageServerDiagnostic } from "./languageServerDiagnostics";
import {
  defaultPhpFrameworkProviders,
  isKnownPhpFrameworkMemberMethod,
  isKnownPhpFrameworkStaticMethod,
  type PhpFrameworkProvider,
  type PhpFrameworkSourceContext,
} from "./phpFrameworkProviders";
import {
  PHP_EXPRESSION_RECEIVER_PATTERN,
  PHP_MEMBER_ACCESS_PATTERN,
  PHP_MEMBER_CHAIN_SEGMENT_PATTERN,
  maskPhpStringsAndComments,
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

export interface PhpTraitHostConstantDiagnosticContext {
  constantName: string;
  traitName: string;
}

export interface PhpMemberMethodDiagnosticContext {
  methodName: string;
  receiverClassName: string | null;
  receiverExpression: string;
}

export interface PhpMemberPropertyDiagnosticContext {
  propertyName: string;
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

/**
 * Marker `source` stamped on a diagnostic that we classify as Laravel framework
 * "magic" (a known builder/macro/scope/static member the static analyser cannot
 * resolve but the framework provides at runtime). It is surfaced as a soft hint
 * rather than dropped, so the user can tell "probably framework magic" apart
 * from a real error without losing the marker entirely.
 */
export const LARAVEL_MAGIC_DIAGNOSTIC_SOURCE = "laravel-magic";

/**
 * Why a PHP diagnostic was reclassified away from its raw phpactor severity.
 *
 * - `parse-artifact`: a phpactor false positive (docblock hygiene, keyword/return
 *   mis-parse, stale return parse) — dropped; it never reflects a real defect.
 * - `contextual-existing`: the member/constant/property genuinely exists once the
 *   surrounding workspace context is resolved (semantic confirmation or trait
 *   host) — dropped as a confirmed false positive.
 * - `framework-magic`: a known Laravel builder/macro/scope/static member whose
 *   existence cannot be statically confirmed but is framework-provided — kept and
 *   downgraded to a soft hint instead of an error.
 *
 * A diagnostic with no matching reason is a `real` error and is left untouched.
 */
export type PhpDiagnosticClassificationReason =
  | "parse-artifact"
  | "contextual-existing"
  | "framework-magic";

export interface PhpLanguageServerDiagnosticFilterOptions {
  allowDependencyTraitFallback?: boolean;
  contextualExistingMethods?: ReadonlySet<string>;
  contextualMemberMethods?: ReadonlySet<string>;
  contextualMemberProperties?: ReadonlySet<string>;
  contextualTraitHostConstants?: ReadonlySet<string>;
  contextualTraitHostMethods?: ReadonlySet<string>;
  contextualTraitHostProperties?: ReadonlySet<string>;
  frameworkProviders?: readonly PhpFrameworkProvider[];
  frameworkSourceContext?: PhpFrameworkSourceContext;
  path?: string | null;
}

const unresolvedMethodDiagnosticPattern =
  /\b(could not find|does not exist|not defined|not found|undefined|unknown|unresolved)\b.*\bmethod\b|\bmethod\b.*\b(could not find|does not exist|not defined|not found|undefined|unknown|unresolved)\b/i;
const unresolvedPropertyDiagnosticPattern =
  /\b(could not find|does not exist|not defined|not found|undefined|unknown|unresolved)\b.*\bproperty\b|\bproperty\b.*\b(could not find|does not exist|not defined|not found|undefined|unknown|unresolved)\b/i;
const staticMethodCallPattern =
  /\b((?:\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*|self|static|parent)::\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
const memberMethodCallPattern = new RegExp(
  String.raw`(` +
    PHP_EXPRESSION_RECEIVER_PATTERN +
    String.raw`(?:` +
    PHP_MEMBER_CHAIN_SEGMENT_PATTERN +
    String.raw`)*?)` +
    PHP_MEMBER_ACCESS_PATTERN +
    String.raw`([A-Za-z_][A-Za-z0-9_]*)\s*\(`,
  "g",
);
const memberPropertyAccessPattern = new RegExp(
  String.raw`(` +
    PHP_EXPRESSION_RECEIVER_PATTERN +
    String.raw`(?:` +
    PHP_MEMBER_CHAIN_SEGMENT_PATTERN +
    String.raw`)*?)` +
    PHP_MEMBER_ACCESS_PATTERN +
    String.raw`([A-Za-z_][A-Za-z0-9_]*)\b(?!\s*\()`,
  "g",
);

export function filterPhpLanguageServerDiagnostics(
  source: string,
  diagnostics: LanguageServerDiagnostic[],
  options: PhpLanguageServerDiagnosticFilterOptions = {},
): LanguageServerDiagnostic[] {
  return diagnostics.flatMap((diagnostic) =>
    applyPhpDiagnosticClassification(
      diagnostic,
      classifyPhpLanguageServerDiagnostic(source, diagnostic, options),
    ),
  );
}

/**
 * Classifies a single diagnostic by the FIRST matching reason, in the same
 * precedence order the previous suppression filter used: parse artifacts and
 * contextually-confirmed members win over a framework-magic guess, so a
 * confirmed false positive is dropped rather than surfaced as a hint.
 */
export function classifyPhpLanguageServerDiagnostic(
  source: string,
  diagnostic: LanguageServerDiagnostic,
  options: PhpLanguageServerDiagnosticFilterOptions = {},
): PhpDiagnosticClassificationReason | null {
  if (isIgnoredPhpactorDocblockDiagnostic(diagnostic)) {
    return "parse-artifact";
  }

  if (isPhpactorKeywordMethodDiagnostic(source, diagnostic)) {
    return "parse-artifact";
  }

  if (isPhpactorStaleReturnParseDiagnostic(source, diagnostic)) {
    return "parse-artifact";
  }

  if (
    isContextualExistingMethodDiagnostic(
      source,
      diagnostic,
      options.contextualExistingMethods,
    )
  ) {
    return "contextual-existing";
  }

  if (
    isContextualExistingMemberMethodDiagnostic(
      source,
      diagnostic,
      options.contextualMemberMethods,
    )
  ) {
    return "contextual-existing";
  }

  if (
    isContextualExistingMemberPropertyDiagnostic(
      source,
      diagnostic,
      options.contextualMemberProperties,
    )
  ) {
    return "contextual-existing";
  }

  if (
    isKnownPhpFrameworkMemberMethodDiagnostic(
      source,
      diagnostic,
      options.frameworkProviders ?? defaultPhpFrameworkProviders,
      options.frameworkSourceContext,
    )
  ) {
    return "framework-magic";
  }

  if (
    isPhpactorTraitHostMethodDiagnostic(
      source,
      diagnostic,
      Boolean(options.allowDependencyTraitFallback),
      options.contextualTraitHostMethods,
      options.path,
    )
  ) {
    return "contextual-existing";
  }

  if (
    isPhpactorTraitHostConstantDiagnostic(
      source,
      diagnostic,
      options.contextualTraitHostConstants,
    )
  ) {
    return "contextual-existing";
  }

  if (
    isPhpactorTraitHostPropertyDiagnostic(
      source,
      diagnostic,
      options.contextualTraitHostProperties,
    )
  ) {
    return "contextual-existing";
  }

  if (
    isKnownPhpFrameworkStaticMethodDiagnostic(
      source,
      diagnostic,
      options.frameworkProviders ?? defaultPhpFrameworkProviders,
      options.frameworkSourceContext,
    )
  ) {
    return "framework-magic";
  }

  return null;
}

/**
 * Turns a classification into the published diagnostic(s): drop false positives,
 * downgrade framework magic to a soft hint, and leave real errors untouched.
 */
function applyPhpDiagnosticClassification(
  diagnostic: LanguageServerDiagnostic,
  reason: PhpDiagnosticClassificationReason | null,
): LanguageServerDiagnostic[] {
  if (reason === "parse-artifact") {
    return [];
  }

  if (reason === "contextual-existing") {
    return [];
  }

  if (reason === "framework-magic") {
    return [downgradePhpDiagnosticToFrameworkMagicHint(diagnostic)];
  }

  return [diagnostic];
}

function downgradePhpDiagnosticToFrameworkMagicHint(
  diagnostic: LanguageServerDiagnostic,
): LanguageServerDiagnostic {
  return {
    ...diagnostic,
    severity: "hint",
    source: LARAVEL_MAGIC_DIAGNOSTIC_SOURCE,
  };
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
  sourceContext?: PhpFrameworkSourceContext,
): boolean {
  const context = phpUnresolvedStaticMethodDiagnosticContext(source, diagnostic);

  return Boolean(
    context &&
      isKnownPhpFrameworkStaticMethod(
        source,
        context.className,
        context.methodName,
        frameworkProviders,
        sourceContext,
      ),
  );
}

function isKnownPhpFrameworkMemberMethodDiagnostic(
  source: string,
  diagnostic: LanguageServerDiagnostic,
  frameworkProviders: readonly PhpFrameworkProvider[],
  sourceContext?: PhpFrameworkSourceContext,
): boolean {
  const context = phpUnresolvedMemberMethodDiagnosticContext(source, diagnostic);

  return Boolean(
    context &&
      isKnownPhpFrameworkMemberMethod(
        source,
        context.receiverExpression,
        context.methodName,
        frameworkProviders,
        sourceContext,
        context.receiverClassName,
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

function isContextualExistingMemberPropertyDiagnostic(
  source: string,
  diagnostic: LanguageServerDiagnostic,
  contextualMemberProperties: ReadonlySet<string> | undefined,
): boolean {
  if (!contextualMemberProperties?.size) {
    return false;
  }

  const context = phpUnresolvedMemberPropertyDiagnosticContext(
    source,
    diagnostic,
  );

  if (!context) {
    return false;
  }

  return contextualMemberProperties.has(
    phpMemberPropertyDiagnosticKey(
      context.receiverExpression,
      context.propertyName,
    ),
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

function isPhpactorTraitHostConstantDiagnostic(
  source: string,
  diagnostic: LanguageServerDiagnostic,
  contextualTraitHostConstants: ReadonlySet<string> | undefined,
): boolean {
  if (!contextualTraitHostConstants?.size) {
    return false;
  }

  const context = phpTraitHostConstantDiagnosticContext(source, diagnostic);

  if (!context) {
    return false;
  }

  return contextualTraitHostConstants.has(
    phpTraitHostConstantDiagnosticKey(context.traitName, context.constantName),
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

export function phpTraitHostConstantDiagnosticContext(
  source: string,
  diagnostic: LanguageServerDiagnostic,
): PhpTraitHostConstantDiagnosticContext | null {
  if (diagnostic.source?.toLowerCase() !== "phpactor") {
    return null;
  }

  const context = traitHostConstantDiagnosticContextFromMessage(
    diagnostic.message,
  );
  const constantName = context?.constantName ?? "";
  const traitName = context?.traitName ?? "";

  if (!constantName || !traitName) {
    return null;
  }

  const line = lineAt(source, diagnostic.line);

  if (
    !line ||
    !new RegExp(
      String.raw`(?:self|static|parent)\s*::\s*${escapeRegExp(
        constantName,
      )}\b(?!\s*\()`,
      "i",
    ).test(line)
  ) {
    return null;
  }

  return {
    constantName,
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

function traitHostConstantDiagnosticContextFromMessage(
  message: string,
): PhpTraitHostConstantDiagnosticContext | null {
  const constantFirstPatterns = [
    /\b(?:class\s+)?constant\s+["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s+(?:could not find|does not exist|not defined|not found|undefined|unknown|unresolved)\s+on trait\s+["']?([^"']+)["']?/i,
    /\bundefined\s+(?:class\s+)?constant\s+["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s+on trait\s+["']?([^"']+)["']?/i,
  ];

  for (const pattern of constantFirstPatterns) {
    const match = pattern.exec(message);
    const constantName = match?.[1]?.trim() ?? "";
    const traitName = match?.[2]?.trim().replace(/^\\+/, "") ?? "";

    if (constantName && traitName) {
      return { constantName, traitName };
    }
  }

  const traitFirstMatch =
    /\btrait\s+["']?([^"']+)["']?\s+(?:has no|does not have)\s+(?:class\s+)?constant\s+["']?([A-Za-z_][A-Za-z0-9_]*)["']?/i.exec(
      message,
    );
  const traitName = traitFirstMatch?.[1]?.trim().replace(/^\\+/, "") ?? "";
  const constantName = traitFirstMatch?.[2]?.trim() ?? "";

  return constantName && traitName ? { constantName, traitName } : null;
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
        receiverClassName: phpUnresolvedMemberMethodDiagnosticReceiverClassName(
          diagnostic.message,
        ),
        receiverExpression: phpNormalizeReceiverExpression(receiverExpression),
      };
    }
  }

  return null;
}

function phpUnresolvedMemberMethodDiagnosticReceiverClassName(
  message: string,
): string | null {
  const match =
    /\bon\s+(?:class|trait|interface)\s+["']([^"']+)["']/i.exec(message) ??
    /\b(?:class|trait|interface)\s+["']([^"']+)["'].*\bmethod\b/i.exec(message);
  const className = match?.[1]?.trim() ?? "";

  return className || null;
}

export function phpUnresolvedMemberPropertyDiagnosticContext(
  source: string,
  diagnostic: LanguageServerDiagnostic,
): PhpMemberPropertyDiagnosticContext | null {
  if (!unresolvedPropertyDiagnosticPattern.test(diagnostic.message)) {
    return null;
  }

  const context = statementContextForDiagnostic(source, diagnostic);

  if (!context) {
    return null;
  }

  for (const access of context.text.matchAll(memberPropertyAccessPattern)) {
    const receiverExpression = access[1] ?? "";
    const propertyName = access[2] ?? "";

    if (!receiverExpression || !propertyName) {
      continue;
    }

    const accessStart = access.index ?? 0;
    const propertyStart = accessStart + access[0].lastIndexOf(propertyName);
    const propertyEnd = propertyStart + propertyName.length;

    if (
      diagnosticTouchesMember(
        diagnostic,
        propertyName,
        context.diagnosticOffset,
        context.startOffset + propertyStart,
        context.startOffset + propertyEnd,
      )
    ) {
      return {
        propertyName,
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

export function phpTraitHostConstantDiagnosticKey(
  traitName: string,
  constantName: string,
): string {
  return `${traitName.trim().replace(/^\\+/, "").toLowerCase()}#::${constantName
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

export function phpMemberPropertyDiagnosticKey(
  receiverExpression: string,
  propertyName: string,
): string {
  return `${phpNormalizeReceiverExpression(receiverExpression).toLowerCase()}#$${propertyName
    .trim()
    .replace(/^\$+/, "")
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
  return diagnosticTouchesMember(
    diagnostic,
    method,
    diagnosticOffset,
    absoluteMethodStart,
    absoluteMethodEnd,
  );
}

function diagnosticTouchesMember(
  diagnostic: LanguageServerDiagnostic,
  member: string,
  diagnosticOffset: number,
  absoluteMemberStart: number,
  absoluteMemberEnd: number,
): boolean {
  if (diagnostic.message.toLowerCase().includes(member.toLowerCase())) {
    return true;
  }

  return (
    diagnosticOffset >= absoluteMemberStart - 2 &&
    diagnosticOffset <= absoluteMemberEnd + 2
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

  const memberCallEndOffset = memberCallScanEndOffset(source, diagnosticOffset);
  const contextEndOffset = trimTrailingStatementBoundaryBeforeOffset(
    source,
    memberCallEndOffset,
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

function memberCallScanEndOffset(source: string, diagnosticOffset: number): number {
  const memberNameEnd = identifierEndOffsetAt(source, diagnosticOffset);
  const callArgumentsEnd = balancedCallArgumentsEndOffset(source, memberNameEnd);

  return callArgumentsEnd ?? memberNameEnd;
}

function identifierEndOffsetAt(source: string, offset: number): number {
  let cursor = Math.max(0, Math.min(source.length, offset));

  while (cursor < source.length && /[A-Za-z0-9_]/.test(source[cursor] ?? "")) {
    cursor += 1;
  }

  return cursor;
}

function balancedCallArgumentsEndOffset(
  source: string,
  memberNameEnd: number,
): number | null {
  let cursor = memberNameEnd;

  while (cursor < source.length && /[ \t]/.test(source[cursor] ?? "")) {
    cursor += 1;
  }

  const callOpenOffset = cursor;

  if (source[callOpenOffset] !== "(") {
    return null;
  }

  const masked = maskPhpStringsAndComments(source);
  let depth = 0;

  for (let index = callOpenOffset; index < masked.length; index += 1) {
    const character = masked[index];

    if (character === "(") {
      depth += 1;
      continue;
    }

    if (character !== ")") {
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return index + 1;
    }
  }

  return callOpenOffset + 1;
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
