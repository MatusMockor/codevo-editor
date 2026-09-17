import "./remoteInstructionSource.css";
import { useState, useSyncExternalStore } from "react";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import {
  readRemoteInstructionRoot,
  readRemoteInstructionSourceRevision,
  subscribeRemoteInstructionSources,
  removeRemoteInstructionRoot,
  saveRemoteInstructionRoot,
} from "../../application/remoteInstructionSources";

interface Props {
  readonly remoteRootKey: string;
  readonly projects: readonly AgentProjectDescriptor[];
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
}

export function RemoteInstructionSourceControl(props: Props) {
  const parts = props.remoteRootKey.split(":");
  if (parts.length !== 4 || parts[0] !== "remote") return null;
  try {
    const owner = parts.slice(1).map(decodeURIComponent) as [string, string, string];
    return <SourceSelection key={props.remoteRootKey} {...props} owner={owner} />;
  } catch {
    return null;
  }
}

function SourceSelection({
  projects,
  owner,
  disabled,
  readOnly,
}: Props & { readonly owner: readonly [string, string, string] }) {
  useSyncExternalStore(subscribeRemoteInstructionSources, readRemoteInstructionSourceRevision);
  const [saveError, setSaveError] = useState<string | null>(null);
  let root = "";
  let readError: string | null = null;
  try {
    root = readRemoteInstructionRoot(...owner) ?? "";
  } catch {
    readError =
      "Could not read instruction source preferences. Sending is blocked until they can be read.";
  }
  if (readOnly)
    return (
      <div className="remote-instruction-source">
        <small>
          {readError ??
            (root
              ? `Global and project rules use local source: ${root}.`
              : "Only global rules sync.")}{" "}
          Manage the local instruction source in Settings → Environments.
        </small>
      </div>
    );
  const sources = projects.filter(
    (project) =>
      project.trust === "trusted" &&
      !project.rootKey.startsWith("remote:") &&
      project.origin !== "closed-tab-live-tasks",
  );
  return (
    <div className="remote-instruction-source">
      <label>
        Local instruction source
        <select
          aria-label="Local instruction source"
          value={root}
          disabled={disabled}
          onChange={(event) => {
            const root = event.currentTarget.value;
            try {
              if (root === "") removeRemoteInstructionRoot(...owner);
              else {
                const source = sources.find((project) => project.rootPath === root);
                if (!source)
                  throw new Error("The selected local workspace is no longer available.");
                saveRemoteInstructionRoot(...owner, source.rootPath);
              }
              setSaveError(null);
            } catch {
              setSaveError(
                "Could not save instruction source preferences. Your previous selection remains active.",
              );
            }
          }}
        >
          <option value="">Global rules only</option>
          {root && !sources.some((project) => project.rootPath === root) && (
            <option value={root}>{root} (reopen local project)</option>
          )}
          {sources.map((project) => (
            <option key={project.rootKey} value={project.rootPath}>
              {project.label} — {project.rootPath}
            </option>
          ))}
        </select>
      </label>
      <small>
        {root
          ? "Global and project rules refresh from disk before each message. Keep this local project open and trusted."
          : sources.length === 0
            ? "Only global rules sync. Open a trusted local project in the agent view to choose its project rules."
            : "Only global rules sync. Select a trusted local project to include its project rules."}
      </small>
      {(readError ?? saveError) && <p role="alert">{readError ?? saveError}</p>}
    </div>
  );
}
