const REQUEST_CANCELLED = -32800;
const CONTENT_MODIFIED = -32801;
const SERVER_CANCELLED = -32802;

const STALE_REQUEST_MESSAGES: readonly RegExp[] = [
  /^(?:Error:\s*)?Language server request(?: `[^`]+`)? was cancell?ed\.?$/i,
  /^(?:Error:\s*)?Language server request was stopped\.?$/i,
  /^(?:Error:\s*)?(?:Request cancelled|Request canceled|Content modified)\.?$/i,
];

interface LanguageServerErrorShape {
  code?: unknown;
  message?: unknown;
}

/**
 * Identifies LSP request outcomes that mean the response is no longer useful,
 * not that the language-server process failed. Standard LSP cancellation and
 * stale-content codes are accepted alongside the backend's string errors.
 */
export function isBenignLanguageServerRequestError(error: unknown): boolean {
  const shape = languageServerErrorShape(error);

  if (
    shape?.code === REQUEST_CANCELLED ||
    shape?.code === CONTENT_MODIFIED ||
    shape?.code === SERVER_CANCELLED
  ) {
    return true;
  }

  const message = languageServerRequestErrorMessage(error, shape);
  if (!message) {
    return false;
  }

  return STALE_REQUEST_MESSAGES.some((pattern) => pattern.test(message.trim()));
}

export function languageServerErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return String(error);
  }

  const shape = languageServerErrorShape(error);
  if (typeof shape?.message === "string") {
    return shape.message;
  }

  return String(error);
}

function languageServerErrorShape(
  error: unknown,
): LanguageServerErrorShape | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  return error as LanguageServerErrorShape;
}

function languageServerRequestErrorMessage(
  error: unknown,
  shape: LanguageServerErrorShape | null,
): string | null {
  if (typeof error === "string") {
    return error;
  }

  if (typeof shape?.message === "string") {
    return shape.message;
  }

  return null;
}
