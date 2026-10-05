import type { RemoteRunnerGateway } from "../domain/remoteRunner";
import type { RemoteThreadMetadataPatch } from "../domain/remoteThreadMetadata";
import { remoteRunnerErrorMessage } from "../domain/remoteRunnerErrors";
import { viewedOnlyChange } from "./serverThreadMetadataLease";

export type ServerThreadMetadataChange = Omit<RemoteThreadMetadataPatch, "expectedRevision">;
const CONFLICT = "Runner request failed (HTTP 409).";
const MAX_VIEWED_ATTEMPTS = 3;

export async function saveServerThreadMetadata({
  gateway,
  serverId,
  taskId,
  change,
  legacyChange,
  active,
}: {
  readonly gateway: Required<
    Pick<RemoteRunnerGateway, "getThreadMetadata" | "updateThreadMetadata">
  >;
  readonly serverId: string;
  readonly taskId: string;
  readonly change: ServerThreadMetadataChange;
  readonly legacyChange: () => ServerThreadMetadataChange;
  readonly active: () => boolean;
}): Promise<"saved" | "current" | "stale"> {
  const viewed = viewedOnlyChange(change);
  for (let attempt = 0; attempt < MAX_VIEWED_ATTEMPTS; attempt += 1) {
    if (!active()) return "stale";
    const current = await gateway.getThreadMetadata({ serverId, taskId });
    if (!active()) return "stale";
    if (viewed !== null && (current.viewedAtEpochMs ?? -1) >= viewed) return "current";
    try {
      await gateway.updateThreadMetadata({
        serverId,
        taskId,
        patch: {
          ...(current.revision === 0 ? legacyChange() : {}),
          ...change,
          expectedRevision: current.revision,
        },
      });
      return active() ? "saved" : "stale";
    } catch (error) {
      if (!active()) return "stale";
      // Only an automatic, monotonic read marker may be rebased on another client's edit.
      // Explicit preferences keep CAS semantics; uncertain network writes are never replayed.
      if (
        viewed === null ||
        remoteRunnerErrorMessage(error, "") !== CONFLICT ||
        attempt === MAX_VIEWED_ATTEMPTS - 1
      )
        throw error;
    }
  }
  return "stale";
}

export function serverThreadMetadataSaveError(error: unknown, viewed: boolean): string {
  const prefix = viewed ? "The conversation read status" : "The conversation change";
  const message = remoteRunnerErrorMessage(error, "");
  if (message === CONFLICT)
    return `${viewed ? prefix : "This conversation"} changed on another device before it could be saved. Refresh and try again.`;
  if (message === "Runner request failed (HTTP 429).")
    return `${prefix} could not be saved because a server limit was reached.`;
  if (message === "Runner request failed (HTTP 503).")
    return `${prefix} could not be saved because the server is temporarily unavailable. Try again shortly.`;
  if (message === "Runner request failed (HTTP 404).")
    return `${prefix} could not be saved because this conversation is no longer available on the server. Refresh to load its current state.`;
  if (
    message === "Runner request failed (HTTP 400)." ||
    message ===
      "The server runner rejected this request as invalid (HTTP 400). If it is older than this editor, update the runner on the server."
  )
    return `${prefix} was rejected by the server. Update the server runner and refresh to try again.`;
  return `${prefix} could not be saved on the server. Refresh and try again.`;
}
