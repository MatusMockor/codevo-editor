import "../remoteRunner/remoteInstructionSource.css";
import { useState } from "react";
import { FolderTree } from "lucide-react";
import {
  clearAgentProjectGroupingOverrides,
  resetAgentProjectGrouping,
  saveAgentProjectGroupingMode,
  saveAgentProjectGroupingOverride,
  type AgentProjectGroupingWrite,
} from "../../application/agentProjectGroupingPreference";
import {
  useAgentProjectGrouping,
  useAgentProjectGroupingStorageState,
} from "../../application/useAgentProjectGrouping";
import { useProjectDisplayNames } from "../../application/useProjectDisplayNames";
import { useRemoteProjectLinks } from "../../application/useRemoteProjectLinks";
import {
  MAX_REMOTE_PROJECT_INVENTORY_SERVERS,
  useRemoteProjectInventories,
  type RemoteProjectInventories,
  type RemoteProjectInventoryGateway,
} from "../../application/useRemoteProjectInventories";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import {
  AGENT_PROJECT_GROUPING_MODES,
  isAgentProjectGroupingMode,
} from "../../domain/agentProjectGrouping";
import { SettingsButton } from "./primitives/SettingsButton";
import {
  PROJECT_GROUPING_DEFAULT_VALUE,
  projectGroupingList,
  projectGroupingModeLabel,
  projectGroupingSelection,
  projectGroupingWriteMessage,
  type ProjectGroupingList,
  type ProjectGroupingServer,
} from "./projectGroupingPresentation";

export interface ProjectGroupingRemote {
  readonly gateway?: RemoteProjectInventoryGateway | null;
  readonly servers: ReadonlyArray<ProjectGroupingServer>;
}

const NO_SERVERS: ReadonlyArray<ProjectGroupingServer> = [];
const UNSUPPORTED_CHOICE = "This grouping choice is not available.";

function ModeOptions() {
  return AGENT_PROJECT_GROUPING_MODES.map((mode) => (
    <option key={mode} value={mode}>
      {projectGroupingModeLabel(mode)}
    </option>
  ));
}

function ServerNotice({
  server,
  inventories,
}: {
  readonly server: ProjectGroupingServer;
  readonly inventories: RemoteProjectInventories;
}) {
  const inventory = server.connected ? inventories.get(server.id) : undefined;
  if (inventory?.kind === "loading") return <p role="status">Loading projects on {server.name}…</p>;
  if (inventory?.kind === "slow")
    return <p role="status">Still loading projects on {server.name}…</p>;
  if (inventory?.kind === "failed")
    return (
      <p role="alert">
        Could not load projects on {server.name}. Close and reopen this section to retry.
      </p>
    );
  return null;
}

function GroupingRows({
  list,
  disabled,
  onSelect,
}: {
  readonly list: ProjectGroupingList;
  readonly disabled: boolean;
  onSelect(rootKey: string, value: string): void;
}) {
  return (
    <>
      {list.rows.map((row) => (
        <label className="remote-instruction-source" key={row.rootKey}>
          {row.label} — {row.detail}
          <select
            aria-label={`Grouping for ${row.label} (${row.detail})`}
            disabled={disabled || row.control === "followsConnection"}
            value={row.override ?? PROJECT_GROUPING_DEFAULT_VALUE}
            onChange={(event) => onSelect(row.rootKey, event.currentTarget.value)}
          >
            <option value={PROJECT_GROUPING_DEFAULT_VALUE}>Use default</option>
            <ModeOptions />
          </select>
        </label>
      ))}
      {list.total > list.rows.length && (
        <p role="status">
          Showing {list.rows.length} of {list.total} projects. Projects with an override take
          priority.
        </p>
      )}
    </>
  );
}

export function ProjectGroupingSettings({
  projects,
  remote,
}: {
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly remote: ProjectGroupingRemote | null;
}) {
  const settings = useAgentProjectGrouping();
  const storage = useAgentProjectGroupingStorageState();
  const links = useRemoteProjectLinks();
  const displayNames = useProjectDisplayNames();
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const servers = remote?.servers ?? NO_SERVERS;
  const connectedServerIds = servers
    .filter((server) => server.connected)
    .map((server) => server.id);
  const inventories = useRemoteProjectInventories(
    remote?.gateway ?? null,
    connectedServerIds,
    expanded,
  );
  const corrupt = storage === "corrupt";

  const report = (write: AgentProjectGroupingWrite) => {
    setError(write.kind === "saved" ? null : projectGroupingWriteMessage(write.reason));
  };
  const selectDefault = (value: string) => {
    if (!isAgentProjectGroupingMode(value)) {
      setError(UNSUPPORTED_CHOICE);
      return;
    }
    report(saveAgentProjectGroupingMode(value));
  };
  const selectOverride = (rootKey: string, value: string) => {
    const selection = projectGroupingSelection(value);
    if (selection.kind === "unsupported") {
      setError(UNSUPPORTED_CHOICE);
      return;
    }
    report(saveAgentProjectGroupingOverride(rootKey, selection.mode));
  };
  const list = expanded
    ? projectGroupingList({ projects, servers, inventories, settings, links, displayNames })
    : null;

  return (
    <div className="settings-environments__empty">
      <FolderTree aria-hidden="true" className="settings-environments__icon" size={20} />
      <div className="settings-environments__copy">
        <p className="settings-environments__title">Project grouping</p>
        <p className="settings-environments__description">
          Show checkouts of the same repository as one project, or keep every project separate. Each
          thread keeps its own environment.
        </p>
        {corrupt && (
          <div>
            <p role="alert">
              Saved grouping settings could not be read, so the default is used. Reset them to make
              changes.
            </p>
            <SettingsButton onClick={() => report(resetAgentProjectGrouping())} variant="outline">
              Reset grouping settings
            </SettingsButton>
          </div>
        )}
        <label className="remote-instruction-source">
          Default
          <select
            aria-label="Default project grouping"
            disabled={corrupt}
            value={settings.mode}
            onChange={(event) => selectDefault(event.currentTarget.value)}
          >
            <ModeOptions />
          </select>
        </label>
        <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
          <summary>Project overrides</summary>
          {list !== null && (
            <div>
              <p>
                Choose a different grouping for one project. Connected projects always stay
                together.
              </p>
              {list.total === 0 && servers.length === 0 && <p>No projects to group yet.</p>}
              {servers.map((server) => (
                <ServerNotice key={server.id} server={server} inventories={inventories} />
              ))}
              {connectedServerIds.length > MAX_REMOTE_PROJECT_INVENTORY_SERVERS && (
                <p role="status">
                  Projects are loaded for the first {MAX_REMOTE_PROJECT_INVENTORY_SERVERS} connected
                  servers.
                </p>
              )}
              <GroupingRows list={list} disabled={corrupt} onSelect={selectOverride} />
              {list.unavailableRootKeys.length > 0 && (
                <SettingsButton
                  disabled={corrupt}
                  onClick={() =>
                    report(clearAgentProjectGroupingOverrides(list.unavailableRootKeys))
                  }
                  variant="outline"
                >
                  Reset overrides for unavailable projects
                </SettingsButton>
              )}
            </div>
          )}
        </details>
        {error !== null && <p role="alert">{error}</p>}
      </div>
    </div>
  );
}
