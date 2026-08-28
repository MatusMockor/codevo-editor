export const MAX_MANAGED_LANGUAGE_SERVER_INSTALL_ROOT_PATH_UTF8_BYTES = 32_768;
export const MAX_MANAGED_LANGUAGE_SERVER_INSTALL_WORKSPACE_ID_UTF8_BYTES = 1_024;
export const MAX_MANAGED_LANGUAGE_SERVER_INSTALL_ERROR_UTF8_BYTES = 4_096;

const utf8Encoder = new TextEncoder();

export interface ManagedLanguageServerInstallRequest {
  readonly rootPath: string;
  readonly workspaceId: string;
  readonly admissionToken: number;
}

export interface ManagedLanguageServerInstallCompletionEvent extends ManagedLanguageServerInstallRequest {
  readonly error: string | null;
}

export function parseManagedLanguageServerInstallRequest(
  value: unknown,
): ManagedLanguageServerInstallRequest {
  const request = strictRecord(value, "managed language server install request");
  assertExactKeys(
    request,
    ["admissionToken", "rootPath", "workspaceId"],
    "managed language server install request",
  );
  const rootPath = cleanBoundedString(
    request.rootPath,
    MAX_MANAGED_LANGUAGE_SERVER_INSTALL_ROOT_PATH_UTF8_BYTES,
    "Managed language server install root path",
  );
  if (!isAbsoluteLocalPath(rootPath)) {
    throw new TypeError("Managed language server install root path must be absolute.");
  }
  return {
    admissionToken: positiveSafeInteger(
      request.admissionToken,
      "Managed language server install admission token",
    ),
    rootPath,
    workspaceId: cleanBoundedString(
      request.workspaceId,
      MAX_MANAGED_LANGUAGE_SERVER_INSTALL_WORKSPACE_ID_UTF8_BYTES,
      "Managed language server install workspace id",
    ),
  };
}

export function parseManagedLanguageServerInstallCompletionEvent(
  value: unknown,
): ManagedLanguageServerInstallCompletionEvent {
  const event = strictRecord(value, "managed language server install completion event");
  assertExactKeys(
    event,
    ["admissionToken", "error", "rootPath", "workspaceId"],
    "managed language server install completion event",
  );
  const request = parseManagedLanguageServerInstallRequest({
    admissionToken: event.admissionToken,
    rootPath: event.rootPath,
    workspaceId: event.workspaceId,
  });
  return {
    ...request,
    error:
      event.error === null
        ? null
        : cleanBoundedString(
            event.error,
            MAX_MANAGED_LANGUAGE_SERVER_INSTALL_ERROR_UTF8_BYTES,
            "Managed language server install error",
          ),
  };
}

function isAbsoluteLocalPath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

function strictRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const keys = Object.keys(value);
  if (keys.length === expected.length && keys.every((key) => expected.includes(key))) {
    return;
  }
  throw new TypeError(`${label} must use the exact wire contract.`);
}

function positiveSafeInteger(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  throw new TypeError(`${label} is invalid.`);
}

function cleanBoundedString(value: unknown, maxUtf8Bytes: number, label: string): string {
  if (
    typeof value === "string" &&
    value.length > 0 &&
    value.trim() === value &&
    !/\p{Cc}/u.test(value) &&
    utf8Encoder.encode(value).byteLength <= maxUtf8Bytes
  ) {
    return value;
  }
  throw new TypeError(`${label} is invalid.`);
}
