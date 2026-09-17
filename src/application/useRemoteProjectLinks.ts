import { useSyncExternalStore } from "react";
import { readRemoteProjectLinks, subscribeRemoteProjectLinks } from "./remoteProjectLinks";

/** Display associations keyed by exact server/runner/project identity. */
export function useRemoteProjectLinks(): ReadonlyMap<string, string> {
  return useSyncExternalStore(subscribeRemoteProjectLinks, readRemoteProjectLinks);
}
