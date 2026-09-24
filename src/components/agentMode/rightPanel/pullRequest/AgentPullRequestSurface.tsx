import { ChevronDown, ExternalLink, GitBranch, GitPullRequest } from "lucide-react";
import { useRef, useState } from "react";
import type { AgentPullRequestState } from "../../../../application/rightPanel/useAgentPullRequest";
import type { PullRequestContext, PullRequestFailure } from "../../../../domain/pullRequest";
import { Button } from "../../../../ui/foundation/Button";
import { Menu } from "../../../../ui/foundation/Menu";
import { MenuItem } from "../../../../ui/foundation/MenuItem";
import { Switch } from "../../../../ui/foundation/Switch";
import { TextArea } from "../../../../ui/foundation/TextArea";
import { TextField } from "../../../../ui/foundation/TextField";
import "./agentPullRequest.css";

const UNSUPPORTED_FORGE_NOTE = "Pull requests need a github.com or gitlab.com remote.";

export type AgentPullRequestViewState = Pick<
  AgentPullRequestState,
  | "context"
  | "base"
  | "title"
  | "body"
  | "draft"
  | "titleError"
  | "bodyError"
  | "baseError"
  | "submit"
>;

export interface AgentPullRequestSurfaceProps {
  readonly state: AgentPullRequestViewState;
  readonly baseOptions: ReadonlyArray<string>;
  readonly openError?: string | null;
  onBaseChange(base: string): void;
  onTitleChange(title: string): void;
  onBodyChange(body: string): void;
  onDraftChange(draft: boolean): void;
  onCreate(): void;
  onCancel(): void;
  onOpen(url: string): void;
  onReload(): void;
}

export function AgentPullRequestSurface(props: AgentPullRequestSurfaceProps) {
  const { state } = props;
  const context = state.context.kind === "ready" ? state.context.value : null;
  const submitting = state.submit.kind === "submitting";
  const created = state.submit.kind === "created";
  const blocked = context === null || context.forge === null;
  return (
    <section aria-label="New pull request" className="cv-pr-surface">
      <div className="cv-rp-sub">
        <div className="cv-rp-sub__grow">
          <span className="cv-pr-compare">
            <GitBranch aria-hidden="true" size={12} />
            <strong className="cv-pr-compare__head">{context?.headBranch ?? "HEAD"}</strong>
            <span aria-hidden="true">→</span>
            <BaseMenu base={state.base} onChange={props.onBaseChange} options={props.baseOptions} />
          </span>
        </div>
        {context !== null && (
          <div className="cv-rp-sub__tools">
            <span className="cv-pr-counts">
              {countLabel(context.commitsAhead, "commit")} ·{" "}
              {countLabel(context.filesChanged, "file")}
            </span>
          </div>
        )}
      </div>
      <ContextNote context={state.context} onReload={props.onReload} />
      <form className="cv-pr" onSubmit={(event) => event.preventDefault()}>
        {state.baseError !== null && (
          <p className="cv-pr__error" role="alert">
            {state.baseError}
          </p>
        )}
        <TextField
          error={state.titleError ?? undefined}
          label="Title"
          onChange={props.onTitleChange}
          value={state.title}
        />
        <div className="cv-pr__desc">
          <TextArea
            error={state.bodyError ?? undefined}
            label="Description"
            onChange={props.onBodyChange}
            value={state.body}
          />
        </div>
        <div className="cv-pr__switch">
          <span>Create as draft</span>
          <Switch checked={state.draft} label="Create as draft" onChange={props.onDraftChange} />
        </div>
      </form>
      <SubmitResult context={context} onOpen={props.onOpen} submit={state.submit} />
      {props.openError !== undefined && props.openError !== null && (
        <p className="cv-rp-note cv-rp-note--warning" role="alert">
          {props.openError}
        </p>
      )}
      <div className="cv-pr__foot">
        {context !== null && context.unpushedCommits > 0 && (
          <span className="cv-pr__note">
            Pushes {countLabel(context.unpushedCommits, "commit")} to origin first
          </span>
        )}
        <span className="cv-pr__end">
          <Button onClick={props.onCancel} size="sm">
            Cancel
          </Button>
          <Button
            disabled={submitting || created || blocked}
            icon={<GitPullRequest size={14} />}
            onClick={props.onCreate}
            size="sm"
            variant="primary"
          >
            {submitting ? "Creating…" : "Create pull request"}
          </Button>
        </span>
      </div>
    </section>
  );
}

function BaseMenu(props: {
  readonly base: string | null;
  readonly options: ReadonlyArray<string>;
  onChange(base: string): void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const label = props.base ?? "Choose base";
  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Base branch: ${label}`}
        className="cv-rp-ctl"
        onClick={() => setOpen((current) => !current)}
        ref={anchorRef}
        type="button"
      >
        {label}
        <ChevronDown aria-hidden="true" size={12} />
      </button>
      <Menu anchorRef={anchorRef} label="Base branch" onClose={() => setOpen(false)} open={open}>
        {props.options.map((option) => (
          <MenuItem
            checked={option === props.base}
            key={option}
            onSelect={() => props.onChange(option)}
          >
            {option}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

function ContextNote(props: {
  readonly context: AgentPullRequestViewState["context"];
  onReload(): void;
}) {
  switch (props.context.kind) {
    case "idle":
      return <p className="cv-rp-note">Select a repository to open a pull request.</p>;
    case "loading":
      return <p className="cv-rp-note">Reading the branch…</p>;
    case "failed":
      return (
        <p className="cv-rp-note cv-rp-note--warning" role="alert">
          {props.context.message}{" "}
          <button className="cv-rp-link" onClick={props.onReload} type="button">
            Retry
          </button>
        </p>
      );
    case "ready":
      if (props.context.value.forge !== null) return null;
      return <p className="cv-rp-note cv-rp-note--warning">{UNSUPPORTED_FORGE_NOTE}</p>;
    default: {
      const exhaustive: never = props.context;
      return exhaustive;
    }
  }
}

function SubmitResult(props: {
  readonly submit: AgentPullRequestViewState["submit"];
  readonly context: PullRequestContext | null;
  onOpen(url: string): void;
}) {
  const { submit } = props;
  if (submit.kind === "created") {
    return (
      <div className="cv-pr__result" role="status">
        <span>Pull request created</span>
        <OpenButton label="Open pull request" onOpen={props.onOpen} url={submit.receipt.url} />
      </div>
    );
  }
  if (submit.kind !== "failed") return null;
  const action = failureAction(submit.failure, props.context?.compareUrl ?? null);
  return (
    <div className="cv-pr__result cv-pr__result--failed" role="alert">
      <span>{submit.failure.message}</span>
      {action !== null && (
        <OpenButton label={action.label} onOpen={props.onOpen} url={action.url} />
      )}
    </div>
  );
}

function OpenButton(props: {
  readonly label: string;
  readonly url: string;
  onOpen(url: string): void;
}) {
  return (
    <Button icon={<ExternalLink size={12} />} onClick={() => props.onOpen(props.url)} size="sm">
      {props.label}
    </Button>
  );
}

function failureAction(
  failure: PullRequestFailure,
  compareUrl: string | null,
): { readonly label: string; readonly url: string } | null {
  if (failure.kind === "alreadyExists" && failure.url !== null) {
    return { label: "Open existing pull request", url: failure.url };
  }
  if (compareUrl === null) return null;
  return { label: "Open compare page", url: compareUrl };
}

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
