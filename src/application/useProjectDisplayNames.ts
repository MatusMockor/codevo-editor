import { useSyncExternalStore } from "react";
import type { ProjectDisplayNameEntries } from "../domain/projectDisplayName";
import {
  readProjectDisplayNameEntries,
  readProjectDisplayNames,
  subscribeProjectDisplayNames,
} from "./projectDisplayNames";

export function useProjectDisplayNames(): ReadonlyMap<string, string> {
  return useSyncExternalStore(subscribeProjectDisplayNames, readProjectDisplayNames);
}

export function useProjectDisplayNameEntries(): ProjectDisplayNameEntries {
  return useSyncExternalStore(subscribeProjectDisplayNames, readProjectDisplayNameEntries);
}
