/**
 * Pure detection of Blade constructs for navigation and completion inside
 * `.blade.php` files.
 *
 * Syntax highlighting is owned by Shiki and is out of scope here. This module
 * answers two questions about a cursor offset:
 *
 *   1. Is the cursor on a navigable Blade reference (a view, a component, a
 *      section, or a stack)? — `detectBladeReferenceAt`.
 *   2. Is the cursor typing a Blade directive after `@`? — for completion,
 *      `detectBladeDirectiveCompletionAt`.
 *
 * It is deliberately FILESYSTEM-FREE: it only reports the construct and its
 * literal name (plus offsets). Resolving a name to concrete file candidates is
 * delegated to `laravelPathResolution` (reused for views) and to a small
 * components-path helper here. Verifying which candidate actually exists is the
 * responsibility of the navigation / completion integration layer.
 *
 * It stays CONSERVATIVE — any ambiguous position resolves to `null` rather than
 * a guessed reference. Blade comments (`{{-- --}}`) and ordinary string content
 * are masked so a directive mentioned inside a comment is never matched.
 */

import { resolveLaravelViewTarget } from "./laravelPathResolution";

export type BladeReferenceKind = "view" | "component" | "section" | "stack";

export interface BladeReference {
  kind: BladeReferenceKind;
  name: string;
  /** Offset of the first character of the name in the source. */
  nameStart: number;
  /** Offset one past the last character of the name in the source. */
  nameEnd: number;
}

export interface BladeDirectiveCompletion {
  /** The identifier characters already typed after `@` (may be empty). */
  directivePrefix: string;
  /** Offset of the `@` that begins the directive being typed. */
  start: number;
}

/**
 * Blade directives offered for completion (without the leading `@`). Covers
 * control flow, layout/section/stack, auth/authorization, and the common
 * Laravel convenience directives.
 */
export const BLADE_DIRECTIVES: string[] = [
  "if",
  "elseif",
  "else",
  "endif",
  "unless",
  "endunless",
  "isset",
  "endisset",
  "empty",
  "endempty",
  "switch",
  "case",
  "default",
  "break",
  "continue",
  "endswitch",
  "for",
  "endfor",
  "foreach",
  "endforeach",
  "forelse",
  "endforelse",
  "while",
  "endwhile",
  "extends",
  "section",
  "endsection",
  "show",
  "stop",
  "overwrite",
  "append",
  "parent",
  "yield",
  "hasSection",
  "sectionMissing",
  "include",
  "includeIf",
  "includeWhen",
  "includeUnless",
  "includeFirst",
  "each",
  "component",
  "endcomponent",
  "slot",
  "endslot",
  "props",
  "stack",
  "push",
  "endpush",
  "pushOnce",
  "endpushOnce",
  "prepend",
  "endprepend",
  "php",
  "endphp",
  "json",
  "auth",
  "endauth",
  "guest",
  "endguest",
  "can",
  "elsecan",
  "cannot",
  "elsecannot",
  "endcan",
  "endcannot",
  "canany",
  "endcanany",
  "csrf",
  "method",
  "error",
  "enderror",
  "vite",
  "viteReactRefresh",
  "lang",
  "verbatim",
  "endverbatim",
  "once",
  "endonce",
  "production",
  "endproduction",
  "env",
  "endenv",
  "dump",
  "dd",
  "class",
  "style",
  "checked",
  "selected",
  "disabled",
  "readonly",
  "required",
];

/**
 * Directives whose first string-literal argument names a Blade view. Used for
 * "go to view" navigation.
 */
const VIEW_DIRECTIVES_FIRST_ARG: ReadonlySet<string> = new Set([
  "include",
  "includeIf",
  "includeFirst",
  "each",
  "component",
  "extends",
]);

/**
 * Directives whose SECOND string-literal argument names a Blade view (the first
 * argument is a condition). The view literal is the first STRING literal that
 * follows the condition, so detection allows it at literal index 0 or 1.
 */
const VIEW_DIRECTIVES_CONDITIONAL: ReadonlySet<string> = new Set([
  "includeWhen",
  "includeUnless",
]);

