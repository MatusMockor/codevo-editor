import { useEffect, useMemo, useState } from "react";
import { MAX_AGENT_PROJECT_ROOTS, type AgentProjectDescriptor } from "../domain/agentProject";
import type { RepositoryIdentityGateway } from "./repositoryIdentityGateway";

import type { RemoteRepositoryIdentityGateway } from "../domain/remoteRepositoryIdentity";

import {
  ProjectRepositoryIdentityDiscovery,
  type RepositoryIdentityTarget,
} from "./projectRepositoryIdentityDiscovery";
const EMPTY: ReadonlyMap<string, string> = new Map();

/** Bounded presentation discovery. Identities never grant a project execution authority. */
export function useProjectRepositoryIdentities(
  projects: readonly AgentProjectDescriptor[],
  local: RepositoryIdentityGateway | null,
  remote: RemoteRepositoryIdentityGateway | null,
): ReadonlyMap<string, string> {
  // Project descriptors change with thread activity. Only authority changes should
  // restart discovery; no git process is launched for each streamed token.
  const signature = JSON.stringify(
    projects.slice(0, MAX_AGENT_PROJECT_ROOTS).map((project) => ({
      key: project.rootKey,
      root: project.rootPath,
      authority: JSON.stringify([
        project.ownerId,
        project.generation,
        project.trust,
        project.leaseToken,
      ]),
    })),
  );
  const targets = useMemo(
    () => JSON.parse(signature) as readonly RepositoryIdentityTarget[],
    [signature],
  );
  const [result, setResult] = useState<Readonly<{
    targets: readonly RepositoryIdentityTarget[];
    local: RepositoryIdentityGateway | null;
    remote: RemoteRepositoryIdentityGateway | null;
    values: ReadonlyMap<string, string>;
  }> | null>(null);

  const [discovery] = useState(() => new ProjectRepositoryIdentityDiscovery());
  useEffect(
    () =>
      discovery.start(targets, local, remote, (values) => {
        setResult({ targets, local, remote, values });
      }),
    [discovery, targets, local, remote],
  );

  return result?.targets === targets && result.local === local && result.remote === remote
    ? result.values
    : EMPTY;
}
