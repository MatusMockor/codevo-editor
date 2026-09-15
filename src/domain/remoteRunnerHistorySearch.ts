import type {
  RemoteRunnerHistorySearchPage,
  RemoteRunnerHistorySearchRequest,
} from "./remoteRunner";

/** Relates a validated page to the exact request; never accept another project or cursor. */
export function validateRemoteHistorySearchPage(
  request: RemoteRunnerHistorySearchRequest,
  page: RemoteRunnerHistorySearchPage,
): void {
  const after = request.after ?? 0;
  const seen = new Set<string>();
  let previous = after;
  if (page.nextCursor !== null && page.nextCursor <= after) invalid();
  for (const match of page.items) {
    const key = `${match.taskId}:${match.role}`;
    if (
      match.taskSequence <= after ||
      match.taskSequence < previous ||
      (page.nextCursor !== null && match.taskSequence > page.nextCursor) ||
      (request.projectId !== undefined && match.projectId !== request.projectId) ||
      (match.role === "user" ? match.eventSequence !== null : match.eventSequence === null) ||
      seen.has(key)
    )
      invalid();
    seen.add(key);
    previous = match.taskSequence;
  }
}

function invalid(): never {
  throw new Error("Invalid remote runner searchHistory response.");
}
