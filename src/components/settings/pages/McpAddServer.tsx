import { Plus } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";
import type {
  AgentMcpServerActivityError,
  AgentMcpServerManagementStore,
} from "../../../application/agentMcpServerManagementStore";
import { useAgentMcpServerActivity } from "../../../application/useAgentMcpServerManagement";
import {
  agentMcpServerDraftLaunchKinds,
  agentMcpServerDraftOutcome,
  agentMcpServerDraftScopes,
  emptyAgentMcpServerDraft,
  type AgentMcpServerDraft,
} from "../../../domain/agentMcpServerDraft";
import type { AgentMcpServersTarget } from "../../../domain/agentMcpServersTarget";
import type { AgentCliKind } from "../../../domain/agentTask";
import { Button } from "../../../ui/foundation/Button";
import { Dialog } from "../../../ui/foundation/Dialog";
import { SegmentedControl } from "../../../ui/foundation/SegmentedControl";
import { TextField } from "../../../ui/foundation/TextField";
import {
  MCP_ADDING_LABEL,
  MCP_ADD_BUSY_TEXT,
  MCP_ADD_CODEX_SCOPE_NOTE,
  MCP_ADD_COMMAND_HINT,
  MCP_ADD_COMMAND_LABEL,
  MCP_ADD_NAME_HINT,
  MCP_ADD_NAME_LABEL,
  MCP_ADD_SCOPE_LABEL,
  MCP_ADD_SERVER_LABEL,
  MCP_ADD_TYPE_LABEL,
  MCP_ADD_URL_LABEL,
  MCP_CANCEL_LABEL,
  MCP_FULL_TEXT,
  mcpActivityErrorMessage,
  mcpAddScopeLabel,
  mcpAddServerButtonLabel,
  mcpLaunchKindLabel,
  mcpNameIssueMessage,
  mcpTargetIssueMessage,
} from "./mcpServerManagementPresentation";

export interface McpAddServerProps {
  readonly configuredNames: ReadonlyArray<string>;
  readonly management: AgentMcpServerManagementStore;
  readonly provider: AgentCliKind;
  readonly target: AgentMcpServersTarget;
}

type AddOwner = Pick<McpAddServerProps, "management" | "provider" | "target">;

export function McpAddServer({ configuredNames, management, provider, target }: McpAddServerProps) {
  const [owner, setOwner] = useState<AddOwner | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  return (
    <>
      <Button
        aria-label={mcpAddServerButtonLabel(provider)}
        icon={<Plus aria-hidden="true" size={14} />}
        onClick={(event) => {
          openerRef.current = event.currentTarget;
          setOwner({ management, provider, target });
        }}
        size="sm"
        variant="ghost"
      >
        {MCP_ADD_SERVER_LABEL}
      </Button>
      {owner === null ? null : (
        <McpAddServerDialog
          configuredNames={configuredNames}
          management={owner.management}
          onClose={() => setOwner(null)}
          provider={owner.provider}
          returnFocusRef={openerRef}
          target={owner.target}
        />
      )}
    </>
  );
}

interface McpAddServerDialogProps extends McpAddServerProps {
  readonly returnFocusRef: RefObject<HTMLElement | null>;
  onClose(): void;
}

