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
