import type { EditorPosition } from "./languageServerFeatures";
import {
  phpLaravelConfigReferenceContextAt,
  type PhpLaravelConfigReferenceCall,
} from "./phpLaravelConfig";
import {
  phpLaravelNamedRouteReferenceContextAt,
  type PhpLaravelNamedRouteReferenceCall,
} from "./phpLaravelRoutes";
import {
  phpLaravelViewNameCandidateRelativePaths,
  phpLaravelViewReferenceContextAt,
  type PhpLaravelViewReferenceCall,
} from "./phpLaravelViews";
import { detectBladeReferenceAt } from "./bladeNavigation";

export type LaravelDiagnosticKind =
  | "missing-config"
  | "missing-route"
  | "missing-view";

export interface LaravelReferenceDiagnostic {
  character: number;
  code: string;
  data?: unknown;
  endCharacter: number;
  endLine: number;
  kind: LaravelDiagnosticKind;
  line: number;
  message: string;
  name: string;
  severity: "warning";
  source: "Laravel";
}

export interface LaravelReferenceIndexes {
  configKeys?: readonly string[];
  routeNames?: readonly string[];
  viewNames?: readonly string[];
}

const phpViewDiagnosticCalls: ReadonlySet<PhpLaravelViewReferenceCall> = new Set([
  "view",
  "View::make",
  "view()->make",
  "response()->view",
  "Route::view",
]);
const phpRouteDiagnosticCalls: ReadonlySet<PhpLaravelNamedRouteReferenceCall> =
  new Set([
    "route",
    "to_route",
    "redirect()->route",
    "redirect()->signedRoute",
    "redirect()->temporarySignedRoute",
    "Redirect::route",
    "Redirect::signedRoute",
    "Redirect::temporarySignedRoute",
    "URL::route",
    "URL::signedRoute",
    "URL::temporarySignedRoute",
    "Uri::route",
    "Uri::signedRoute",
    "Uri::temporarySignedRoute",
  ]);
const phpConfigDiagnosticCalls: ReadonlySet<PhpLaravelConfigReferenceCall> =
  new Set([
    "config",
    "Config::get",
    "Config::string",
    "Config::integer",
    "Config::float",
    "Config::boolean",
    "Config::array",
    "Config::collection",
    "config()->get",
    "config()->string",
    "config()->integer",
    "config()->float",
    "config()->boolean",
    "config()->array",
    "config()->collection",
    "#[Config]",
  ]);
const bladeViewDiagnosticDirectives = new Set(["include", "extends"]);

export function phpLaravelReferenceDiagnostics(
  source: string,
  indexes: LaravelReferenceIndexes,
): LaravelReferenceDiagnostic[] {
  const diagnostics: LaravelReferenceDiagnostic[] = [];
  const viewNames = lowerSet(indexes.viewNames ?? []);
  const routeNames = lowerSet(indexes.routeNames ?? []);
  const configKeys = lowerSet(indexes.configKeys ?? []);
  const seen = new Set<string>();

  for (const literal of stringLiterals(source)) {
    const position = editorPositionAtOffset(source, literal.end);
    const view = viewNames.size
      ? phpLaravelViewReferenceContextAt(source, position)
      : null;

    if (
      view &&
      phpViewDiagnosticCalls.has(view.call) &&
      !viewNames.has(view.name.toLowerCase())
    ) {
      pushUnique(
        diagnostics,
        seen,
        missingViewDiagnostic(source, view.name, view.position),
      );
      continue;
    }

    const route = routeNames.size
      ? phpLaravelNamedRouteReferenceContextAt(source, position)
      : null;

    if (
      route &&
      phpRouteDiagnosticCalls.has(route.call) &&
      !routeNames.has(route.name.toLowerCase())
    ) {
      pushUnique(
        diagnostics,
        seen,
        diagnosticFromPosition(
          source,
          "missing-route",
          "laravel.missingRoute",
          route.name,
          route.position,
          `No Laravel route named ${route.name} was found.`,
        ),
      );
      continue;
    }

    const config = configKeys.size
      ? phpLaravelConfigReferenceContextAt(source, position)
      : null;

    if (
      config &&
      phpConfigDiagnosticCalls.has(config.call) &&
      shouldReportMissingConfigKey(config.key, configKeys)
    ) {
      pushUnique(
        diagnostics,
        seen,
        diagnosticFromPosition(
          source,
          "missing-config",
          "laravel.missingConfig",
          config.key,
          config.position,
          `No Laravel config key ${config.key} was found.`,
        ),
      );
    }
  }

  return diagnostics;
}

export function bladeLaravelReferenceDiagnostics(
  source: string,
  indexes: Pick<LaravelReferenceIndexes, "viewNames">,
): LaravelReferenceDiagnostic[] {
  const viewNames = lowerSet(indexes.viewNames ?? []);

  if (viewNames.size === 0) {
    return [];
  }

  const diagnostics: LaravelReferenceDiagnostic[] = [];
  const seen = new Set<string>();

  for (const literal of stringLiterals(source)) {
    const reference = detectBladeReferenceAt(source, literal.start + 1);

    if (
      reference?.kind !== "view" ||
      viewNames.has(reference.name.toLowerCase()) ||
      !isBladeDiagnosticViewDirective(source, reference.nameStart)
    ) {
      continue;
    }

    pushUnique(
      diagnostics,
      seen,
      missingViewDiagnostic(
        source,
        reference.name,
        editorPositionAtOffset(source, reference.nameStart),
      ),
    );
  }

  return diagnostics;
}