function McpAddServerDialog({
  configuredNames,
  management,
  onClose,
  provider,
  returnFocusRef,
  target,
}: McpAddServerDialogProps) {
  const formId = useId();
  const [draft, setDraft] = useState(() => emptyAgentMcpServerDraft(provider));
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [refused, setRefused] = useState<"busy" | "full" | null>(null);
  const activity = useAgentMcpServerActivity(management, target, submitted);
  const outcome = useMemo(
    () => agentMcpServerDraftOutcome(provider, draft, configuredNames),
    [provider, draft, configuredNames],
  );
  const adding = submitted !== null && activity.kind === "changing";
  const failure = submitted !== null && activity.kind === "failed" ? activity : null;
  const finished = submitted !== null && !adding && failure === null;
  useEffect(() => {
    if (finished) onClose();
  }, [finished, onClose]);

  const forget = (): void => {
    if (submitted !== null && failure !== null) management.cancel(target, submitted);
    setSubmitted(null);
    setRefused(null);
  };
  const edit = (patch: Partial<AgentMcpServerDraft>): void => {
    if (adding) return;
    forget();
    setDraft((current) => ({ ...current, ...patch }));
  };
  const close = (): void => {
    if (!adding) forget();
    onClose();
  };
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (outcome.kind !== "valid" || adding) return;
    const started = management.change(target, outcome.change);
    setRefused(started === "started" ? null : started);
    setSubmitted(started === "started" ? outcome.change.name : null);
  };

  const scopes = agentMcpServerDraftScopes(provider);
  const problem = addProblem(failure?.error ?? null, refused, provider);
  const invalid = outcome.kind === "invalid" ? outcome : null;
  return (
    <Dialog
      footer={
        <>
          <Button onClick={close}>{MCP_CANCEL_LABEL}</Button>
          <Button
            aria-busy={adding || undefined}
            disabled={outcome.kind !== "valid" || adding}
            form={formId}
            type="submit"
            variant="primary"
          >
            {adding ? MCP_ADDING_LABEL : MCP_ADD_SERVER_LABEL}
          </Button>
        </>
      }
      onClose={close}
      open
      returnFocusRef={returnFocusRef}
      title={mcpAddServerButtonLabel(provider)}
      width="sm"
    >
      <form className="settings-mcp-add" id={formId} noValidate onSubmit={submit}>
        <TextField
          autoComplete="off"
          disabled={adding}
          error={mcpNameIssueMessage(invalid?.name ?? null) ?? undefined}
          hint={MCP_ADD_NAME_HINT}
          label={MCP_ADD_NAME_LABEL}
          mono
          onChange={(name) => edit({ name })}
          spellCheck={false}
          value={draft.name}
        />
        <div className="cv-field">
          <span className="cv-field__label">{MCP_ADD_TYPE_LABEL}</span>
          <SegmentedControl
            label={MCP_ADD_TYPE_LABEL}
            onChange={(launch) => edit({ launch })}
            options={agentMcpServerDraftLaunchKinds(provider).map((value) => ({
              label: mcpLaunchKindLabel(value),
              value,
            }))}
            value={draft.launch}
          />
        </div>
        <TextField
          autoComplete="off"
          disabled={adding}
          error={mcpTargetIssueMessage(invalid?.target ?? null) ?? undefined}
          hint={draft.launch === "stdio" ? MCP_ADD_COMMAND_HINT : undefined}
          label={draft.launch === "stdio" ? MCP_ADD_COMMAND_LABEL : MCP_ADD_URL_LABEL}
          mono
          onChange={(value) => edit({ target: value })}
          spellCheck={false}
          value={draft.target}
        />
        {scopes.length > 1 ? (
          <div className="cv-field">
            <span className="cv-field__label">{MCP_ADD_SCOPE_LABEL}</span>
            <SegmentedControl
              label={MCP_ADD_SCOPE_LABEL}
              onChange={(scope) => edit({ scope })}
              options={scopes.map((value) => ({ label: mcpAddScopeLabel(value), value }))}
              value={draft.scope}
            />
          </div>
        ) : (
          <p className="settings-mcp-add__note">{MCP_ADD_CODEX_SCOPE_NOTE}</p>
        )}
        {problem === null ? null : (
          <p className="settings-mcp-add__problem" role="alert">
            {problem}
          </p>
        )}
      </form>
    </Dialog>
  );
}

function addProblem(
  error: AgentMcpServerActivityError | null,
  refused: "busy" | "full" | null,
  provider: AgentCliKind,
): string | null {
  if (error !== null) return mcpActivityErrorMessage("add", error, provider);
  switch (refused) {
    case null:
      return null;
    case "busy":
      return MCP_ADD_BUSY_TEXT;
    case "full":
      return MCP_FULL_TEXT;
    default: {
      const unreachable: never = refused;
      return unreachable;
    }
  }
}
