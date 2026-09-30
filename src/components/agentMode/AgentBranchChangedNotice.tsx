import { GitBranch, X } from "lucide-react";
import { Button } from "../../ui/foundation/Button";
import { ComposerBanner } from "../../ui/foundation/ComposerBanner";
import { IconButton } from "../../ui/foundation/IconButton";
import type { AgentBranchChangedNoticeView } from "./useAgentStartedThreadBranch";

export function AgentBranchChangedNotice({
  notice,
}: {
  readonly notice: AgentBranchChangedNoticeView | null;
}) {
  if (notice === null) return null;
  const { currentBranch, threadBranch } = notice.mismatch;
  return (
    <ComposerBanner
      actions={
        <>
          <Button disabled={notice.restoring} onClick={notice.restore} size="sm" variant="ghost">
            {notice.restoring ? "Restoring..." : "Restore branch"}
          </Button>
          <IconButton
            icon={<X aria-hidden="true" size={14} />}
            label="Dismiss branch change notice"
            onClick={notice.dismiss}
            size="xs"
          />
        </>
      }
      announce={false}
      icon={<GitBranch aria-hidden="true" size={14} />}
    >
      <span
        className="agent-branch-changed"
        title={`This thread last ran on ${threadBranch}. Sending will continue on ${currentBranch}.`}
      >
        <span className="agent-branch-changed__lead">Branch changed — was</span>{" "}
        <code className="agent-branch-changed__branch">{threadBranch}</code>
      </span>
      {notice.error === null ? null : (
        <span className="agent-branch-changed__error" role="alert">
          {notice.error}
        </span>
      )}
    </ComposerBanner>
  );
}
