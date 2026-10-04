import { useEffect, useMemo, useRef, useState } from "react";
import { MAX_AGENT_PROJECT_ROOTS, type AgentProjectDescriptor } from "../domain/agentProject";
import type { RemoteRepositoryIdentityGateway } from "../domain/remoteRepositoryIdentity";
import {
  ProjectRepositoryIdentityDiscovery,
  repositoryIdentityTargetId,
  type RepositoryIdentityOutcome,
  type RepositoryIdentityOutcomes,
  type RepositoryIdentityTarget,
} from "./projectRepositoryIdentityDiscovery";
import type { RepositoryIdentityGateway } from "./repositoryIdentityGateway";
import {
  SYSTEM_REPOSITORY_IDENTITY_TIMERS,
  type RepositoryIdentityTimers,
} from "./repositoryIdentityRetry";

type Select<V> = (outcome: RepositoryIdentityOutcome) => V | null;
type Published<V> = Readonly<{
  local: RepositoryIdentityGateway | null;
  remote: RemoteRepositoryIdentityGateway | null;
  values: ReadonlyMap<string, V>;
}>;

function sameEntries<V>(left: ReadonlyMap<string, V>, right: ReadonlyMap<string, V>): boolean {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [key, value] of left)
    if (!right.has(key) || !Object.is(right.get(key), value)) return false;
  return true;
}

function selected<V>(
  outcomes: RepositoryIdentityOutcomes,
  select: Select<V>,
): ReadonlyMap<string, V> {
  const values = new Map<string, V>();
  for (const [id, outcome] of outcomes) {
    const value = select(outcome);
    if (value !== null) values.set(id, value);
  }
  return values;
}

function republished<V>(previous: Published<V> | null, next: Published<V>): Published<V> {
  if (previous === null) return next;
  if (previous.local !== next.local || previous.remote !== next.remote) return next;
  return sameEntries(previous.values, next.values) ? previous : next;
}

function currentValues<V>(
  published: Published<V> | null,
  targets: readonly RepositoryIdentityTarget[],
  local: RepositoryIdentityGateway | null,
  remote: RemoteRepositoryIdentityGateway | null,
): ReadonlyMap<string, V> {
  const values = new Map<string, V>();
  if (published === null || published.local !== local || published.remote !== remote) return values;
  for (const target of targets) {
    const value = published.values.get(repositoryIdentityTargetId(target));
    if (value !== undefined) values.set(target.key, value);
  }
  return values;
}

function useContentStable<V>(next: ReadonlyMap<string, V>): ReadonlyMap<string, V> {
  const [held, setHeld] = useState(next);
  if (sameEntries(held, next)) return held;
  setHeld(next);
  return next;
}

function useDiscoveredValues<V>(
  candidates: readonly RepositoryIdentityTarget[],
  local: RepositoryIdentityGateway | null,
  remote: RemoteRepositoryIdentityGateway | null,
  timers: RepositoryIdentityTimers,
  select: Select<V>,
): ReadonlyMap<string, V> {
  const signature = JSON.stringify(
    candidates
      .slice(0, MAX_AGENT_PROJECT_ROOTS)
      .map(({ key, root, authority }) => ({ key, root, authority })),
  );
  const targets = useMemo(
    () => JSON.parse(signature) as readonly RepositoryIdentityTarget[],
    [signature],
  );
  const [published, setPublished] = useState<Published<V> | null>(null);
  const latest = useRef<Published<V> | null>(null);
  const [discovery] = useState(() => new ProjectRepositoryIdentityDiscovery(timers));
  useEffect(
    () =>
      discovery.start(targets, local, remote, (outcomes) => {
        const next = republished(latest.current, {
          local,
          remote,
          values: selected(outcomes, select),
        });
        if (next === latest.current) return;
        latest.current = next;
        setPublished(next);
      }),
    [discovery, targets, local, remote, select],
  );
  const current = useMemo(
    () => currentValues(published, targets, local, remote),
    [published, targets, local, remote],
  );
  return useContentStable(current);
}

function wholeOutcome(outcome: RepositoryIdentityOutcome): RepositoryIdentityOutcome {
  return outcome;
}

function knownIdentity(outcome: RepositoryIdentityOutcome): string | null {
  return outcome.kind === "identity" ? outcome.identity : null;
}

function projectTarget(project: AgentProjectDescriptor): RepositoryIdentityTarget {
  return {
    key: project.rootKey,
    root: project.rootPath,
    authority: JSON.stringify([
      project.ownerId,
      project.generation,
      project.trust,
      project.leaseToken,
    ]),
  };
}

function projectTargets(
  projects: readonly AgentProjectDescriptor[],
): readonly RepositoryIdentityTarget[] {
  return projects.slice(0, MAX_AGENT_PROJECT_ROOTS).map(projectTarget);
}

export function useRepositoryIdentityOutcomes(
  candidates: readonly RepositoryIdentityTarget[],
  local: RepositoryIdentityGateway | null,
  remote: RemoteRepositoryIdentityGateway | null,
  timers: RepositoryIdentityTimers = SYSTEM_REPOSITORY_IDENTITY_TIMERS,
): RepositoryIdentityOutcomes {
  return useDiscoveredValues(candidates, local, remote, timers, wholeOutcome);
}

/** Bounded presentation discovery. Identities never grant a project execution authority. */
export function useProjectRepositoryIdentities(
  projects: readonly AgentProjectDescriptor[],
  local: RepositoryIdentityGateway | null,
  remote: RemoteRepositoryIdentityGateway | null,
  timers: RepositoryIdentityTimers = SYSTEM_REPOSITORY_IDENTITY_TIMERS,
): ReadonlyMap<string, string> {
  return useDiscoveredValues(projectTargets(projects), local, remote, timers, knownIdentity);
}
