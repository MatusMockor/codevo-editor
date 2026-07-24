export const PHP_CLOVER_COVERAGE_IPC_COMMAND = "run_php_test_coverage_clover";
export const MAX_PHP_CLOVER_COVERAGE_IPC_BYTES = 8 * 1024 * 1024;
export const MAX_PHP_CLOVER_COVERAGE_IPC_MESSAGE_BYTES = 64 * 1024;

export type PhpCloverCoverageWireResponse =
  | { readonly status: "ok"; readonly content: string }
  | { readonly status: "missing" }
  | { readonly status: "tooLarge" }
  | { readonly status: "unavailable"; readonly message: string }
  | { readonly status: "error"; readonly message: string };

export function decodePhpCloverCoverageWireResponse(value: unknown): PhpCloverCoverageWireResponse {
  const response = record(value, "response");
  if (response.status === "ok") {
    exactKeys(response, ["status", "content"], "response");
    return {
      status: "ok",
      content: boundedUtf8String(
        response.content,
        "response.content",
        MAX_PHP_CLOVER_COVERAGE_IPC_BYTES,
        false,
      ),
    };
  }
  if (response.status === "missing" || response.status === "tooLarge") {
    exactKeys(response, ["status"], "response");
    return { status: response.status };
  }
  if (response.status === "unavailable" || response.status === "error") {
    exactKeys(response, ["status", "message"], "response");
    return {
      status: response.status,
      message: boundedUtf8String(
        response.message,
        "response.message",
        MAX_PHP_CLOVER_COVERAGE_IPC_MESSAGE_BYTES,
        true,
      ),
    };
  }
  return invalid("response.status", '"ok", "missing", "tooLarge", "unavailable", or "error"');
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(path, "an object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalid(path, "a plain object");
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      return invalid(path, "a plain data object with string keys");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      return invalid(`${path}.${key}`, "a data property");
    }
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const unexpected = Object.keys(value).find((key) => !expected.includes(key));
  if (unexpected) invalid(`${path}.${unexpected}`, "no unknown field");
  const missing = expected.find((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (missing) invalid(`${path}.${missing}`, "a required field");
}

function boundedUtf8String(
  value: unknown,
  path: string,
  maxBytes: number,
  controlFree: boolean,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !hasOnlyUnicodeScalars(value) ||
    (controlFree && hasControlCharacter(value)) ||
    new TextEncoder().encode(value).byteLength > maxBytes
  ) {
    return invalid(
      path,
      `a non-empty${controlFree ? " control-free" : ""} UTF-8 string of at most ${maxBytes} bytes`,
    );
  }
  return value;
}

function hasOnlyUnicodeScalars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0xd800 || code > 0xdfff) continue;
    if (code > 0xdbff || index + 1 >= value.length) return false;
    const low = value.charCodeAt(++index);
    if (low < 0xdc00 || low > 0xdfff) return false;
  }
  return true;
}

function hasControlCharacter(value: string): boolean {
  return /[\x00-\x1f\x7f]/.test(value);
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(`Invalid PHP Clover coverage response at ${path}: expected ${expectation}.`);
}
