import "./remoteInstructionSource.css";
import { useState } from "react";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { RemoteRepositoryIdentityGateway } from "../../domain/remoteRepositoryIdentity";
import type { RemoteRunnerGateway, RemoteRunnerProject } from "../../domain/remoteRunner";
import type {
  RepositoryIdentityOutcome,
  RepositoryIdentityTarget,
} from "../../application/projectRepositoryIdentityDiscovery";
import type { RepositoryIdentityTimers } from "../../application/repositoryIdentityRetry";
import { useRepositoryIdentityOutcomes } from "../../application/useProjectRepositoryIdentities";
import { useRemoteInstructionSettings } from "../../application/useRemoteInstructionSettings";
import { useRemoteProjectLinks } from "../../application/useRemoteProjectLinks";
import { remoteAgentProjectKey } from "../../application/remoteAgentProjection";
import {
  removeRemoteProjectLink,
  saveRemoteProjectLink,
} from "../../application/remoteProjectLinks";
import { SHARED_REMOTE_REPOSITORY_IDENTITY } from "./sharedRemoteRepositoryIdentity";

const NO_IDENTITY_TARGETS: readonly RepositoryIdentityTarget[] = [];
const IDENTITY_AUTHORITY = "project-connections";
const IDENTITY_RETRYING_HINT = "Could not read this project's repository yet. Retrying…";
const IDENTITY_FAILED_HINT =
  "Could not read this project's repository. Close and reopen this section to retry.";

function unlinkedIdentityTargets(
  serverId: string,
  runnerId: string,
  projects: readonly RemoteRunnerProject[],
  links: ReadonlyMap<string, string>,
): readonly RepositoryIdentityTarget[] {
  return projects
    .map((project) => remoteAgentProjectKey(serverId, runnerId, project.id))
    .filter((key) => !links.get(key))
    .map((key) => ({ key, root: key, authority: IDENTITY_AUTHORITY }));
}

function withoutHint(_outcome: never): null {
  return null;
}

function repositoryIdentityHint(outcome: RepositoryIdentityOutcome | undefined): string | null {
  if (outcome === undefined) return null;
  switch (outcome.kind) {
    case "identity":
    case "none":
    case "unavailable":
      return null;
    case "failed":
      return outcome.retrying ? IDENTITY_RETRYING_HINT : IDENTITY_FAILED_HINT;
    default:
      return withoutHint(outcome);
  }
}

export function RemoteProjectLinksSettings({
  gateway,
  serverId,
  connected,
  projects,
  identity = SHARED_REMOTE_REPOSITORY_IDENTITY,
  identityTimers,
}: {
  readonly gateway: Pick<RemoteRunnerGateway, "getRunner" | "listProjects">;
  readonly serverId: string;
  readonly connected: boolean;
  readonly projects: readonly AgentProjectDescriptor[];
  readonly identity?: RemoteRepositoryIdentityGateway | null;
  readonly identityTimers?: RepositoryIdentityTimers;
}) {
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inventory = useRemoteInstructionSettings(gateway, serverId, connected && expanded);
  const links = useRemoteProjectLinks();
  const identityTargets =
    inventory.kind === "ready"
      ? unlinkedIdentityTargets(serverId, inventory.runnerId, inventory.projects, links)
      : NO_IDENTITY_TARGETS;
  const identityOutcomes = useRepositoryIdentityOutcomes(
    identityTargets,
    null,
    identity,
    identityTimers,
  );
  const localProjects = projects.filter(
    (project) =>
      !project.rootKey.startsWith("remote:") && project.origin !== "closed-tab-live-tasks",
  );
  return (
    <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>Project connections</summary>
      {expanded &&
        (!connected ? (
          <p>Connect this server to link projects.</p>
        ) : inventory.kind === "loading" ? (
          <p role="status">Loading projects…</p>
        ) : inventory.kind === "failed" ? (
          <p role="alert">Could not load projects. Close and reopen this section to retry.</p>
        ) : (
          <div>
            <p>
              Connect matching local and server projects to show their threads together. Each thread
              keeps its own environment.
            </p>
            {inventory.projects.length === 0 && <p>No projects on this server.</p>}
            {localProjects.length === 0 && (
              <p>Open a local project to connect its server checkout.</p>
            )}
            {inventory.projects.map((project) => {
              const key = remoteAgentProjectKey(serverId, inventory.runnerId, project.id);
              const selected = links.get(key) ?? "";
              const identityHint = repositoryIdentityHint(identityOutcomes.get(key));
              return (
                <label className="remote-instruction-source" key={key}>
                  {project.name}
                  <select
                    aria-label={`Local project for ${project.name}`}
                    value={selected}
                    onChange={(event) => {
                      try {
                        const root = event.currentTarget.value;
                        if (!root) removeRemoteProjectLink(key);
                        else {
                          const local = localProjects.find(
                            (candidate) => candidate.rootKey === root,
                          );
                          if (!local) throw new Error("The local project is no longer available.");
                          saveRemoteProjectLink(key, local.rootKey);
                        }
                        setError(null);
                      } catch {
                        setError(
                          "Could not save the project connection. Your previous selection remains active.",
                        );
                      }
                    }}
                  >
                    <option value="">Separate project</option>
                    {selected && !localProjects.some((local) => local.rootKey === selected) && (
                      <option value={selected}>{selected} (reopen local project)</option>
                    )}
                    {localProjects.map((local) => (
                      <option key={local.rootKey} value={local.rootKey}>
                        {local.label} — {local.rootPath}
                      </option>
                    ))}
                  </select>
                  {identityHint !== null && <span role="status">{identityHint}</span>}
                </label>
              );
            })}
            {error && <p role="alert">{error}</p>}
          </div>
        ))}
    </details>
  );
}
