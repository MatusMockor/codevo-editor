import { useState, type FormEvent, type ReactNode } from "react";
import type {
  AgentMcpServerActivity,
  AgentMcpServerSignInPage,
} from "../../../application/agentMcpServerManagementStore";
import { agentMcpServerCallbackUrlIssue } from "../../../domain/agentMcpServerManagement";
import type { AgentCliKind } from "../../../domain/agentTask";
import { Button } from "../../../ui/foundation/Button";
import { TextField } from "../../../ui/foundation/TextField";
import {
  MCP_CANCEL_LABEL,
  MCP_CHECK_AGAIN_LABEL,
  MCP_DISMISS_LABEL,
  MCP_FINISH_SIGN_IN_LABEL,
  MCP_OPEN_PAGE_AGAIN_LABEL,
  MCP_PAGE_BLOCKED_TEXT,
  MCP_PASTE_EXPLANATION,
  MCP_PASTE_FIELD_LABEL,
  MCP_TRY_AGAIN_LABEL,
  mcpActivityErrorMessage,
  mcpActivityStatusText,
  mcpCallbackIssueMessage,
  mcpSignInPageLabel,
} from "./mcpServerManagementPresentation";

export interface McpServerActivityPanelProps {
  readonly activity: AgentMcpServerActivity;
  readonly provider: AgentCliKind;
  readonly retry: (() => void) | null;
  onCancel(): void;
  onCheckAgain(): void;
  onOpenPage(): void;
  onSubmitCallback(callbackUrl: string): void;
}

export function McpServerActivityPanel(props: McpServerActivityPanelProps) {
  const { activity } = props;
  if (activity.kind === "idle") return null;
  return (
    <div className="settings-mcp-activity" data-mcp-activity={activity.kind}>
      <McpActivityStatus activity={activity} />
      <McpActivityBody {...props} />
    </div>
  );
}

function McpActivityStatus({ activity }: { readonly activity: AgentMcpServerActivity }) {
  const text = mcpActivityStatusText(activity);
  if (text === null) return null;
  return (
    <p className="settings-row__description" role="status">
      {text}
    </p>
  );
}

function McpActivityBody({
  activity,
  onCancel,
  onCheckAgain,
  onOpenPage,
  onSubmitCallback,
  provider,
  retry,
}: McpServerActivityPanelProps) {
  switch (activity.kind) {
    case "idle":
    case "changing":
    case "succeeded":
      return null;
    case "starting":
    case "submittingCallback":
      return (
        <McpActivityActions>
          <CancelButton label={MCP_CANCEL_LABEL} onCancel={onCancel} />
        </McpActivityActions>
      );
    case "waitingForBrowser":
      return (
        <>
          <McpSignInPage host={activity.signInHost} page={activity.page} />
          {activity.delivery === "paste" ? (
            <McpCallbackForm
              onSubmit={onSubmitCallback}
              rejection={
                activity.callbackError === null
                  ? null
                  : mcpActivityErrorMessage(activity.mode, activity.callbackError, provider)
              }
            />
          ) : null}
          <McpActivityActions>
            <Button onClick={onOpenPage} size="sm">
              {MCP_OPEN_PAGE_AGAIN_LABEL}
            </Button>
            <CancelButton label={MCP_CANCEL_LABEL} onCancel={onCancel} />
          </McpActivityActions>
        </>
      );
    case "finishInBrowser":
      return (
        <>
          <McpSignInPage host={activity.signInHost} page={activity.page} />
          <McpActivityActions>
            <Button disabled={activity.checking} onClick={onCheckAgain} size="sm">
              {MCP_CHECK_AGAIN_LABEL}
            </Button>
            <Button disabled={activity.checking} onClick={onOpenPage} size="sm" variant="ghost">
              {MCP_OPEN_PAGE_AGAIN_LABEL}
            </Button>
            {activity.checking ? null : (
              <CancelButton label={MCP_CANCEL_LABEL} onCancel={onCancel} />
            )}
          </McpActivityActions>
        </>
      );
    case "failed":
      return (
        <>
          <p className="settings-row__description settings-mcp-activity__problem" role="alert">
            {mcpActivityErrorMessage(activity.action, activity.error, provider)}
          </p>
          <McpActivityActions>
            {retry === null ? null : (
              <Button onClick={retry} size="sm">
                {MCP_TRY_AGAIN_LABEL}
              </Button>
            )}
            <CancelButton label={MCP_DISMISS_LABEL} onCancel={onCancel} />
          </McpActivityActions>
        </>
      );
    default: {
      const unreachable: never = activity;
      return unreachable;
    }
  }
}

function McpActivityActions({ children }: { readonly children: ReactNode }) {
  return <div className="settings-mcp-activity__actions">{children}</div>;
}

function CancelButton({ label, onCancel }: { readonly label: string; onCancel(): void }) {
  return (
    <Button onClick={onCancel} size="sm" variant="ghost">
      {label}
    </Button>
  );
}

function McpSignInPage({
  host,
  page,
}: {
  readonly host: string;
  readonly page: AgentMcpServerSignInPage;
}) {
  return (
    <>
      {page === "blocked" ? (
        <p className="settings-row__description settings-mcp-activity__problem" role="alert">
          {MCP_PAGE_BLOCKED_TEXT}
        </p>
      ) : null}
      <p className="settings-row__description settings-mcp-activity__page">
        {mcpSignInPageLabel(host)}
      </p>
    </>
  );
}

function McpCallbackForm({
  onSubmit,
  rejection,
}: {
  readonly rejection: string | null;
  onSubmit(callbackUrl: string): void;
}) {
  const [text, setText] = useState("");
  const issue = agentMcpServerCallbackUrlIssue(text);
  const problem = issue === null ? null : mcpCallbackIssueMessage(issue);
  const error = problem ?? (text.length === 0 ? rejection : null);
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (issue !== null) return;
    onSubmit(text);
  };
  return (
    <form className="settings-mcp-callback" noValidate onSubmit={submit}>
      <p className="settings-row__description">{MCP_PASTE_EXPLANATION}</p>
      <TextField
        autoComplete="off"
        error={error ?? undefined}
        label={MCP_PASTE_FIELD_LABEL}
        mono
        onChange={setText}
        spellCheck={false}
        value={text}
      />
      <div className="settings-mcp-activity__actions">
        <Button disabled={issue !== null} size="sm" type="submit" variant="primary">
          {MCP_FINISH_SIGN_IN_LABEL}
        </Button>
      </div>
    </form>
  );
}
