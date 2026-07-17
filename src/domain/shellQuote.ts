// Any C0 control character (u0000-u001f), plus DEL (u007f). This covers newline,
// carriage return and tab. A description containing any of these is rejected
// rather than quoted.
export const CONTROL_CHARACTER_PATTERN = new RegExp("[\\u0000-\\u001f\\u007f]");

// Wraps a free-form description in POSIX single quotes, escaping embedded
// single quotes with the `'\''` idiom. Returns `null` when the description is
// empty or contains a control character (newline / CR / tab / etc.), which
// cannot be made safe by quoting and must never reach the terminal.
export function shellQuoteFilter(filter: string): string | null {
  if (filter.length === 0) {
    return null;
  }

  if (CONTROL_CHARACTER_PATTERN.test(filter)) {
    return null;
  }

  const escaped = filter.replace(/'/g, "'\\''");

  return `'${escaped}'`;
}
