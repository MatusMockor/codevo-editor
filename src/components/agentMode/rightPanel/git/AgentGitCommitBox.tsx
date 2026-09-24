import { CloudUpload, Sparkles } from "lucide-react";
import type { AgentGitBusy } from "../../../../application/rightPanel/useAgentGitSurface";
import { Button } from "../../../../ui/foundation/Button";

export interface AgentGitCommitBoxProps {
  readonly message: string;
  readonly busy: AgentGitBusy;
  readonly canCommit: boolean;
  onMessageChange(message: string): void;
  onGenerate(): void;
  onCommit(): void;
  onCommitAndPush(): void;
}

export function AgentGitCommitBox(props: AgentGitCommitBoxProps) {
  const disabled = props.busy !== "idle" || !props.canCommit;
  return (
    <div className="cv-git-box">
      <textarea
        aria-label="Commit message"
        className="cv-git-box__message"
        onChange={(event) => props.onMessageChange(event.currentTarget.value)}
        placeholder="Leave empty to auto-generate"
        rows={3}
        value={props.message}
      />
      <div className="cv-git-box__foot">
        <button
          className="cv-git-box__generate"
          disabled={props.busy !== "idle"}
          onClick={props.onGenerate}
          title="Generate message"
          type="button"
        >
          <Sparkles aria-hidden="true" size={12} />
          Generate
        </button>
        <span className="cv-git-box__end">
          <Button disabled={disabled} onClick={props.onCommit} size="sm">
            Commit
          </Button>
          <Button
            disabled={disabled}
            icon={<CloudUpload size={14} />}
            onClick={props.onCommitAndPush}
            size="sm"
            variant="primary"
          >
            {primaryLabel(props.busy)}
          </Button>
        </span>
      </div>
    </div>
  );
}

function primaryLabel(busy: AgentGitBusy): string {
  switch (busy) {
    case "idle":
      return "Commit & push";
    case "committing":
      return "Committing…";
    case "pushing":
      return "Pushing…";
    default: {
      const exhaustive: never = busy;
      return exhaustive;
    }
  }
}
