const encoder = new TextEncoder();
const MAX_WIRE_PATH_BYTES = 4_096;
const OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

export function wireRecord(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(path, "an object");
  }
  return value as Readonly<Record<string, unknown>>;
}

export function wireExactRecord(
  value: unknown,
  keys: ReadonlyArray<string>,
  path: string,
): Readonly<Record<string, unknown>> {
  const record = wireRecord(value, path);
  const actual = Object.keys(record);
  const exact =
    actual.length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(record, key));
  if (!exact) {
    return invalid(path, `exactly the keys ${keys.join(", ")}`);
  }
  return record;
}

export function wireString(value: unknown, path: string, maxBytes: number): string {
  if (typeof value !== "string" || encoder.encode(value).length > maxBytes) {
    return invalid(path, `a string of at most ${maxBytes} bytes`);
  }
  return value;
}

export function wireNullableString(value: unknown, path: string, maxBytes: number): string | null {
  if (value === null) {
    return null;
  }
  return wireString(value, path, maxBytes);
}

export function wireCount(value: unknown, path: string, maximum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > maximum) {
    return invalid(path, `an integer between 0 and ${maximum}`);
  }
  return value;
}

export function wireNullableCount(value: unknown, path: string, maximum: number): number | null {
  if (value === null) {
    return null;
  }
  return wireCount(value, path, maximum);
}

export function wireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    return invalid(path, "a boolean");
  }
  return value;
}

export function wireArray(value: unknown, path: string, maxItems: number): ReadonlyArray<unknown> {
  if (!Array.isArray(value) || value.length > maxItems) {
    return invalid(path, `an array of at most ${maxItems} items`);
  }
  return value;
}

export function wireStringArray(
  value: unknown,
  path: string,
  maxItems: number,
  maxBytes: number,
): ReadonlyArray<string> {
  return wireArray(value, path, maxItems).map((item, index) =>
    wireString(item, `${path}[${index}]`, maxBytes),
  );
}

export function wireEnum<T extends string>(
  value: unknown,
  path: string,
  allowed: ReadonlyArray<T>,
): T {
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) {
    return invalid(path, `one of ${allowed.join(", ")}`);
  }
  return match;
}

export function wireAbsolutePath(value: unknown, path: string): string {
  const text = wireString(value, path, MAX_WIRE_PATH_BYTES);
  if (!text.startsWith("/") || hasControlCharacter(text)) {
    return invalid(path, "an absolute path");
  }
  return text;
}

export function wireRelativePath(value: unknown, path: string): string {
  const text = wireString(value, path, MAX_WIRE_PATH_BYTES);
  const escapes = text
    .split("/")
    .some((segment) => segment === "" || segment === "." || segment === "..");
  if (text.length === 0 || text.startsWith("/") || hasControlCharacter(text) || escapes) {
    return invalid(path, "a repository-relative path");
  }
  return text;
}

export function wireObjectId(value: unknown, path: string): string {
  const text = wireString(value, path, 64);
  if (!OBJECT_ID_PATTERN.test(text)) {
    return invalid(path, "a git object id");
  }
  return text;
}

export function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      return true;
    }
  }
  return false;
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(`Invalid ${path}: expected ${expectation}.`);
}
