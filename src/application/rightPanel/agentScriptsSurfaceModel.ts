import {
  vscodeProcessTaskIdentity,
  type VscodeProcessTaskIdentity,
} from "../../domain/vscodeProcessTasks";
import {
  AGENT_SCRIPT_BUSY_REASON,
  type AgentThreadScriptDetailEntry,
  type AgentThreadScriptOutcome,
  type AgentThreadScripts,
} from "../useAgentThreadScripts";
import type { VscodeProcessTasksState } from "../useVscodeProcessTasks";

export const ROOT_SCRIPTS_MANIFEST = "package.json";
export const PROJECT_ACTION_BUSY_REASON = "Another action is running";
export const PROJECT_ACTION_NOT_RUNNABLE_REASON = "This action cannot run from here";

export type AgentScriptRowState =
  | { readonly kind: "idle" }
  | { readonly kind: "running"; readonly stoppable: boolean }
  | { readonly kind: "exited"; readonly exitCode: number | null }
  | { readonly kind: "failed"; readonly message: string };

export interface AgentScriptRow {
  readonly key: string;
  readonly name: string;
  readonly command: string | null;
  readonly state: AgentScriptRowState;
  readonly blockedReason: string | null;
}

export interface AgentScriptsManifest {
  readonly relativePath: string;
  readonly label: string;
}

export type AgentProjectActionsSource = Pick<
  VscodeProcessTasksState,
  "tasks" | "activeLabel" | "running" | "occupied" | "stopping" | "unavailable"
>;

export type AgentProjectActionState =
  { readonly kind: "idle" } | { readonly kind: "running"; readonly stopping: boolean };

export interface AgentProjectActionRow {
  readonly id: string;
  readonly label: string;
  readonly detail: string | null;
  readonly identity: VscodeProcessTaskIdentity | null;
  readonly state: AgentProjectActionState;
  readonly blockedReason: string | null;
}

export function agentScriptManifests(
  entries: ReadonlyArray<AgentThreadScriptDetailEntry>,
): ReadonlyArray<AgentScriptsManifest> {
  const paths = [...new Set(entries.map((entry) => entry.manifestRelativePath))];
  return paths
    .sort(compareManifests)
    .map((relativePath) => ({ relativePath, label: relativePath }));
}

export function defaultAgentScriptsManifest(
  manifests: ReadonlyArray<AgentScriptsManifest>,
): string | null {
  return manifests[0]?.relativePath ?? null;
}

export function agentScriptRows(
  scripts: AgentThreadScripts,
  manifest: string | null,
): ReadonlyArray<AgentScriptRow> {
  return scripts.entries
    .filter((entry) => entry.manifestRelativePath === manifest)
    .map((entry) => ({
      key: entry.key,
      name: entry.label,
      command: entry.command,
      state: scriptState(scripts, entry.key),
      blockedReason: blockedReason(scripts, entry),
    }));
}

export function agentProjectActionRows(
  source: AgentProjectActionsSource,
): ReadonlyArray<AgentProjectActionRow> {
  const busy = source.running || source.occupied || source.stopping;
  return source.tasks.map((task) => {
    const identity = task.executable ? vscodeProcessTaskIdentity(task) : null;
    const active = busy && source.activeLabel === task.label;
    return {
      id: `${task.package}\u0000${task.label}`,
      label: task.label,
      detail: task.detail ?? (task.package === "." ? null : task.package),
      identity,
      state: active ? { kind: "running", stopping: source.stopping } : { kind: "idle" },
      blockedReason: actionBlockedReason(source, identity, busy, active),
    };
  });
}

function scriptState(scripts: AgentThreadScripts, key: string): AgentScriptRowState {
  if (scripts.run.kind === "running" && scripts.run.key === key) {
    return { kind: "running", stoppable: scripts.run.stoppable };
  }
  const outcome = scripts.outcomes.get(key);
  if (outcome === undefined) return { kind: "idle" };
  return outcomeState(outcome);
}

function outcomeState(outcome: AgentThreadScriptOutcome): AgentScriptRowState {
  switch (outcome.kind) {
    case "exited":
      return { kind: "exited", exitCode: outcome.exitCode };
    case "failed":
      return { kind: "failed", message: outcome.message };
    case "stopped":
      return { kind: "idle" };
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

function blockedReason(
  scripts: AgentThreadScripts,
  entry: AgentThreadScriptDetailEntry,
): string | null {
  if (entry.availability.kind === "blocked") return entry.availability.reason;
  if (scripts.run.kind === "running" && scripts.run.key !== entry.key) {
    return scripts.run.reason ?? AGENT_SCRIPT_BUSY_REASON;
  }
  return null;
}

function actionBlockedReason(
  source: AgentProjectActionsSource,
  identity: VscodeProcessTaskIdentity | null,
  busy: boolean,
  active: boolean,
): string | null {
  if (source.unavailable !== null) return source.unavailable;
  if (identity === null) return PROJECT_ACTION_NOT_RUNNABLE_REASON;
  if (busy && !active) return PROJECT_ACTION_BUSY_REASON;
  return null;
}

function compareManifests(left: string, right: string): number {
  if (left === ROOT_SCRIPTS_MANIFEST) return -1;
  if (right === ROOT_SCRIPTS_MANIFEST) return 1;
  return left.localeCompare(right);
}
