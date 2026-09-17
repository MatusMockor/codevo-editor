import { useState } from "react";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { RemoteRunnerGateway } from "../../domain/remoteRunner";
import { useRemoteInstructionSettings } from "../../application/useRemoteInstructionSettings";
import { remoteAgentProjectKey } from "../../application/remoteAgentProjection";
import { RemoteInstructionSourceControl } from "./RemoteInstructionSourceControl";

export function RemoteInstructionSettings({
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
  const inventory = useRemoteInstructionSettings(gateway, serverId, connected && expanded);
  return (
    <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>Advanced · Claude rules</summary>
      {expanded &&
        (!connected ? (
          <p>Connect this server to manage project rules.</p>
        ) : inventory.kind === "loading" ? (
          <p role="status">Loading projects…</p>
        ) : inventory.kind === "failed" ? (
          <p role="alert">Could not load projects. Close and reopen this section to retry.</p>
        ) : (
          <div>
            <p>
              Global Claude rules sync automatically. Optionally choose an open, trusted local
              project as the source of project rules.
            </p>
            {inventory.projects.length === 0 && <p>No projects on this server.</p>}
            {inventory.projects.map((project) => (
              <fieldset key={project.id}>
                <legend>{project.name}</legend>
                <RemoteInstructionSourceControl
                  remoteRootKey={remoteAgentProjectKey(serverId, inventory.runnerId, project.id)}
                  projects={projects}
                />
              </fieldset>
            ))}
          </div>
        ))}
    </details>
  );
}
