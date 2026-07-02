/**
 * Blade wiring for the Laravel global string-helper completion contexts
 * (`route()`, `config()`, `trans()` / `__()`) that already exist for plain PHP
 * files (`phpLaravelNamedRouteReferenceContextAt`,
 * `phpLaravelConfigReferenceContextAt`, `phpLaravelTranslationReferenceContextAt`).
 *
 * Those detectors are pure text/offset scanners with no `<?php` tag dependency
 * (they only track quotes/comments), so they already work unchanged on Blade
 * source — a `{{ route('users.') }}` echo or a `@if(config('app.'))` directive
 * argument is indistinguishable from the PHP-file case from their point of view.
 * This module is the single place that composes them for Blade so the Blade
 * completion/navigation wiring does not duplicate the detection logic.
 *
 * Stays CONSERVATIVE by construction: it inherits every guard the PHP detectors
 * already apply (closed-literal only, first-argument only, no interpolation,
 * global-call-only), so a dynamic key (`route($name)`) or unrelated call never
 * matches.
 *
 * One Blade-specific wrinkle the PHP-file case never hits: `{{ route(...) }}`
 * commonly sits inside a double-quoted HTML attribute (`href="{{ route(...)
 * }}"`, verified against a real generated Blade view). The reference scanners
 * track quote balance over the WHOLE input with no notion of HTML vs. PHP, so
 * that outer `"` would otherwise swallow the inner literal. Detection is scoped
 * to the innermost `{{ }}` / `{!! !!}` echo around the cursor first (falling
 * back to the whole source for directive arguments like `@if(config(...))`,
 * which have no such surrounding HTML-quote ambiguity) so the outer HTML quote
 * never reaches the scanner.
 */

import type { EditorPosition } from "./languageServerFeatures";
import { phpLaravelNamedRouteReferenceContextAt } from "./phpLaravelRoutes";
import { phpLaravelConfigReferenceContextAt } from "./phpLaravelConfig";
import { phpLaravelTranslationReferenceContextAt } from "./phpLaravelTranslations";
import {
  detectLaravelStringLiteralHelper,
  type LaravelStringLiteralHelperMatch,
} from "./laravelStringLiteralHelpers";

export type BladeLaravelHelperCompletionContext =
  | { kind: "route"; prefix: string }
  | { kind: "config"; prefix: string }
  | { kind: "trans"; prefix: string };

interface BladeEchoSpan {
  /** Offset of the first character after the opening `{{` / `{!!`. */
  contentStart: number;
  /** Offset of the character introducing the closing `}}` / `!!}` (or source.length). */
  contentEnd: number;
}

/**
 * Returns the Laravel helper string-literal context at `position` in Blade
 * `source`, or `null` when the position is not inside a recognised
 * `route()` / `config()` / `trans()` / `__()` first-argument literal.
 */
export function bladeLaravelHelperCompletionContextAt(
  source: string,
  position: EditorPosition,
): BladeLaravelHelperCompletionContext | null {
  const offset = offsetAtPosition(source, position);
  const echoSpan = innermostBladeEchoSpanAt(source, offset);

  if (!echoSpan) {
    return bladeLaravelHelperContextFromScannerInput(source, offset);
  }

  const echoSource = source.slice(echoSpan.contentStart, echoSpan.contentEnd);
  const echoOffset = offset - echoSpan.contentStart;

  return bladeLaravelHelperContextFromScannerInput(echoSource, echoOffset);
}

/**
 * Blade wiring for Cmd+B / go-to-definition on `view()`, `route()`,
 * `config()`, `trans()` / `__()` string literals — the navigation counterpart
 * of {@link bladeLaravelHelperCompletionContextAt}. Wraps
 * `detectLaravelStringLiteralHelper` (already used for the PHP-file Cmd+B
 * path) with the same innermost-`{{ }}`-echo scoping so a helper call nested
 * inside a double-quoted HTML attribute resolves correctly.
 */
