import { FolderPlus } from "lucide-react";
import { useMemo } from "react";
import { createRemoteProjectDirectoryGateway } from "../../application/remoteRepositoryLookupGateway";
import {
  useRemoteCounterpartFolder,
  type RemoteCounterpartFolder,
} from "../../application/useRemoteCounterpartFolder";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { localProjectFolderName } from "../../domain/remoteProjectCounterpart";
import { useRemoteRunnerContext } from "../remoteRunner/remoteRunnerContext";

export function AgentRemoteCounterpartRow({
  project,
  onAdd,
}: {
  readonly project: AgentProjectDescriptor;
  readonly onAdd: (initialPath: string | null) => void;
}) {
  const remote = useRemoteRunnerContext();
  const runner = remote?.gateway ?? null;
  const serverId = remote?.selectedServerId ?? null;
  const gateway = useMemo(
    () => createRemoteProjectDirectoryGateway(runner, serverId),
    [runner, serverId],
  );
  const folder = useRemoteCounterpartFolder(gateway, localProjectFolderName(project.rootPath));
  const path = folder.status === "found" ? folder.path : null;
  return (
    <div className="agent-remote-project-choice__counterpart">
      <button
        aria-busy={folder.status === "checking"}
        className="agent-remote-project-choice__row agent-remote-project-choice__counterpart-add"
        data-counterpart-path={path ?? undefined}
        disabled={folder.status === "checking"}
        onClick={() => onAdd(path)}
        type="button"
      >
        <FolderPlus aria-hidden="true" size={15} />
        <span className="agent-remote-project-choice__name">
          <strong>Add {project.label} on this server</strong>
          <small title={path ?? undefined}>
            <bdi>{counterpartDetail(folder)}</bdi>
          </small>
        </span>
      </button>
    </div>
  );
}

function counterpartDetail(folder: RemoteCounterpartFolder): string {
  switch (folder.status) {
    case "checking":
      return "Looking for its folder…";
    case "found":
      return folder.path;
    case "absent":
      return "Choose its folder on the server";
    default:
      return unsupportedFolder(folder);
  }
}

function unsupportedFolder(folder: never): never {
  throw new TypeError(`Unsupported counterpart folder: ${JSON.stringify(folder)}.`);
}
