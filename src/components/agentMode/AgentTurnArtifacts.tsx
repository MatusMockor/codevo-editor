import { useMemo } from "react";
import type {
  AgentArtifactLoader,
  AgentArtifactOwner,
  AgentArtifactPreviewPort,
} from "../../application/agentArtifactPorts";
import type { AgentThreadOwner } from "../../domain/agentThread";
import { agentTurnArtifactReferences } from "../../domain/agentTurnArtifactReferences";
import type { AgentTurnLogEvidence } from "../../domain/agentTurnContentLoss";
import type { AgentTurn } from "../../domain/agentThread";
import { useAgentArtifactSupport } from "./agentArtifactSupport";
import { AgentOutputArtifacts } from "./AgentOutputArtifacts";

export interface AgentArtifactScope {
  readonly owner: AgentThreadOwner;
  readonly threadId: string;
  readonly serverId: string | undefined;
  readonly runnerId: string | undefined;
  readonly loader: AgentArtifactLoader;
  readonly preview: AgentArtifactPreviewPort;
}

export function AgentTurnArtifacts({
  scope,
  turn,
  evidence = null,
}: {
  readonly scope: AgentArtifactScope;
  readonly turn: AgentTurn;
  readonly evidence?: AgentTurnLogEvidence | null;
}) {
  const { owner: threadOwner, threadId, serverId, runnerId, loader, preview } = scope;
  const support = useAgentArtifactSupport();
  const owner = useMemo<AgentArtifactOwner>(
    () =>
      serverId === undefined || runnerId === undefined
        ? { kind: "local", ...threadOwner, threadId, turnId: turn.turnId }
        : { kind: "remote", serverId, runnerId, taskId: turn.turnId },
    [threadOwner, threadId, serverId, runnerId, turn.turnId],
  );
  const references = useMemo(() => agentTurnArtifactReferences(turn, evidence), [turn, evidence]);
  return (
    <AgentOutputArtifacts
      files={support.files}
      loader={loader}
      owner={owner}
      preview={preview}
      references={references}
      reportError={support.reportError}
    />
  );
}
