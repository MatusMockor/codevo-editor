import { useSyncExternalStore } from "react";
import type { AgentProjectGroupingSettings } from "../domain/agentProjectGrouping";
import {
  readAgentProjectGrouping,
  readAgentProjectGroupingStorageState,
  subscribeAgentProjectGrouping,
  type AgentProjectGroupingStorageState,
} from "./agentProjectGroupingPreference";

export function useAgentProjectGrouping(): AgentProjectGroupingSettings {
  return useSyncExternalStore(
    subscribeAgentProjectGrouping,
    readAgentProjectGrouping,
    readAgentProjectGrouping,
  );
}

export function useAgentProjectGroupingStorageState(): AgentProjectGroupingStorageState {
  return useSyncExternalStore(
    subscribeAgentProjectGrouping,
    readAgentProjectGroupingStorageState,
    readAgentProjectGroupingStorageState,
  );
}
