import { FolderOpen, SquarePen } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentArtifactFilePort,
  AgentArtifactOwner,
} from "../../application/agentArtifactPorts";
import {
  agentArtifactActionNotice,
  agentArtifactFileActionsBlockedReason,
  AGENT_ARTIFACT_OPEN_FAILED,
  AGENT_ARTIFACT_REVEAL_FAILED,
} from "../../application/createAgentArtifactFilePort";
import { detectKeymapPlatform } from "../../domain/keymap";
import { agentArtifactRevealLabel } from "./agentArtifactSupport";

export const AGENT_ARTIFACT_FILES_UNAVAILABLE = "Opening generated files needs the native runtime.";

export interface AgentArtifactFileActionsProps {
  readonly owner: AgentArtifactOwner;
  readonly path: string;
  readonly files: AgentArtifactFilePort | null;
  readonly reasonId: string;
}

type PendingAction = "open" | "reveal" | null;

export function AgentArtifactFileActions({
  owner,
  path,
  files,
  reasonId,
}: AgentArtifactFileActionsProps) {
  const [pending, setPending] = useState<PendingAction>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const blocked = files === null ? AGENT_ARTIFACT_FILES_UNAVAILABLE : null;
  const reason = blocked ?? agentArtifactFileActionsBlockedReason(owner);
  const revealLabel = agentArtifactRevealLabel(detectKeymapPlatform());

  const run = useCallback(
    (action: Exclude<PendingAction, null>, failure: string): void => {
      if (files === null || reason !== null || pending !== null) return;
      setNotice(null);
      setPending(action);
      const work =
        action === "open"
          ? files.openInEditor(owner, path)
          : files.revealInFileManager(owner, path);
      void work
        .then(() => {
          if (!mounted.current) return;
          setPending(null);
        })
        .catch((error: unknown) => {
          if (!mounted.current) return;
          setPending(null);
          setNotice(agentArtifactActionNotice(error, failure));
        });
    },
    [files, owner, path, pending, reason],
  );

  return (
    <>
      <div className="agent-artifacts__actions">
        <button
          aria-describedby={reason === null ? undefined : reasonId}
          className="agent-artifacts__action"
          data-agent-artifact-action="open"
          disabled={reason !== null || pending !== null}
          onClick={() => run("open", AGENT_ARTIFACT_OPEN_FAILED)}
          title={reason ?? "Open in editor"}
          type="button"
        >
          <SquarePen aria-hidden="true" size={14} />
          <span>Open in editor</span>
        </button>
        <button
          aria-describedby={reason === null ? undefined : reasonId}
          className="agent-artifacts__action"
          data-agent-artifact-action="reveal"
          disabled={reason !== null || pending !== null}
          onClick={() => run("reveal", AGENT_ARTIFACT_REVEAL_FAILED)}
          title={reason ?? revealLabel}
          type="button"
        >
          <FolderOpen aria-hidden="true" size={14} />
          <span>{revealLabel}</span>
        </button>
      </div>
      {reason !== null && (
        <p className="agent-artifacts__reason" id={reasonId}>
          {reason}
        </p>
      )}
      {notice !== null && (
        <p className="agent-artifacts__notice" role="status">
          {notice}
        </p>
      )}
    </>
  );
}
