import type { LanguageServerDiagnostic } from "./languageServerDiagnostics";

const laravelEloquentBuilderMethods = new Set([
  "chunk",
  "count",
  "create",
  "doesntExist",
  "doesntHave",
  "exists",
  "find",
  "findOrFail",
  "first",
  "firstOrCreate",
  "firstOrFail",
  "forceDelete",
  "get",
  "groupBy",
  "having",
  "insert",
  "join",
  "latest",
  "leftJoin",
  "limit",
  "offset",
  "oldest",
  "onlyTrashed",
  "orderBy",
  "orWhere",
  "orWhereBetween",
  "orWhereDate",
  "orWhereHas",
  "orWhereIn",
  "orWhereNotIn",
  "orWhereNotNull",
  "orWhereNull",
  "paginate",
  "pluck",
  "query",
  "restore",
  "rightJoin",
  "select",
  "simplePaginate",
  "skip",
  "take",
  "updateOrCreate",
  "where",
  "whereBetween",
  "whereDate",
  "whereHas",
  "whereIn",
  "whereMonth",
  "whereNotBetween",
  "whereNotIn",
  "whereNotNull",
  "whereNull",
  "whereRelation",
  "whereTime",
  "whereYear",
  "with",
  "withCount",
  "withTrashed",
  "without",
  "withoutTrashed",
]);
const ignoredPhpactorDocblockDiagnosticCodes = new Set([
  "worse.docblock_missing_param",
  "worse.docblock_missing_return_type",
]);

const unresolvedMethodDiagnosticPattern =
  /\b(could not find|does not exist|not defined|not found|undefined|unknown|unresolved)\b.*\bmethod\b|\bmethod\b.*\b(could not find|does not exist|not defined|not found|undefined|unknown|unresolved)\b/i;
const staticMethodCallPattern =
  /\b[A-Z_][A-Za-z0-9_]*(?:\\[A-Z_][A-Za-z0-9_]*)*::\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

export function filterPhpLanguageServerDiagnostics(
  source: string,
  diagnostics: LanguageServerDiagnostic[],
): LanguageServerDiagnostic[] {
  return diagnostics.filter(
    (diagnostic) =>
      !isIgnoredPhpactorDocblockDiagnostic(diagnostic) &&
      !isPhpactorKeywordMethodDiagnostic(source, diagnostic) &&
      !isLaravelEloquentStaticBuilderDiagnostic(source, diagnostic),
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

function isLaravelEloquentStaticBuilderDiagnostic(
  source: string,
  diagnostic: LanguageServerDiagnostic,
): boolean {
  if (!unresolvedMethodDiagnosticPattern.test(diagnostic.message)) {
    return false;
  }

  const line = lineAt(source, diagnostic.line);

  if (!line) {
    return false;
  }

  for (const call of line.matchAll(staticMethodCallPattern)) {
    const method = call[1] || "";

    if (!laravelEloquentBuilderMethods.has(method)) {
      continue;
    }

    const callStart = call.index ?? 0;
    const methodStart = callStart + call[0].indexOf(method);
    const methodEnd = methodStart + method.length;

    if (diagnosticTouchesMethod(diagnostic, method, methodStart, methodEnd)) {
      return true;
    }
  }

  return false;
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
