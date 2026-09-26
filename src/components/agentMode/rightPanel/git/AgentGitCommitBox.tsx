import { CloudUpload, History, Sparkles, X } from "lucide-react";
import type { AgentGitAmendView } from "../../../../application/rightPanel/useAgentGitAmendMode";
import type { AgentGitBusy } from "../../../../application/rightPanel/useAgentGitSurface";
import { Button } from "../../../../ui/foundation/Button";
import { IconButton } from "../../../../ui/foundation/IconButton";
import { AgentGitCommitOptionsMenu } from "./AgentGitCommitOptionsMenu";
import { AMEND_MESSAGE_ONLY_HINT } from "./agentGitPresentation";

export interface AgentGitCommitBoxProps {
  readonly message: string;
  readonly busy: AgentGitBusy;
  readonly canCommit: boolean;
  readonly amend: AgentGitAmendView;
  onMessageChange(message: string): void;
  onGenerate(): void;
  onCommit(): void;
  onCommitAndPush(): void;
  onCheckAmend(): void;
  onAmendChange(active: boolean): void;
}

export function AgentGitCommitBox(props: AgentGitCommitBoxProps) {
  const { amend } = props;
  const idle = props.busy === "idle";
  const disabled = !idle || !props.canCommit;
  const amendDisabled = !idle || props.message.trim().length === 0;
  return (
    <div className={amend.active ? "cv-git-box cv-git-box--amending" : "cv-git-box"}>
      {amend.active && (
        <div className="cv-git-box__amend">
          <History aria-hidden="true" size={12} />
          <span className="cv-git-box__amend-text">
            Amending <span className="cv-git-box__sha">{amend.shortSha}</span>
          </span>
          <IconButton
            disabled={!idle}
            icon={<X size={12} />}
            label="Stop amending"
            onClick={() => props.onAmendChange(false)}
            size="xs"
          />
        </div>
      )}
      {amend.active && !props.canCommit && (
        <p className="cv-git-box__hint">{AMEND_MESSAGE_ONLY_HINT}</p>
      )}
      <textarea
        aria-label="Commit message"
        className="cv-git-box__message"
        onChange={(event) => props.onMessageChange(event.currentTarget.value)}
        placeholder={amend.active ? "Commit message" : "Leave empty to auto-generate"}
        rows={3}
        value={props.message}
      />
      <div className="cv-git-box__foot">
        <button
          className="cv-git-box__generate"
          disabled={!idle}
          onClick={props.onGenerate}
          title="Generate message"
          type="button"
        >
          <Sparkles aria-hidden="true" size={12} />
          Generate
        </button>
        <span className="cv-git-box__end">
          <span className="cv-git-box__split">
            {amend.active ? (
              <Button disabled={amendDisabled} onClick={props.onCommit} size="sm" variant="primary">
                {props.busy === "amending" ? "Amending…" : "Amend commit"}
              </Button>
            ) : (
              <Button disabled={disabled} onClick={props.onCommit} size="sm">
                Commit
              </Button>
            )}
            <AgentGitCommitOptionsMenu
              amend={amend}
              disabled={!idle}
              onAmendChange={props.onAmendChange}
              onCheckAmend={props.onCheckAmend}
            />
          </span>
          {!amend.active && (
            <Button
              disabled={disabled}
              icon={<CloudUpload size={14} />}
              onClick={props.onCommitAndPush}
              size="sm"
              variant="primary"
            >
              {primaryLabel(props.busy)}
            </Button>
          )}
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
    case "amending":
      return "Committing…";
    case "pushing":
      return "Pushing…";
    default: {
      const exhaustive: never = busy;
      return exhaustive;
    }
  }
}