export function missingLaravelViewReferenceAt(
  source: string,
  offset: number,
  language: "blade" | "php",
  viewNames: readonly string[],
): { name: string; relativePath: string } | null {
  const existingViews = lowerSet(viewNames);

  if (existingViews.size === 0) {
    return null;
  }

  const name =
    language === "blade"
      ? bladeMissingViewNameAt(source, offset, existingViews)
      : phpMissingViewNameAt(source, offset, existingViews);

  if (!name) {
    return null;
  }

  const [relativePath] = phpLaravelViewNameCandidateRelativePaths(name);

  return relativePath ? { name, relativePath } : null;
}

function phpMissingViewNameAt(
  source: string,
  offset: number,
  existingViews: ReadonlySet<string>,
): string | null {
  const view = phpLaravelViewReferenceContextAt(
    source,
    editorPositionAtOffset(source, offset),
  );

  if (
    !view ||
    !phpViewDiagnosticCalls.has(view.call) ||
    existingViews.has(view.name.toLowerCase())
  ) {
    return null;
  }

  return view.name;
}

function bladeMissingViewNameAt(
  source: string,
  offset: number,
  existingViews: ReadonlySet<string>,
): string | null {
  const reference = detectBladeReferenceAt(source, offset);

  if (
    reference?.kind !== "view" ||
    existingViews.has(reference.name.toLowerCase()) ||
    !isBladeDiagnosticViewDirective(source, reference.nameStart)
  ) {
    return null;
  }

  return reference.name;
}

function missingViewDiagnostic(
  source: string,
  name: string,
  position: EditorPosition,
): LaravelReferenceDiagnostic {
  const diagnostic = diagnosticFromPosition(
    source,
    "missing-view",
    "laravel.missingView",
    name,
    position,
    `No Laravel view named ${name} was found.`,
  );
  const [relativePath] = phpLaravelViewNameCandidateRelativePaths(name);

  return {
    ...diagnostic,
    data: relativePath
      ? {
          kind: "missing-view",
          name,
          relativePath,
        }
      : undefined,
  };
}

function diagnosticFromPosition(
  source: string,
  kind: LaravelDiagnosticKind,
  code: string,
  name: string,
  position: EditorPosition,
  message: string,
): LaravelReferenceDiagnostic {
  const line = Math.max(0, position.lineNumber - 1);
  const character = Math.max(0, position.column - 1);
  const end = endLineCharacterForText(source, line, character, name);

  return {
    character,
    code,
    endCharacter: end.character,
    endLine: end.line,
    kind,
    line,
    message,
    name,
    severity: "warning",
    source: "Laravel",
  };
}

function pushUnique(
  diagnostics: LaravelReferenceDiagnostic[],
  seen: Set<string>,
  diagnostic: LaravelReferenceDiagnostic,
): void {
  const key = [
    diagnostic.code,
    diagnostic.name.toLowerCase(),
    diagnostic.line,
    diagnostic.character,
  ].join("\0");

  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  diagnostics.push(diagnostic);
}

function shouldReportMissingConfigKey(
  configKey: string,
  configKeys: ReadonlySet<string>,
): boolean {
  const normalized = configKey.toLowerCase();

  if (configKeys.has(normalized)) {
    return false;
  }

  const root = normalized.split(".")[0] ?? "";

  if (!normalized.includes(".")) {
    return true;
  }

  for (const key of configKeys) {
    if (key.startsWith(`${root}.`)) {
      return true;
    }
  }

  return false;
}

function isBladeDiagnosticViewDirective(source: string, nameStart: number): boolean {
  const openParen = source.lastIndexOf("(", nameStart);

  if (openParen < 0) {
    return false;
  }

  const match = /@([A-Za-z][A-Za-z0-9_]*)\s*$/.exec(
    source.slice(0, openParen),
  );

  return Boolean(match?.[1] && bladeViewDiagnosticDirectives.has(match[1]));
}

function lowerSet(values: readonly string[]): Set<string> {
  return new Set(values.map((value) => value.toLowerCase()));
}

interface StringLiteralSpan {
  end: number;
  start: number;
}

function stringLiterals(source: string): StringLiteralSpan[] {
  const literals: StringLiteralSpan[] = [];
  let index = 0;

  while (index < source.length) {
    const character = source[index] ?? "";

    if (character !== "'" && character !== "\"") {
      index += 1;
      continue;
    }

    const end = stringLiteralEnd(source, index);
    literals.push({ end, start: index });
    index = end + 1;
  }

  return literals;
}

function stringLiteralEnd(source: string, quoteStart: number): number {
  const quote = source[quoteStart];

  for (let index = quoteStart + 1; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
      continue;
    }

    if (source[index] === quote) {
      return index;
    }
  }

  return source.length;
}

function editorPositionAtOffset(source: string, offset: number): EditorPosition {
  const position = lineCharacterAt(source, offset);

  return {
    column: position.character + 1,
    lineNumber: position.line + 1,
  };
}

function lineCharacterAt(
  source: string,
  offset: number,
): { character: number; line: number } {
  let line = 0;
  let lineStart = 0;
  const limit = Math.max(0, Math.min(offset, source.length));

  for (let index = 0; index < limit; index += 1) {
    if (source[index] === "\n") {
      line += 1;
      lineStart = index + 1;
    }
  }

  return { character: limit - lineStart, line };
}

function endLineCharacterForText(
  source: string,
  line: number,
  character: number,
  text: string,
): { character: number; line: number } {
  const start = offsetAtLineCharacter(source, line, character);
  const end = lineCharacterAt(source, start + text.length);

  return end;
}

function offsetAtLineCharacter(
  source: string,
  targetLine: number,
  targetCharacter: number,
): number {
  let line = 0;
  let offset = 0;

  while (line < targetLine && offset < source.length) {
    const next = source.indexOf("\n", offset);

    if (next < 0) {
      return source.length;
    }

    offset = next + 1;
    line += 1;
  }

  return Math.min(source.length, offset + targetCharacter);
}
