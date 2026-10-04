import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentRailWorkingSectionPreferencePort } from "../../application/agentRailWorkingSectionPreferencePort";
import type { AgentPendingInteraction } from "../../domain/agentPendingInteraction";
import {
  WORKING_SECTION_OFF,
  type AgentRailWorkingSection,
} from "../../domain/agentRailWorkingSection";
import {
  DEFAULT_AGENT_RAIL_WORKING_DISCLOSURE,
  agentRailRowStatus,
  agentRailToggledWorkingDisclosure,
  type AgentRailStatusLookup,
  type AgentRailWorkingDisclosure,
  type AgentRailWorkingSplit,
} from "./agentRailWorkingSection";
import { useAgentRailWorkingSection } from "./useAgentRailWorkingSection";

export interface AgentRailWorkingRail {
  readonly workingSection: AgentRailWorkingSection;
  readonly disclosure: AgentRailWorkingDisclosure;
  toggleDisclosure(): void;
  observeOrganizationClock(now: number | null): void;
}

export interface AgentRailWorkingRailController {
  readonly rail: AgentRailWorkingRail;
  readonly latestSplit: AgentRailWorkingSplit;
  observePendingInteractions(
    pendingInteractions: ReadonlyMap<string, AgentPendingInteraction>,
  ): void;
}

const NO_PENDING_INTERACTIONS: ReadonlyMap<string, AgentPendingInteraction> = new Map();

export const AGENT_RAIL_WORKING_RAIL_OFF: AgentRailWorkingRail = Object.freeze({
  workingSection: WORKING_SECTION_OFF,
  disclosure: DEFAULT_AGENT_RAIL_WORKING_DISCLOSURE,
  toggleDisclosure: () => undefined,
  observeOrganizationClock: () => undefined,
});

export function useAgentRailWorkingRail(
  preference: AgentRailWorkingSectionPreferencePort | null,
): AgentRailWorkingRailController {
  const { workingSection } = useAgentRailWorkingSection(preference);
  const [disclosure, setDisclosure] = useState<AgentRailWorkingDisclosure>(
    DEFAULT_AGENT_RAIL_WORKING_DISCLOSURE,
  );
  const pending = useRef(NO_PENDING_INTERACTIONS);
  const organizationClock = useRef<number | null>(null);
  const toggleDisclosure = useCallback(() => setDisclosure(agentRailToggledWorkingDisclosure), []);
  const observeOrganizationClock = useCallback((now: number | null) => {
    organizationClock.current = now;
  }, []);
  const observePendingInteractions = useCallback(
    (pendingInteractions: ReadonlyMap<string, AgentPendingInteraction>) => {
      pending.current = pendingInteractions;
    },
    [],
  );
  const latestStatusOf = useCallback<AgentRailStatusLookup>(
    (view) => agentRailRowStatus(view, pending.current),
    [],
  );
  const latestNow = useCallback(() => organizationClock.current ?? Date.now(), []);
  const rail = useMemo(
    () => ({ workingSection, disclosure, toggleDisclosure, observeOrganizationClock }),
    [disclosure, observeOrganizationClock, toggleDisclosure, workingSection],
  );
  const latestSplit = useMemo(
    () => ({ workingSection, disclosure, statusOf: latestStatusOf, now: latestNow }),
    [disclosure, latestNow, latestStatusOf, workingSection],
  );
  return useMemo(
    () => ({ rail, latestSplit, observePendingInteractions }),
    [latestSplit, observePendingInteractions, rail],
  );
}

export function useAgentRailWorkingPendingInteractions(
  controller: Pick<AgentRailWorkingRailController, "observePendingInteractions">,
  pendingInteractions: ReadonlyMap<string, AgentPendingInteraction>,
): void {
  const observe = controller.observePendingInteractions;
  useLayoutEffect(() => observe(pendingInteractions), [observe, pendingInteractions]);
}

export function useAgentRailOrganizationClock(
  rail: Pick<AgentRailWorkingRail, "observeOrganizationClock">,
  now: number,
): void {
  const observe = rail.observeOrganizationClock;
  useLayoutEffect(() => {
    observe(now);
    return () => observe(null);
  }, [now, observe]);
}