const SECTION_DIRECTIVES: ReadonlySet<string> = new Set(["yield", "section"]);

const STACK_DIRECTIVES: ReadonlySet<string> = new Set(["push", "stack", "prepend"]);

interface StringLiteral {
  quote: "'" | "\"";
  /** Offset of the opening quote. */
  quoteStart: number;
  /** Offset of the closing quote (or `source.length` when unclosed). */
  quoteEnd: number;
  value: string;
}

/**
 * Returns the navigable Blade reference at `offset`, or `null` when the offset
 * is not on a recognised construct.
 */
export function detectBladeReferenceAt(
  source: string,
  offset: number,
): BladeReference | null {
  const componentReference = componentReferenceAt(source, offset);

  if (componentReference) {
    return componentReference;
  }

  return directiveReferenceAt(source, offset);
}

/**
 * Returns the directive being typed after `@` at `offset` (for completion), or
 * `null` when the offset is not at a directive position.
 */
export function detectBladeDirectiveCompletionAt(
  source: string,
  offset: number,
): BladeDirectiveCompletion | null {
  if (offset < 1 || offset > source.length) {
    return null;
  }

  if (isInsideBladeComment(source, offset)) {
    return null;
  }

  const atOffset = directiveAtSignBefore(source, offset);

  if (atOffset === null) {
    return null;
  }

  const directivePrefix = source.slice(atOffset + 1, offset);

  return { directivePrefix, start: atOffset };
}

/**
 * Maps a Blade view name to its candidate blade file paths, reusing the shared
 * Laravel view resolver so view-path logic lives in one place.
 */
export function bladeViewCandidateRelativePaths(name: string): string[] {
  return resolveLaravelViewTarget(name)?.relativeFilePaths ?? [];
}

/**
 * Maps an `<x-...>` / `@component` component name to its candidate blade file
 * paths under `resources/views/components` (anonymous components). Class-based
 * component targets are produced separately by `bladeComponentClassCandidatePaths`.
 */
export function bladeComponentCandidateRelativePaths(name: string): string[] {
  if (!isUsableName(name)) {
    return [];
  }

  const relativePath = name.split(".").join("/");

  return [
    `resources/views/components/${relativePath}.blade.php`,
    `resources/views/components/${relativePath}/index.blade.php`,
  ];
}

/**
 * Maps an `<x-...>` / `@component` component name to its candidate class-based
 * component PHP paths under `app/View/Components` (Laravel 11+ convention).
 *
 * Each dotted segment becomes a directory and the final segment the class file;
 * every segment is PascalCased (kebab-case `my-alert` → `MyAlert`,
 * `forms.text-input` → `Forms/TextInput`). Stays CONSERVATIVE: an unusable name
 * (blank, namespaced, dot-edged, double-dotted) resolves to `[]`.
 */
export function bladeComponentClassCandidatePaths(name: string): string[] {
  if (!isUsableName(name)) {
    return [];
  }

  const classPath = name.split(".").map(pascalCaseSegment).join("/");

  return [`app/View/Components/${classPath}.php`];
}

/**
 * Converts a single component-name segment to PascalCase, splitting on hyphens
 * and underscores (`text-input` / `text_input` → `TextInput`).
 */
