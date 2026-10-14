import {
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleSlash,
  Copy,
  KeyRound,
  LoaderCircle,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type {
  AgentMcpServerActivity,
  AgentMcpServerManagementStore,
  AgentMcpServerOperationStart,
} from "../../../application/agentMcpServerManagementStore";
import { useAgentMcpServerActivity } from "../../../application/useAgentMcpServerManagement";
import {
  NO_AGENT_MCP_SERVER_ACTIONS,
  agentMcpServerActions,
  agentMcpServerOffersMenu,
  type AgentMcpServerActions,
} from "../../../domain/agentMcpServerActions";
import type {
  AgentMcpServerConfigScope,
  AgentMcpServerLoginMode,
} from "../../../domain/agentMcpServerManagement";
import type { AgentMcpServer, AgentMcpServerStatus } from "../../../domain/agentMcpServers";
import type { AgentMcpServersTarget } from "../../../domain/agentMcpServersTarget";
import type { AgentCliKind } from "../../../domain/agentTask";
import { Button } from "../../../ui/foundation/Button";
import { IconButton } from "../../../ui/foundation/IconButton";
import { McpServerActionsMenu } from "./McpServerActionsMenu";
import { McpServerActivityPanel } from "./McpServerActivityPanel";
import {
  MCP_FULL_TEXT,
  MCP_SIGN_IN_LABEL,
  mcpSignInToLabel,
} from "./mcpServerManagementPresentation";
import {
  mcpCopySignInLabel,
  mcpServerSignInHintCommand,
  mcpServerStatusLabel,
  mcpServerStatusTone,
  mcpSignInLead,
  type McpProjectPlace,
} from "./mcpServersPresentation";

export type McpServerTitleTag = "h3" | "h5";

export interface McpServerRowProps {
  readonly management: AgentMcpServerManagementStore | null;
  readonly place: McpProjectPlace;
  readonly provider: AgentCliKind;
  readonly secondary: string | null;
  readonly server: AgentMcpServer;
  readonly target: AgentMcpServersTarget | null;
  readonly title: string;
  readonly titleTag: McpServerTitleTag;
  onCopy(command: string): void;
}

const FOCUSABLE = "button:not(:disabled), input:not(:disabled)";

export function McpServerRow({
  management,
  onCopy,
  place,
  provider,
  secondary,
  server,
  target,
  title,
  titleTag: Title,
}: McpServerRowProps) {
  const controls = useMemo(
    () => (management === null || target === null ? null : rowControls(management, target, server)),
    [management, target, server],
  );
  const actions = useMemo(
    () =>
      controls === null ? NO_AGENT_MCP_SERVER_ACTIONS : agentMcpServerActions(provider, server),
    [controls, provider, server],
  );
  const activity = useAgentMcpServerActivity(management, target, server.name);
  const rowRef = useRef<HTMLDivElement | null>(null);
  useRowFocusRecovery(rowRef, activity.kind);
  const signInCommand = mcpServerSignInHintCommand(
    provider,
    server,
    controls === null ? "unsupported" : "supported",
  );
  const StatusIcon = statusIcon(server.status);
  const idle = activity.kind === "idle";
  const [full, setFull] = useState(false);
  const attempt = (start: AgentMcpServerOperationStart): void => setFull(start === "full");
  return (
    <div
      className="settings-row settings-mcp-server"
      data-mcp-active={idle ? undefined : ""}
      data-mcp-server={server.name}
      ref={rowRef}
    >
      <div className="settings-row__text">
        <div className="settings-row__head">
          <Title className="settings-row__title">{title}</Title>
        </div>
        {secondary === null ? null : <p className="settings-row__description">{secondary}</p>}
        {server.detail === null ? null : (
          <p className="settings-row__description settings-mcp-server__detail">{server.detail}</p>
        )}
        {signInCommand === null ? null : (
          <McpSignInHint
            command={signInCommand}
            lead={mcpSignInLead(place)}
            name={server.name}
            onCopy={onCopy}
          />
        )}
        {controls === null ? null : (
          <McpServerActivityPanel
            activity={activity}
            onCancel={controls.cancel}
            onCheckAgain={controls.checkAgain}
            onOpenPage={controls.openPage}
            onSubmitCallback={controls.submitCallback}
            provider={provider}
            retry={retryOf(activity, actions, controls, attempt)}
          />
        )}
        {full && idle ? (
          <p className="settings-row__description settings-mcp-activity__problem" role="alert">
            {MCP_FULL_TEXT}
          </p>
        ) : null}
      </div>
      <div className="settings-row__control">
        <span className="settings-mcp-status" data-tone={mcpServerStatusTone(server.status)}>
          <StatusIcon aria-hidden="true" size={14} />
          {mcpServerStatusLabel(server.status)}
        </span>
        {controls !== null && idle && actions.signIn ? (
          <Button
            aria-label={mcpSignInToLabel(server.name)}
            className="settings-mcp-server__signin"
            onClick={() => attempt(controls.signIn("signIn"))}
            size="sm"
            variant="primary"
          >
            {MCP_SIGN_IN_LABEL}
          </Button>
        ) : null}
        {controls !== null && idle && agentMcpServerOffersMenu(actions) ? (
          <McpServerActionsMenu
            actions={actions}
            name={server.name}
            onRemove={(scope) => attempt(controls.remove(scope))}
            onSignInAgain={() => attempt(controls.signIn("signInAgain"))}
            onSignOut={() => attempt(controls.signOut())}
            provider={provider}
          />
        ) : (
          <span aria-hidden="true" className="settings-mcp-server__menu" data-mcp-menu-slot="" />
        )}
      </div>
    </div>
  );
}

interface RowControls {
  signIn(mode: AgentMcpServerLoginMode): AgentMcpServerOperationStart;
  signOut(): AgentMcpServerOperationStart;
  remove(scope: AgentMcpServerConfigScope): AgentMcpServerOperationStart;
  cancel(): void;
  checkAgain(): void;
  openPage(): void;
  submitCallback(callbackUrl: string): void;
}

function rowControls(
  management: AgentMcpServerManagementStore,
  target: AgentMcpServersTarget,
  server: Pick<AgentMcpServer, "name">,
): RowControls {
  const name = server.name;
  return {
    signIn: (mode) => management.signIn(target, name, mode),
    signOut: () => management.change(target, { kind: "signOut", name }),
    remove: (scope) => management.change(target, { kind: "remove", name, scope }),
    cancel: () => management.cancel(target, name),
    checkAgain: () => management.checkAgain(target, name),
    openPage: () => management.openSignInPage(target, name),
    submitCallback: (callbackUrl) => management.submitCallback(target, name, callbackUrl),
  };
}

function retryOf(
  activity: AgentMcpServerActivity,
  actions: AgentMcpServerActions,
  controls: RowControls,
  attempt: (start: AgentMcpServerOperationStart) => void,
): (() => void) | null {
  if (activity.kind !== "failed") return null;
  const action = activity.action;
  const scope = actions.removeFrom;
  switch (action) {
    case "signIn":
    case "signInAgain":
      return () => attempt(controls.signIn(action));
    case "signOut":
      return () => attempt(controls.signOut());
    case "remove":
      return scope === null ? null : () => attempt(controls.remove(scope));
    case "add":
      return null;
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}

function useRowFocusRecovery(
  rowRef: RefObject<HTMLElement | null>,
  activityKind: AgentMcpServerActivity["kind"],
): void {
  const shown = useRef(activityKind);
  useEffect(() => {
    if (shown.current === activityKind) return;
    shown.current = activityKind;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    rowRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });
  }, [activityKind, rowRef]);
}

function McpSignInHint({
  command,
  lead,
  name,
  onCopy,
}: {
  readonly command: string;
  readonly lead: string;
  readonly name: string;
  onCopy(command: string): void;
}) {
  return (
    <p className="settings-row__description settings-mcp-signin">
      <span>{lead}</span>
      <code>{command}</code>
      <IconButton
        icon={<Copy aria-hidden="true" size={12} />}
        label={mcpCopySignInLabel(name)}
        onClick={() => onCopy(command)}
        size="xs"
      />
    </p>
  );
}

function statusIcon(status: AgentMcpServerStatus): LucideIcon {
  switch (status) {
    case "connected":
      return CircleCheck;
    case "connecting":
      return LoaderCircle;
    case "needsAuth":
      return KeyRound;
    case "failed":
      return CircleAlert;
    case "disabled":
      return CircleSlash;
    case "unknown":
      return CircleHelp;
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}
