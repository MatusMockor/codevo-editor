export const WORKSPACE_DIRECTORY_BUSY_MESSAGE = "This folder is busy. Retry in a moment.";
export const WORKSPACE_DIRECTORY_TIMEOUT_MESSAGE =
  "This folder took too long to load. Retry to try again.";

const WORKSPACE_DIRECTORY_BUSY_PREFIX = "workspace_directory_busy:";

export function isWorkspaceDirectoryBusyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().startsWith(WORKSPACE_DIRECTORY_BUSY_PREFIX);
}
