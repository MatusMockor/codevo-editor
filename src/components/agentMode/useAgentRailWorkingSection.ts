import { useCallback, useMemo, useSyncExternalStore } from "react";
import type {
  AgentRailWorkingSectionPersistence,
  AgentRailWorkingSectionPreferencePort,
} from "../../application/agentRailWorkingSectionPreferencePort";
import {
  WORKING_SECTION_OFF,
  type AgentRailWorkingSection,
} from "../../domain/agentRailWorkingSection";

export interface AgentRailWorkingSectionState {
  readonly workingSection: AgentRailWorkingSection;
  readonly persistence: AgentRailWorkingSectionPersistence;
  setWorkingSection(workingSection: AgentRailWorkingSection): void;
}

const NO_SUBSCRIPTION = (): void => undefined;

export function useAgentRailWorkingSection(
  preference: AgentRailWorkingSectionPreferencePort | null,
): AgentRailWorkingSectionState {
  const subscribe = useCallback(
    (notify: () => void) => preference?.subscribe(notify) ?? NO_SUBSCRIPTION,
    [preference],
  );
  const load = useCallback(() => preference?.load() ?? WORKING_SECTION_OFF, [preference]);
  const loadPersistence = useCallback(
    (): AgentRailWorkingSectionPersistence => preference?.persistence() ?? "persisted",
    [preference],
  );
  const workingSection = useSyncExternalStore(subscribe, load, load);
  const persistence = useSyncExternalStore(subscribe, loadPersistence, loadPersistence);
  const setWorkingSection = useCallback(
    (next: AgentRailWorkingSection) => {
      if (preference === null || preference.load() === next) return;
      preference.save(next);
    },
    [preference],
  );
  return useMemo(
    () => ({ workingSection, persistence, setWorkingSection }),
    [persistence, setWorkingSection, workingSection],
  );
}
