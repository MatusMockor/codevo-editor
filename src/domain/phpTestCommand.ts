/**
 * Pure builder for the shell command that runs a single PHP test (or a whole
 * test class) from the editor gutter. The command is always a STATIC prefix
 * concatenated with a strictly sanitized filter, so no value derived from file
 * content can introduce shell metacharacters - the only injection surface for a
 * "write this into the active terminal" feature.
 *
 * Two runners are supported:
 *  - `artisan`  -> `php artisan test --filter <name>` (Laravel default)
 *  - `phpunit`  -> `vendor/bin/phpunit --filter <name>`
 *
 * A `null` filter runs the whole suite/class (no `--filter`). A filter that
 * contains anything other than PHP identifier characters (`[A-Za-z0-9_]`) is
 * rejected outright: we never strip-and-run a partially valid name, because a
 * silently truncated filter could run the wrong tests.
 */

export type PhpTestRunner = "artisan" | "phpunit";

export interface PhpTestRunCommandInput {
  filter: string | null;
  runner: PhpTestRunner;
}

const FILTER_PATTERN = /^[A-Za-z0-9_]+$/;

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

export function phpTestRunCommand(input: PhpTestRunCommandInput): string | null {
  const prefix = RUNNER_PREFIX[input.runner];

  if (input.filter === null) {
    return prefix;
  }

  const safeFilter = sanitizePhpTestFilter(input.filter);

  if (!safeFilter) {
    return null;
  }

  return `${prefix} --filter ${safeFilter}`;
}
