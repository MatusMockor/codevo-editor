import "./remoteInstructionSource.css";
import { useState } from "react";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { RemoteRunnerGateway } from "../../domain/remoteRunner";
import { useRemoteInstructionSettings } from "../../application/useRemoteInstructionSettings";
import { useRemoteProjectLinks } from "../../application/useRemoteProjectLinks";
import { remoteAgentProjectKey } from "../../application/remoteAgentProjection";
import {
  removeRemoteProjectLink,
  saveRemoteProjectLink,
} from "../../application/remoteProjectLinks";

export function RemoteProjectLinksSettings({
  gateway,
  serverId,
  connected,
  projects,
}: {
  readonly gateway: Pick<RemoteRunnerGateway, "getRunner" | "listProjects">;
  readonly serverId: string;
  readonly connected: boolean;
  readonly projects: readonly AgentProjectDescriptor[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inventory = useRemoteInstructionSettings(gateway, serverId, connected && expanded);
  const links = useRemoteProjectLinks();
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
                </label>
              );
            })}
            {error && <p role="alert">{error}</p>}
          </div>
        ))}
    </details>
  );
}