function pascalCaseSegment(segment: string): string {
  return segment
    .split(/[-_]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * Detects an `<x-name ...>` / `</x-name>` component tag whose name spans
 * `offset`. The `x-` prefix is stripped; the remaining dotted name is returned.
 */
function componentReferenceAt(
  source: string,
  offset: number,
): BladeReference | null {
  if (isInsideBladeComment(source, offset)) {
    return null;
  }

  const tagPrefix = "x-";
  const searchStart = Math.max(0, offset - 200);
  const openAngle = lastTagOpenBefore(source, offset, searchStart);

  if (openAngle === null) {
    return null;
  }

  const nameStart = componentNameStartAfter(source, openAngle);

  if (nameStart === null) {
    return null;
  }

  if (!source.startsWith(tagPrefix, nameStart)) {
    return null;
  }

  const componentNameStart = nameStart + tagPrefix.length;
  const nameEnd = componentNameEnd(source, componentNameStart);
  const name = source.slice(componentNameStart, nameEnd);

  // The trailing boundary is inclusive (`offset <= nameEnd`): a cursor sitting
  // immediately after the last name character is still "on" the name, matching
  // editor go-to-definition cursor semantics and the directive-literal path.
  if (offset < componentNameStart || offset > nameEnd) {
    return null;
  }

  if (!isUsableName(name)) {
    return null;
  }

  return { kind: "component", name, nameStart: componentNameStart, nameEnd };
}

/**
 * Detects a `@directive('literal')` reference whose literal spans `offset` and
 * maps it to a view / section / stack reference per the directive's role.
 */
function directiveReferenceAt(
  source: string,
  offset: number,
): BladeReference | null {
  const literal = enclosingStringLiteral(source, offset);

  if (!literal) {
    return null;
  }

  if (isInsideBladeComment(source, literal.quoteStart)) {
    return null;
  }

  const call = directiveCallContaining(source, literal.quoteStart);

  if (!call) {
    return null;
  }

  const kind = referenceKindForDirective(call.directive, call.literalIndex);

  if (!kind) {
    return null;
  }

  if (!isUsableName(literal.value)) {
    return null;
  }

  return {
    kind,
    name: literal.value,
    nameStart: literal.quoteStart + 1,
    nameEnd: literal.quoteEnd,
  };
}

interface DirectiveCall {
  directive: string;
  /** Zero-based index of the literal among the call's string literals. */
  literalIndex: number;
}

/**
 * Returns the directive whose argument list contains the literal starting at
 * `quoteStart`, plus the literal's index among the string literals in that
 * call, or `null` when the literal is not the argument of a `@directive(...)`.
 */
function directiveCallContaining(
  source: string,
  quoteStart: number,
): DirectiveCall | null {
  const openParen = source.lastIndexOf("(", quoteStart);

  if (openParen < 0) {
    return null;
  }

  const directive = directiveNameBefore(source, openParen);

  if (!directive) {
    return null;
  }

  const literalIndex = stringLiteralIndexBefore(source, openParen, quoteStart);

  if (literalIndex === null) {
    return null;
  }

  return { directive, literalIndex };
}

/**
 * Returns the directive name immediately preceding the `(` at `openParen`
 * (`@name(`), or `null` when the `(` is not a directive call.
 */
function directiveNameBefore(source: string, openParen: number): string | null {
  const before = source.slice(0, openParen);
  const match = /@([A-Za-z][A-Za-z0-9_]*)\s*$/.exec(before);

  return match?.[1] ?? null;
}

/**
 * Returns the index of the literal at `quoteStart` among the top-level string
 * literals between `openParen` and `quoteStart`, or `null` when the literal is
 * not a top-level argument (i.e. it sits inside a nested bracket).
 */
function stringLiteralIndexBefore(
  source: string,
  openParen: number,
  quoteStart: number,
): number | null {
  let index = openParen + 1;
  let depth = 0;
  let literalIndex = 0;

  while (index < quoteStart) {
    const character = source[index] ?? "";

    if (character === "'" || character === "\"") {
      const end = stringLiteralEnd(source, index);

      if (end >= quoteStart) {
        return null;
      }

      index = end + 1;
      literalIndex += 1;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      index += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      if (depth === 0) {
        return null;
      }

      depth -= 1;
      index += 1;
      continue;
    }

    index += 1;
  }

  return depth === 0 ? literalIndex : null;
}

function referenceKindForDirective(
  directive: string,
  literalIndex: number,
): BladeReferenceKind | null {
  if (VIEW_DIRECTIVES_FIRST_ARG.has(directive) && literalIndex === 0) {
    return "view";
  }

  if (VIEW_DIRECTIVES_CONDITIONAL.has(directive) && literalIndex <= 1) {
    return "view";
  }

  if (SECTION_DIRECTIVES.has(directive) && literalIndex === 0) {
    return "section";
  }

  if (STACK_DIRECTIVES.has(directive) && literalIndex === 0) {
    return "stack";
  }

  return null;
}

/**
 * Returns the string literal that contains `offset`, or `null` when `offset` is
 * not inside one. Scans the whole source so quote nesting is tracked correctly.
 */
function enclosingStringLiteral(
  source: string,
  offset: number,
): StringLiteral | null {
  let index = 0;

  while (index < source.length) {
    const character = source[index] ?? "";

    if (character !== "'" && character !== "\"") {
      index += 1;
      continue;
    }

    const end = stringLiteralEnd(source, index);
    const closed = end < source.length;
    const quoteEnd = closed ? end : source.length;

    if (offset > index && offset <= quoteEnd) {
      return {
        quote: character as "'" | "\"",
        quoteStart: index,
        quoteEnd,
        value: source.slice(index + 1, quoteEnd),
      };
    }

    index = end + 1;
  }

  return null;
}

/**
 * Returns the offset of the closing quote of the string literal that opens at
 * `quoteStart`, or `source.length` when the literal is unclosed.
 */
function stringLiteralEnd(source: string, quoteStart: number): number {
  const quote = source[quoteStart];

  for (let index = quoteStart + 1; index < source.length; index += 1) {
    const character = source[index];

    if (character === "\\") {
      index += 1;
      continue;
    }

    if (character === quote) {
      return index;
    }
  }

  return source.length;
}

/**
 * Returns the offset of the `<` (or `</`) that opens the most recent tag before
 * `offset`, or `null` when there is no open tag context (the search hit `>` or
 * the window start first).
 */
function lastTagOpenBefore(
  source: string,
  offset: number,
  searchStart: number,
): number | null {
  for (let index = offset - 1; index >= searchStart; index -= 1) {
    const character = source[index];

    if (character === ">") {
      return null;
    }

    if (character === "<") {
      return index;
    }
  }

  return null;
}

/**
 * Returns the offset of the first tag-name character after the `<` at
 * `openAngle`, skipping a leading `/` for closing tags, or `null` when there is
 * no name.
 */
function componentNameStartAfter(
  source: string,
  openAngle: number,
): number | null {
  let index = openAngle + 1;

  if (source[index] === "/") {
    index += 1;
  }

  return index < source.length ? index : null;
}

/**
 * Returns the offset one past the last character of a component name (dotted
 * identifier with hyphens) starting at `nameStart`.
 */
function componentNameEnd(source: string, nameStart: number): number {
  let index = nameStart;

  while (index < source.length && /[A-Za-z0-9_.-]/.test(source[index] ?? "")) {
    index += 1;
  }

  return index;
}

/**
 * Returns the offset of the `@` that begins the directive ending at `offset`,
 * or `null` when the characters before `offset` are not a directive being typed
 * (the `@` must be at a word boundary so emails like `user@x` are ignored).
 */
function directiveAtSignBefore(source: string, offset: number): number | null {
  let index = offset - 1;

  while (index >= 0 && /[A-Za-z0-9_]/.test(source[index] ?? "")) {
    index -= 1;
  }

  if (source[index] !== "@") {
    return null;
  }

  const before = source[index - 1] ?? "";

  if (before !== "" && /[A-Za-z0-9_]/.test(before)) {
    return null;
  }

  return index;
}

/**
 * Returns true when `offset` lies inside a Blade comment `{{-- ... --}}`.
 */
function isInsideBladeComment(source: string, offset: number): boolean {
  const open = "{{--";
  const close = "--}}";

  for (
    let start = source.indexOf(open);
    start >= 0 && start < offset;
    start = source.indexOf(open, start + open.length)
  ) {
    const end = source.indexOf(close, start + open.length);
    const commentEnd = end < 0 ? source.length : end + close.length;

    if (offset > start && offset < commentEnd) {
      return true;
    }
  }

  return false;
}

function isUsableName(name: string): boolean {
  return (
    name.length > 0 &&
    !name.includes("::") &&
    /^[A-Za-z0-9_.-]+$/.test(name) &&
    !name.startsWith(".") &&
    !name.endsWith(".") &&
    !name.includes("..")
  );
}
