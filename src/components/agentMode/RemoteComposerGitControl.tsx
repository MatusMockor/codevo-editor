import { useEffect } from "react";
import {
  useRemoteDraftGitBase,
  type RemoteComposerGit,
} from "../../application/useRemoteDraftGitBase";
import { useRemoteProjectGit } from "../../application/useRemoteProjectGit";
import { useNowMs } from "../../ui/foundation/useNowMs";
import type { AgentComposerDrawerContext } from "./composer/AgentComposerFrame";
import { RemoteBaseBranchPicker } from "./RemoteBaseBranchPicker";
import { RemoteCheckoutUpdateAction } from "./RemoteCheckoutUpdateAction";

export type RemoteComposerGitMode = "base" | "checkout";

export interface RemoteComposerGitControlProps {
  readonly context: AgentComposerDrawerContext;
  readonly remoteGit: RemoteComposerGit;
  readonly mode: RemoteComposerGitMode;
}

export function RemoteComposerGitControl({
  context,
  mode,
  remoteGit,
}: RemoteComposerGitControlProps) {
  const git = useRemoteProjectGit({ port: remoteGit.port, project: remoteGit.project });
  const refresh = git.refresh;
  useEffect(() => {
    void refresh();
  }, [refresh, remoteGit.key, remoteGit.revision]);
  const nowMs = useNowMs();
  const draft = useRemoteDraftGitBase({
    enabled: mode === "base",
    base: context.worktreeBase,
    branches: git.branches.kind === "idle" ? null : git.branches.value,
    onBaseChange: context.onWorktreeBaseChange,
  });
  if (mode === "checkout") {
    return <RemoteCheckoutUpdateAction disabled={context.disabled} git={git} nowMs={nowMs} />;
  }
  return (
    <RemoteBaseBranchPicker
      base={context.worktreeBase}
      disabled={context.disabled}
      git={git}
      nowMs={nowMs}
      onChoose={draft.choose}
    />
  );
}
