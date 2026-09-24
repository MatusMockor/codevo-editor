import { GitPullRequest, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import type { AgentGitSurfaceState } from "../../../../application/rightPanel/useAgentGitSurface";
import type { GitUnpushedCommit } from "../../../../domain/gitSurfaceStatus";
import { IconButton } from "../../../../ui/foundation/IconButton";
import { AgentGitChangesList } from "./AgentGitChangesList";
import { AgentGitCommitBox } from "./AgentGitCommitBox";
import { relativeAge } from "./agentGitPresentation";
import "./agentGit.css";

export type AgentGitSurfaceViewState = Pick<
  AgentGitSurfaceState,
  "rows" | "loading" | "error" | "summary" | "message" | "busy" | "notice"
>;

export interface AgentGitSurfaceProps {
  readonly branchControl: ReactNode;
  readonly moreMenu: ReactNode;
  readonly banner: ReactNode;
  readonly aheadCount: number | null;
  readonly behindCount: number | null;
  readonly upstreamName: string | null;
  readonly unpushed: ReadonlyArray<GitUnpushedCommit>;
  readonly nowMs: number;
  readonly state: AgentGitSurfaceViewState;
  onRowIncludedChange(relativePath: string, include: boolean): void;
  onAllIncludedChange(include: boolean): void;
  onMessageChange(message: string): void;
  onGenerate(): void;
  onCommit(): void;
  onCommitAndPush(): void;
  onFetch(): void;
  onOpenPullRequest(): void;
}

export function AgentGitSurface(props: AgentGitSurfaceProps) {
  const unpublished = props.unpushed.length > 0 || (props.aheadCount ?? 0) > 0;
  return (
    <section aria-label="Git" className="cv-git">
      <div className="cv-rp-sub">
        <div className="cv-rp-sub__grow">{props.branchControl}</div>
        <div className="cv-rp-sub__tools">
          {props.aheadCount !== null && props.behindCount !== null && (
            <span
              className="cv-git-sync"
              title={`${props.aheadCount} ahead, ${props.behindCount} behind ${props.upstreamName ?? "upstream"}`}
            >
              ↑{props.aheadCount} ↓{props.behindCount}
            </span>
          )}
          <IconButton
            icon={<RefreshCw size={14} />}
            label="Fetch"
            onClick={props.onFetch}
            size="xs"
          />
          {props.moreMenu}
        </div>
      </div>
      <div className="cv-git__body">
        {props.banner}
        <AgentGitChangesList
          error={props.state.error}
          loading={props.state.loading}
          onAllIncludedChange={props.onAllIncludedChange}
          onRowIncludedChange={props.onRowIncludedChange}
          rows={props.state.rows}
          summary={props.state.summary}
        />
        {props.unpushed.length > 0 && (
          <div className="cv-git-history">
            <div className="cv-git-head">Unpushed</div>
            {props.unpushed.map((commit) => (
              <div className="cv-git-commit" key={commit.sha} title={commit.subject}>
                <span aria-hidden="true" className="cv-git-commit__dot" />
                <span className="cv-git-commit__msg">{commit.subject}</span>
                <span className="cv-git-commit__sha">{commit.shortSha}</span>
                <span className="cv-git-commit__ago">
                  {relativeAge(commit.authoredAtEpochSeconds, props.nowMs)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="cv-git__foot">
        <AgentGitCommitBox
          busy={props.state.busy}
          canCommit={props.state.summary.included > 0}
          message={props.state.message}
          onCommit={props.onCommit}
          onCommitAndPush={props.onCommitAndPush}
          onGenerate={props.onGenerate}
          onMessageChange={props.onMessageChange}
        />
        {props.state.notice !== null && (
          <p
            className={`cv-git-notice cv-git-notice--${props.state.notice.kind}`}
            role={props.state.notice.kind === "error" ? "alert" : "status"}
          >
            {props.state.notice.text}
          </p>
        )}
        {unpublished && (
          <p className="cv-git-hint">
            Next:
            <button className="cv-git-hint__action" onClick={props.onOpenPullRequest} type="button">
              <GitPullRequest aria-hidden="true" size={12} />
              Create pull request
            </button>
          </p>
        )}
      </div>
    </section>
  );
}
