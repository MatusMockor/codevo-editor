import { useMemo, useState } from "react";
import type { AgentProjectDescriptor } from "../domain/agentProject";
import type { RemoteRepositoryIdentityGateway } from "../domain/remoteRepositoryIdentity";
import { withFolderProjectIdentities } from "./folderProjectIdentities";
import type { RepositoryIdentityGateway } from "./repositoryIdentityGateway";
import { repositoryIdentityCandidates } from "./repositoryIdentityCandidates";
import { useProjectRepositoryIdentityOutcomes } from "./useProjectRepositoryIdentities";

export function useAgentProjectIdentities(
  projects: readonly AgentProjectDescriptor[],
  links: ReadonlyMap<string, string>,
  local: RepositoryIdentityGateway | null,
  remote: RemoteRepositoryIdentityGateway | null,
): ReadonlyMap<string, string> {
  const outcomes = useProjectRepositoryIdentityOutcomes(
    repositoryIdentityCandidates(projects, links),
    local,
    remote,
  );
  const next = useMemo(() => withFolderProjectIdentities(projects, outcomes), [projects, outcomes]);
  const [held, setHeld] = useState(next);
  if (sameEntries(held, next)) return held;
  setHeld(next);
  return next;
}

function sameEntries(left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>) {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [key, value] of left) if (right.get(key) !== value) return false;
  return true;
}
