import {
  parseAgentMcpServerCommandLine,
  type AgentMcpServerCommandLineIssue,
} from "./agentMcpServerCommandLine";
import {
  agentMcpServerConfigNameIssue,
  agentMcpServerLaunchUrlIssue,
  type AgentMcpServerAddition,
  type AgentMcpServerConfigNameIssue,
  type AgentMcpServerConfigScope,
  type AgentMcpServerLaunch,
  type AgentMcpServerLaunchKind,
  type AgentMcpServerUrlIssue,
} from "./agentMcpServerManagement";
import type { AgentCliKind } from "./agentTask";

export interface AgentMcpServerDraft {
  readonly name: string;
  readonly launch: AgentMcpServerLaunchKind;
  readonly target: string;
  readonly scope: AgentMcpServerConfigScope;
}

export type AgentMcpServerDraftNameIssue = AgentMcpServerConfigNameIssue | "taken";

export type AgentMcpServerDraftTargetIssue =
  | { readonly kind: "url"; readonly issue: AgentMcpServerUrlIssue }
  | { readonly kind: "command"; readonly issue: AgentMcpServerCommandLineIssue }
  | { readonly kind: "launch"; readonly issue: "unsupported" };

export type AgentMcpServerDraftOutcome =
  | { readonly kind: "valid"; readonly change: AgentMcpServerAddition }
  | {
      readonly kind: "invalid";
      readonly name: AgentMcpServerDraftNameIssue | null;
      readonly target: AgentMcpServerDraftTargetIssue | null;
    };

type Launch =
  | { readonly kind: "launch"; readonly launch: AgentMcpServerLaunch }
  | { readonly kind: "issue"; readonly issue: AgentMcpServerDraftTargetIssue };

const CLAUDE_LAUNCH_KINDS: ReadonlyArray<AgentMcpServerLaunchKind> = ["http", "sse", "stdio"];
const CODEX_LAUNCH_KINDS: ReadonlyArray<AgentMcpServerLaunchKind> = ["http", "stdio"];
const CLAUDE_SCOPES: ReadonlyArray<AgentMcpServerConfigScope> = ["local", "user"];
const CODEX_SCOPES: ReadonlyArray<AgentMcpServerConfigScope> = ["user"];

export function agentMcpServerDraftLaunchKinds(
  provider: AgentCliKind,
): ReadonlyArray<AgentMcpServerLaunchKind> {
  switch (provider) {
    case "claudeCode":
      return CLAUDE_LAUNCH_KINDS;
    case "codex":
      return CODEX_LAUNCH_KINDS;
    default: {
      const unreachable: never = provider;
      return unreachable;
    }
  }
}

export function agentMcpServerDraftScopes(
  provider: AgentCliKind,
): ReadonlyArray<AgentMcpServerConfigScope> {
  switch (provider) {
    case "claudeCode":
      return CLAUDE_SCOPES;
    case "codex":
      return CODEX_SCOPES;
    default: {
      const unreachable: never = provider;
      return unreachable;
    }
  }
}

export function emptyAgentMcpServerDraft(provider: AgentCliKind): AgentMcpServerDraft {
  return Object.freeze({
    name: "",
    launch: "http",
    target: "",
    scope: agentMcpServerDraftScopes(provider)[0] ?? "user",
  });
}

export function agentMcpServerDraftOutcome(
  provider: AgentCliKind,
  draft: AgentMcpServerDraft,
  configuredNames: ReadonlyArray<string>,
): AgentMcpServerDraftOutcome {
  const name = nameIssue(draft.name, configuredNames);
  const launch = draftLaunch(provider, draft);
  if (name !== null || launch.kind === "issue")
    return Object.freeze({
      kind: "invalid",
      name,
      target: launch.kind === "issue" ? launch.issue : null,
    });
  return Object.freeze({
    kind: "valid",
    change: Object.freeze({
      kind: "add",
      name: draft.name,
      scope: draftScope(provider, draft.scope),
      launch: launch.launch,
    }),
  });
}

function nameIssue(
  name: string,
  configuredNames: ReadonlyArray<string>,
): AgentMcpServerDraftNameIssue | null {
  const issue = agentMcpServerConfigNameIssue(name);
  if (issue !== null) return issue;
  return configuredNames.includes(name) ? "taken" : null;
}

function draftScope(
  provider: AgentCliKind,
  scope: AgentMcpServerConfigScope,
): AgentMcpServerConfigScope {
  const scopes = agentMcpServerDraftScopes(provider);
  if (scopes.includes(scope)) return scope;
  return scopes[0] ?? "user";
}

function draftLaunch(provider: AgentCliKind, draft: AgentMcpServerDraft): Launch {
  if (!agentMcpServerDraftLaunchKinds(provider).includes(draft.launch))
    return { kind: "issue", issue: { kind: "launch", issue: "unsupported" } };
  switch (draft.launch) {
    case "http":
    case "sse":
      return urlLaunch(draft.launch, draft.target.trim());
    case "stdio":
      return commandLaunch(draft.target);
    default: {
      const unreachable: never = draft.launch;
      return unreachable;
    }
  }
}

function urlLaunch(kind: "http" | "sse", url: string): Launch {
  const issue = agentMcpServerLaunchUrlIssue(url);
  if (issue !== null) return { kind: "issue", issue: { kind: "url", issue } };
  return { kind: "launch", launch: Object.freeze({ kind, url }) };
}

function commandLaunch(text: string): Launch {
  const line = parseAgentMcpServerCommandLine(text);
  if (line.kind === "invalid")
    return { kind: "issue", issue: { kind: "command", issue: line.issue } };
  return {
    kind: "launch",
    launch: Object.freeze({ kind: "stdio", command: line.command, args: line.args }),
  };
}