export function bladeLaravelStringLiteralHelperAt(
  source: string,
  offset: number,
): LaravelStringLiteralHelperMatch | null {
  const echoSpan = innermostBladeEchoSpanAt(source, offset);

  if (!echoSpan) {
    return detectLaravelStringLiteralHelper(source, offset);
  }

  const echoSource = source.slice(echoSpan.contentStart, echoSpan.contentEnd);
  const echoOffset = offset - echoSpan.contentStart;
  const match = detectLaravelStringLiteralHelper(echoSource, echoOffset);

  if (!match) {
    return null;
  }

  return {
    ...match,
    literalEnd: echoSpan.contentStart + match.literalEnd,
    literalStart: echoSpan.contentStart + match.literalStart,
  };
}

/**
 * Runs the three PHP reference-context scanners against `source` at the given
 * 0-based `offset`, converting to/from the `EditorPosition` shape the scanners
 * require. Kept offset-based at this module's boundary so callers never have
 * to reason about line/column math themselves.
 */
function bladeLaravelHelperContextFromScannerInput(
  source: string,
  offset: number,
): BladeLaravelHelperCompletionContext | null {
  const position = positionAtOffset(source, offset);
  const route = phpLaravelNamedRouteReferenceContextAt(source, position);

  if (route) {
    return { kind: "route", prefix: route.prefix };
  }

  const translation = phpLaravelTranslationReferenceContextAt(source, position);

  if (translation) {
    return { kind: "trans", prefix: translation.prefix };
  }

  const config = phpLaravelConfigReferenceContextAt(source, position);

  if (config) {
    return { kind: "config", prefix: config.prefix };
  }

  return null;
}

/**
 * Returns the innermost `{{ ... }}` / `{!! ... !!}` echo span whose content
 * range contains `offset`, or `null` when `offset` is not inside one. Scans
 * back to the nearest unclosed opener and forward to its matching closer (or
 * source end), so it stays correct without needing full Blade parsing.
 */
function innermostBladeEchoSpanAt(
  source: string,
  offset: number,
): BladeEchoSpan | null {
  let bestSpan: BladeEchoSpan | null = null;

  for (const [open, close] of [
    ["{{", "}}"],
    ["{!!", "!!}"],
  ] as const) {
    // Explicit `searchFrom` bound rather than feeding the previous match
    // index straight back into `lastIndexOf`: once a match lands at offset 0,
    // `lastIndexOf(open, 0 - 1)` is `lastIndexOf(open, -1)`, which JS clamps
    // to `lastIndexOf(open, 0)` instead of stopping the scan, so the loop
    // would re-find offset 0 forever whenever an echo opener starts the
    // document and the cursor sits outside it.
    for (let searchFrom = offset - 1; searchFrom >= 0; ) {
      const openIndex = source.lastIndexOf(open, searchFrom);

      if (openIndex < 0) {
        break;
      }

      const contentStart = openIndex + open.length;
      const closeIndex = source.indexOf(close, contentStart);
      const contentEnd = closeIndex < 0 ? source.length : closeIndex;

      if (offset >= contentStart && offset <= contentEnd) {
        if (!bestSpan || contentStart > bestSpan.contentStart) {
          bestSpan = { contentEnd, contentStart };
        }

        break;
      }

      searchFrom = openIndex - 1;
    }
  }

  return bestSpan;
}

function offsetAtPosition(source: string, position: EditorPosition): number {
  let column = 1;
  let line = 1;

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

function positionAtOffset(source: string, offset: number): EditorPosition {
  const clamped = Math.max(0, Math.min(offset, source.length));
  let lineNumber = 1;
  let lineStart = 0;

  for (let index = 0; index < clamped; index += 1) {
    if (source[index] === "\n") {
      lineNumber += 1;
      lineStart = index + 1;
    }
  }

  return { column: clamped - lineStart + 1, lineNumber };
}
