import { Copy, X } from "lucide-react";
import { Button } from "../../../../ui/foundation/Button";
import { IconButton } from "../../../../ui/foundation/IconButton";
import type { AgentGitBranchNotice as BranchNotice } from "./useAgentGitBranchActions";

export interface AgentGitBranchNoticeProps {
  readonly notice: BranchNotice | null;
  onCopyPath(path: string): void;
  onDismiss(): void;
}

export function AgentGitBranchNotice({ notice, onCopyPath, onDismiss }: AgentGitBranchNoticeProps) {
  if (notice === null) return null;
  return (
    <div
      className={`cv-git-branch-notice cv-git-branch-notice--${notice.kind}`}
      role={notice.kind === "error" ? "alert" : "status"}
    >
      <span className="cv-git-branch-notice__text">
        {notice.text}
        {notice.kind === "worktree" && !notice.trusted && (
          <span className="cv-git-branch-notice__trust">
            {" "}
            This worktree is not trusted yet. Trust it before running scripts or agents there.
          </span>
        )}
      </span>
      {notice.kind === "worktree" && (
        <Button icon={<Copy size={12} />} onClick={() => onCopyPath(notice.path)} size="sm">
          Copy path
        </Button>
      )}
      <IconButton
        icon={<X size={12} />}
        label="Dismiss branch notice"
        onClick={onDismiss}
        size="xs"
      />
    </div>
  );
}
