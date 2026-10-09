import type { RemoteRunnerEventPage, RemoteRunnerEventsBeforeRequest } from "./remoteRunner";

export const MAX_REMOTE_RUNNER_EVENT_PAGE_ITEMS = 50;

export type RemoteRunnerBackwardPageRejection =
  "oversized" | "foreignTask" | "unordered" | "notBefore" | "inconsistentCursor";

export function remoteRunnerBackwardPageRejection(
  page: RemoteRunnerEventPage,
  request: Pick<RemoteRunnerEventsBeforeRequest, "taskId" | "before">,
): RemoteRunnerBackwardPageRejection | null {
  if (page.items.length > MAX_REMOTE_RUNNER_EVENT_PAGE_ITEMS) return "oversized";
  if (page.items.some((event) => event.taskId !== request.taskId)) return "foreignTask";
  if (!strictlyAscending(page.items.map((event) => event.sequence))) return "unordered";
  if (page.items.some((event) => event.sequence >= request.before)) return "notBefore";
  if (page.nextCursor !== null && page.nextCursor !== page.items[0]?.sequence)
    return "inconsistentCursor";
  return null;
}

export function assertRemoteRunnerBackwardPage(
  page: RemoteRunnerEventPage,
  request: Pick<RemoteRunnerEventsBeforeRequest, "taskId" | "before">,
): void {
  const rejection = remoteRunnerBackwardPageRejection(page, request);
  if (rejection === null) return;
  throw new Error(`Invalid remote runner backward event page: ${rejection}.`);
}

function strictlyAscending(sequences: ReadonlyArray<number>): boolean {
  return sequences.every((sequence, index) => index === 0 || sequence > sequences[index - 1]!);
}
