import type { RemoteAddProjectLookupState } from "../../../application/useRemoteAddProject";
import type { RepositoryHost } from "../../../domain/repositoryLookup";
import {
  REMOTE_ADD_PROJECT_HOSTS_TRUNCATED,
  remoteAddProjectEntryHint,
  remoteAddProjectLookupMessage,
  type RemoteAddProjectEntrySource,
} from "./remoteAddProjectMessages";

export interface RemoteAddProjectRepositoryEntryProps {
  readonly lookup: RemoteAddProjectLookupState;
  readonly source: RemoteAddProjectEntrySource;
  onUseGitUrl(): void;
}

export interface RemoteAddProjectRepositoryHostsProps {
  readonly host: string;
  readonly hosts: readonly RepositoryHost[];
  readonly truncated: boolean;
  onChooseHost(host: string): void;
}

export function RemoteAddProjectRepositoryEntry({
  lookup,
  onUseGitUrl,
  source,
}: RemoteAddProjectRepositoryEntryProps) {
  const message = remoteAddProjectLookupMessage(lookup, source);
  return (
    <div className="agent-remote-add-project__entry">
      {lookup.status === "pending" && (
        <p className="quick-open-state" role="status">
          Looking up the repository…
        </p>
      )}
      {message !== null && (
        <div className="quick-open-state agent-remote-add-project__outcome" role="status">
          <span className="agent-remote-add-project__outcome-text">{message.message}</span>
          {message.remedy !== null && (
            <span className="agent-remote-add-project__note">{message.remedy}</span>
          )}
          {source !== "gitUrl" && (
            <button className="agent-linkbutton" onClick={onUseGitUrl} type="button">
              Use Git URL
            </button>
          )}
        </div>
      )}
      {lookup.status === "idle" && (
        <p className="agent-remote-add-project__note">{remoteAddProjectEntryHint(source)}</p>
      )}
    </div>
  );
}

export function RemoteAddProjectRepositoryHosts({
  host,
  hosts,
  onChooseHost,
  truncated,
}: RemoteAddProjectRepositoryHostsProps) {
  return (
    <span className="agent-remote-add-project__hosts">
      {hosts.length <= 1 && <span className="agent-remote-add-project__badge">{host}</span>}
      {hosts.length > 1 && (
        <select
          aria-label="Repository host"
          className="agent-remote-add-project__host"
          onChange={(event) => onChooseHost(event.currentTarget.value)}
          value={host}
        >
          {hosts.map((entry) => (
            <option disabled={entry.auth !== "authenticated"} key={entry.host} value={entry.host}>
              {entry.host}
            </option>
          ))}
        </select>
      )}
      {truncated && (
        <span className="agent-remote-add-project__note">{REMOTE_ADD_PROJECT_HOSTS_TRUNCATED}</span>
      )}
    </span>
  );
}
