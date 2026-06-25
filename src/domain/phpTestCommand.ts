/**
 * Pure builder for the shell command that runs a single PHP test (or a whole
 * test class) from the editor gutter. The command is always a STATIC prefix
 * concatenated with a filter that is encoded for one of two match modes, so no
 * value derived from file content can introduce shell metacharacters - the only
 * injection surface for a "write this into the active terminal" feature.
 *
 * Two runners are supported:
 *  - `artisan`  -> `php artisan test --filter <name>` (Laravel default)
 *  - `phpunit`  -> `vendor/bin/phpunit --filter <name>`
 *
 * Two match modes are supported:
 *  - `identifier` (PHPUnit method / class targets). The filter must be a PHP
 *    identifier (`[A-Za-z0-9_]`) or it is rejected outright: we never
 *    strip-and-run a partially valid name, because a silently truncated filter
 *    could run the wrong tests.
 *  - `description` (Pest `it()` / `test()` targets). The filter is a free-form
 *    description (spaces, punctuation) that cannot pass an identifier allow-list.
 *    It is wrapped in POSIX single quotes so the shell treats every character as
 *    a literal: inside `'...'` there is no interpolation of `$`, backtick,
 *    `$(...)`, `;`, `&&`, `|`, etc. - the only character with special meaning is
 *    the single quote itself, which we escape with the standard `'\''` idiom
 *    (close quote, an escaped literal quote, reopen quote). A description that
 *    contains a newline or any other control character is rejected: a newline
 *    written into a terminal is an Enter keypress, which would terminate the
 *    quoted argument and start a new command line - the single real injection
 *    path through single-quoting. Control characters have no place in a Pest
 *    description, so rejecting them is both safe and conservative.
 *
 * A `null` filter runs the whole suite/class (no `--filter`).
 */

export type PhpTestRunner = "artisan" | "phpunit";

export type PhpTestFilterMatch = "identifier" | "description";

export interface PhpTestRunCommandInput {
  filter: string | null;
  match?: PhpTestFilterMatch;
  runner: PhpTestRunner;
}

const FILTER_PATTERN = /^[A-Za-z0-9_]+$/;

// Any C0 control character (\x00-\x1f), plus DEL (\x7f). This covers newline
// (\x0a), carriage return (\x0d) and tab (\x09). A description containing any of
// these is rejected rather than quoted.
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

const RUNNER_PREFIX: Record<PhpTestRunner, string> = {
  artisan: "php artisan test",
  phpunit: "vendor/bin/phpunit",
};

// Returns the filter unchanged when it is a safe PHP identifier, otherwise
// `null`. Rejecting (rather than stripping) guarantees the caller can only ever
// build a command from a value that survives a strict allow-list.
export function sanitizePhpTestFilter(filter: string): string | null {
  if (!FILTER_PATTERN.test(filter)) {
    return null;
  }

  return filter;
}

// Wraps a free-form Pest description in POSIX single quotes, escaping embedded
// single quotes with the `'\''` idiom. Returns `null` when the description is
// empty or contains a control character (newline / CR / tab / etc.), which
// cannot be made safe by quoting and must never reach the terminal.
export function shellQuotePhpTestFilter(filter: string): string | null {
  if (filter.length === 0) {
    return null;
  }

  if (CONTROL_CHARACTER_PATTERN.test(filter)) {
    return null;
  }

  const escaped = filter.replace(/'/g, "'\\''");

  return `'${escaped}'`;
}

export function phpTestRunCommand(input: PhpTestRunCommandInput): string | null {
  const prefix = RUNNER_PREFIX[input.runner];

  if (input.filter === null) {
    return prefix;
  }

  const safeFilter = encodeFilter(input.filter, input.match ?? "identifier");

  if (!safeFilter) {
    return null;
  }

  return `${prefix} --filter ${safeFilter}`;
}

function encodeFilter(
  filter: string,
  match: PhpTestFilterMatch,
): string | null {
  if (match === "description") {
    return shellQuotePhpTestFilter(filter);
  }

  return sanitizePhpTestFilter(filter);
}
