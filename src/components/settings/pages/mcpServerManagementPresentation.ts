import type {
  AgentMcpServerActivity,
  AgentMcpServerActivityAction,
  AgentMcpServerActivityError,
  AgentMcpServerSignInPage,
} from "../../../application/agentMcpServerManagementStore";
import type { AgentMcpServerCommandLineIssue } from "../../../domain/agentMcpServerCommandLine";
import type {
  AgentMcpServerDraftNameIssue,
  AgentMcpServerDraftTargetIssue,
} from "../../../domain/agentMcpServerDraft";
import type {
  AgentMcpServerCallbackUrlIssue,
  AgentMcpServerChangeKind,
  AgentMcpServerConfigScope,
  AgentMcpServerLaunchKind,
  AgentMcpServerUrlIssue,
} from "../../../domain/agentMcpServerManagement";
import type { AgentCliKind } from "../../../domain/agentTask";
import { agentProviderLabel } from "../../agentMode/agentSidebarPresentation";

export const MCP_SIGN_IN_LABEL = "Sign in";
export const MCP_SIGN_IN_AGAIN_LABEL = "Sign in again";
export const MCP_SIGN_OUT_LABEL = "Sign out";
export const MCP_REMOVE_MENU_LABEL = "Remove…";
export const MCP_REMOVE_LABEL = "Remove";
export const MCP_CANCEL_LABEL = "Cancel";
export const MCP_DISMISS_LABEL = "Dismiss";
export const MCP_TRY_AGAIN_LABEL = "Try again";
export const MCP_OPEN_PAGE_AGAIN_LABEL = "Open page again";
export const MCP_CHECK_AGAIN_LABEL = "Check again";
export const MCP_FINISH_SIGN_IN_LABEL = "Finish sign-in";
export const MCP_ADD_SERVER_LABEL = "Add server";
export const MCP_ADD_MENU_LABEL = "Add an MCP server to";
export const MCP_OPENING_PAGE_TEXT = "Opening the sign-in page…";
export const MCP_FINISH_IN_BROWSER_TEXT = "Finish signing in in your browser.";
export const MCP_PAGE_BLOCKED_TEXT = "The sign-in page did not open.";
export const MCP_FINISHING_TEXT = "Finishing sign-in…";
export const MCP_CONNECT_IN_BROWSER_TEXT = "Finish connecting in your browser, then check again.";
export const MCP_CHECKING_TEXT = "Checking…";
export const MCP_PASTE_EXPLANATION =
  "After you approve, your browser will try to open an address that starts with http://localhost and fail to load it. Copy that address from the address bar and paste it here.";
export const MCP_PASTE_FIELD_LABEL = "Address from the browser";
export const MCP_ADD_NAME_LABEL = "Name";
export const MCP_ADD_NAME_HINT = "Letters, digits, hyphens and underscores.";
export const MCP_ADD_TYPE_LABEL = "Type";
export const MCP_ADD_URL_LABEL = "URL";
export const MCP_ADD_COMMAND_LABEL = "Command";
export const MCP_ADD_COMMAND_HINT =
  "The program and its arguments. Variables and wildcards are not expanded.";
export const MCP_ADD_SCOPE_LABEL = "Available in";
export const MCP_ADD_CODEX_SCOPE_NOTE = "Codex servers apply to all projects.";
export const MCP_ADD_BUSY_TEXT =
  "Another change to this server is still running. Try again in a moment.";
export const MCP_FULL_TEXT = "Too many MCP changes are still in progress. Try again in a moment.";
export const MCP_ADDING_LABEL = "Adding…";

export function mcpSignInToLabel(serverName: string): string {
  return `Sign in to ${serverName}`;
}

export function mcpMoreActionsLabel(serverName: string): string {
  return `More actions for ${serverName}`;
}

export function mcpSignInPageLabel(signInHost: string): string {
  return `Sign-in page: ${signInHost}`;
}

