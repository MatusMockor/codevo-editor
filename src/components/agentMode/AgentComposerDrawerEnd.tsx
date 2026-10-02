import {
  AgentComposerBranchLabel,
  AgentComposerBranchPicker,
  AgentComposerBranchPickerControl,
} from "./AgentComposerBranchPicker";
import type { AgentWorkbenchChrome } from "./agentWorkbenchChrome";
import type { AgentComposerDrawerContext } from "./composer/AgentComposerFrame";
import type { AgentStartedThreadBranch } from "./useAgentStartedThreadBranch";
import { RemoteComposerGitControl } from "./RemoteComposerGitControl";

export function AgentComposerDrawerEnd({
  checkout,
  context,
  started,
}: {
  readonly checkout: AgentWorkbenchChrome["branchCheckout"];
  readonly context: AgentComposerDrawerContext;
  readonly started: AgentStartedThreadBranch;
}) {
  const remoteGit = context.remoteGit ?? null;
  if (!context.locked && context.remote) {
    if (remoteGit === null) return null;
    return (
      <RemoteComposerGitControl
        context={context}
        key={remoteGit.key}
        mode={context.isolation === "worktree" ? "base" : "checkout"}
        remoteGit={remoteGit}
      />
    );
  }
  if (!context.locked) {
    const previous = context.previousWorktree ?? null;
    if (previous === null) {
      return <AgentComposerBranchPicker branchCheckout={checkout} context={context} />;
    }
    if (previous.branch === null) return null;
    return <AgentComposerBranchLabel branch={previous.branch} />;
  }
  const branch = started.branch;
  switch (branch.kind) {
    case "none":
      return null;
    case "serverCheckout":
      if (remoteGit === null) return null;
      return (
        <RemoteComposerGitControl
          context={context}
          key={remoteGit.key}
          mode="checkout"
          remoteGit={remoteGit}
        />
      );
    case "worktree":
      if (branch.branch === null) return null;
      return <AgentComposerBranchLabel branch={branch.branch} detail={branch.detail} />;
    case "live":
      if (started.picker !== null) {
        return (
          <AgentComposerBranchPickerControl
            context={{ ...context, isolation: "in-place" }}
            picker={started.picker}
          />
        );
      }
      if (started.currentBranch === null) return null;
      return <AgentComposerBranchLabel branch={started.currentBranch} />;
  }
}
