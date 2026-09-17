/** An authoritative rejection proves that the continuation command was not accepted. */
export class RemoteRunnerRequestRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteRunnerRequestRejectedError";
  }
}
export function isRemoteRunnerRequestRejectedError(
  error: unknown,
): error is RemoteRunnerRequestRejectedError {
  return error instanceof RemoteRunnerRequestRejectedError;
}

export function remoteRunnerErrorMessage(error: unknown, fallback: string): string {
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  return message.length > 0 && message.length <= 1000 ? message : fallback;
}