export function mcpAddServerButtonLabel(provider: AgentCliKind): string {
  return `Add ${agentProviderLabel(provider)} MCP server`;
}

export function mcpRemoveTitle(serverName: string): string {
  return `Remove ${serverName}?`;
}

export function mcpRemoveDescription(
  scope: AgentMcpServerConfigScope,
  provider: AgentCliKind,
): string {
  const label = agentProviderLabel(provider);
  switch (scope) {
    case "user":
      return `It will be removed from your ${label} configuration for all projects.`;
    case "local":
      return `It will be removed from your ${label} configuration for this project.`;
    case "project":
      return "It will be removed from this project's shared configuration.";
    default: {
      const unreachable: never = scope;
      return unreachable;
    }
  }
}

export function mcpLaunchKindLabel(kind: AgentMcpServerLaunchKind): string {
  switch (kind) {
    case "http":
      return "HTTP";
    case "sse":
      return "SSE";
    case "stdio":
      return "Command";
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

export function mcpAddScopeLabel(scope: AgentMcpServerConfigScope): string {
  switch (scope) {
    case "local":
      return "This project";
    case "user":
      return "All projects";
    case "project":
      return "Shared with the project";
    default: {
      const unreachable: never = scope;
      return unreachable;
    }
  }
}

export function mcpChangingText(change: AgentMcpServerChangeKind): string {
  switch (change) {
    case "add":
      return MCP_ADDING_LABEL;
    case "remove":
      return "Removing…";
    case "signOut":
      return "Signing out…";
    default: {
      const unreachable: never = change;
      return unreachable;
    }
  }
}

export function mcpSucceededText(action: AgentMcpServerActivityAction): string {
  switch (action) {
    case "signIn":
    case "signInAgain":
      return "Signed in. Checking the server…";
    case "signOut":
      return "Signed out. Checking the server…";
    case "remove":
      return "Removed. Checking servers…";
    case "add":
      return "Added. Checking servers…";
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}

export function mcpActivityStatusText(activity: AgentMcpServerActivity): string | null {
  switch (activity.kind) {
    case "idle":
    case "failed":
      return null;
    case "starting":
      return MCP_OPENING_PAGE_TEXT;
    case "waitingForBrowser":
      return signInPageText(activity.page, MCP_FINISH_IN_BROWSER_TEXT);
    case "finishInBrowser":
      return activity.checking
        ? MCP_CHECKING_TEXT
        : signInPageText(activity.page, MCP_CONNECT_IN_BROWSER_TEXT);
    case "submittingCallback":
      return MCP_FINISHING_TEXT;
    case "changing":
      return mcpChangingText(activity.change);
    case "succeeded":
      return mcpSucceededText(activity.action);
    default: {
      const unreachable: never = activity;
      return unreachable;
    }
  }
}

export function mcpActivityErrorMessage(
  action: AgentMcpServerActivityAction,
  error: AgentMcpServerActivityError,
  provider: AgentCliKind,
): string {
  const label = agentProviderLabel(provider);
  switch (error) {
    case "unknownWorkspace":
      return "This project is not open in Codevo. Open it, then try again.";
    case "untrustedWorkspace":
      return "This project is not trusted. Trust it to manage its MCP servers.";
    case "providerDisabled":
      return `${label} is turned off in Providers settings.`;
    case "busy":
      return "Another MCP check or change is running for this project. Try again in a moment.";
    case "timedOut":
      return `${label} did not answer in time.`;
    case "unavailable":
      return unavailableMessage(action);
    case "unsupportedRunner":
      return "This server's runner does not support managing MCP servers yet. Update the runner on the server.";
    case "serverUnavailable":
      return "Could not reach the server. Check the connection, then try again.";
    case "invalidRequest":
      return `${label} did not accept this request.`;
    case "serverExists":
      return "A server with this name is already configured.";
    case "serverNotFound":
      return "This server is no longer configured. Check the servers again.";
    case "changeUnsupported":
      return "This server cannot be changed from Codevo.";
    case "loginUnsupported":
      return "This server does not support sign-in.";
    case "loginInactive":
      return "The sign-in is no longer active. Start it again.";
    case "callbackRejected":
      return "The sign-in did not accept this address. Copy the full address from the browser and try again.";
    case "loginFailed":
      return "Sign-in did not complete.";
    case "loginExpired":
      return "Sign-in was not finished in time.";
    default: {
      const unreachable: never = error;
      return unreachable;
    }
  }
}

export function mcpCallbackIssueMessage(issue: AgentMcpServerCallbackUrlIssue): string | null {
  switch (issue) {
    case "empty":
      return null;
    case "tooLong":
      return "This address is too long.";
    case "notLoopback":
      return "The address must start with http://localhost or http://127.0.0.1.";
    case "missingResult":
      return "This address has no sign-in result. Copy the full address from the address bar.";
    case "invalid":
      return "This is not a valid address.";
    default: {
      const unreachable: never = issue;
      return unreachable;
    }
  }
}

export function mcpNameIssueMessage(issue: AgentMcpServerDraftNameIssue | null): string | null {
  switch (issue) {
    case null:
    case "empty":
      return null;
    case "tooLong":
      return "Use at most 64 characters.";
    case "invalid":
      return "Use letters, digits, hyphens and underscores, and do not start with a hyphen.";
    case "taken":
      return "A server with this name is already configured.";
    default: {
      const unreachable: never = issue;
      return unreachable;
    }
  }
}

export function mcpTargetIssueMessage(issue: AgentMcpServerDraftTargetIssue | null): string | null {
  if (issue === null) return null;
  switch (issue.kind) {
    case "url":
      return urlIssueMessage(issue.issue);
    case "command":
      return commandIssueMessage(issue.issue);
    case "launch":
      return "This type is not available for this provider.";
    default: {
      const unreachable: never = issue;
      return unreachable;
    }
  }
}

function signInPageText(page: AgentMcpServerSignInPage, opened: string): string | null {
  switch (page) {
    case "opening":
      return MCP_OPENING_PAGE_TEXT;
    case "opened":
      return opened;
    case "blocked":
      return null;
    default: {
      const unreachable: never = page;
      return unreachable;
    }
  }
}

function unavailableMessage(action: AgentMcpServerActivityAction): string {
  switch (action) {
    case "signIn":
    case "signInAgain":
      return "Sign-in could not be completed.";
    case "signOut":
      return "Could not sign out.";
    case "remove":
      return "Could not remove the server.";
    case "add":
      return "Could not add the server.";
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}

function urlIssueMessage(issue: AgentMcpServerUrlIssue): string | null {
  switch (issue) {
    case "empty":
      return null;
    case "tooLong":
      return "This address is too long.";
    case "whitespace":
      return "The address cannot contain spaces.";
    case "notHttp":
      return "The address must start with http:// or https://.";
    case "credentials":
      return "The address cannot include a user name or password.";
    case "invalid":
      return "Enter a valid address.";
    default: {
      const unreachable: never = issue;
      return unreachable;
    }
  }
}

function commandIssueMessage(issue: AgentMcpServerCommandLineIssue): string | null {
  switch (issue) {
    case "empty":
      return null;
    case "tooLong":
      return "This command is too long.";
    case "unbalancedQuote":
      return "Close the open quote.";
    case "danglingEscape":
      return "The command cannot end with a backslash.";
    case "controlCharacter":
      return "The command cannot contain control characters.";
    case "commandTooLong":
      return "The program name is too long.";
    case "tooManyArguments":
      return "Use at most 32 arguments.";
    case "argumentTooLong":
      return "One of the arguments is too long.";
    default: {
      const unreachable: never = issue;
      return unreachable;
    }
  }
}
