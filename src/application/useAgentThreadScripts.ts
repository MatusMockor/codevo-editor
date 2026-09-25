import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentTaskIsolation } from "../domain/agentTask";
import type { NodePackageScript, NodePackageTaskLaunchTarget } from "../domain/nodePackageScripts";
import type { NodePackageTaskState } from "./nodePackageTaskLifecycle";

export const MAX_AGENT_THREAD_SCRIPT_ENTRIES = 64;
export const MAX_AGENT_THREAD_SCRIPT_OUTCOMES = 64;
export const AGENT_SCRIPT_WORKTREE_MISSING_REASON = "The worktree no longer exists";
export const AGENT_SCRIPT_BUSY_REASON = "Another script is already running";
const PREFERRED_SCRIPT_NAMES: ReadonlyArray<string> = ["dev", "start", "test"];

export interface AgentThreadScriptTarget {
  readonly threadId: string;
  readonly repositoryRoot: string;
  readonly isolation: AgentTaskIsolation;
  readonly worktreePath: string | null;
  readonly worktreeMissing: boolean;
}

export type AgentThreadScriptAvailability =
  { readonly kind: "available" } | { readonly kind: "blocked"; readonly reason: string };

export interface AgentThreadScriptEntry {
  readonly key: string;
  readonly label: string;
  readonly detail: string | null;
  readonly availability: AgentThreadScriptAvailability;
}

export interface AgentThreadScriptDetailEntry extends AgentThreadScriptEntry {
  readonly manifestRelativePath: string;
  readonly command: string;
}

export type AgentThreadScriptOutcome =
  | { readonly kind: "exited"; readonly exitCode: number | null }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "stopped" };

export interface AgentThreadScriptRunnerOutcome {
  readonly runId: string;
  readonly scriptName: string;
  readonly manifestRelativePath: string;
  readonly outcome: AgentThreadScriptOutcome;
}

export type AgentThreadScriptRunState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "running";
      readonly key: string | null;
      readonly label: string;
      readonly stoppable: boolean;
      readonly reason: string | null;
    };

export interface AgentThreadScriptsSurface {
  readonly entries: ReadonlyArray<AgentThreadScriptEntry>;
  readonly preferred: AgentThreadScriptEntry | null;
  readonly truncated: boolean;
  readonly run: AgentThreadScriptRunState;
  runScript(key: string): boolean;
  stopScript(): void;
}

export interface AgentThreadScripts extends AgentThreadScriptsSurface {
  readonly entries: ReadonlyArray<AgentThreadScriptDetailEntry>;
  readonly preferred: AgentThreadScriptDetailEntry | null;
  readonly outcomes: ReadonlyMap<string, AgentThreadScriptOutcome>;
}

export interface AgentThreadScriptRunner {
  readonly scripts: ReadonlyArray<NodePackageScript>;
  readonly truncated: boolean;
  readonly available: boolean;
  readonly unavailableReason: string | null;
  readonly active: {
    readonly runId: string;
    readonly scriptName: string;
    readonly manifestRelativePath: string;
  } | null;
  readonly lastOutcome?: AgentThreadScriptRunnerOutcome | null;
  run(
    script: NodePackageScript,
    target: NodePackageTaskLaunchTarget,
    repositoryRoot: string,
  ): boolean;
  stop(): void;
}

interface AgentThreadScriptStarter {
  readonly threadId: string;
  readonly workspaceRoot: string;
}

interface AgentThreadScriptIdentity {
  readonly scriptName: string;
  readonly manifestRelativePath: string;
}

interface AgentThreadScriptRunIntent {
  readonly starter: AgentThreadScriptStarter;
  readonly script: AgentThreadScriptIdentity;
  readonly previousOutcomeRunId: string | null;
  readonly runId: string | null;
}

export interface UseAgentThreadScriptsOptions {
  readonly target: AgentThreadScriptTarget | null;
  readonly workspaceRoot: string | null;
  readonly runner: AgentThreadScriptRunner;
  onBeforeRun(): void;
}

export function useAgentThreadScripts({
  onBeforeRun,
  runner,
  target: requestedTarget,
  workspaceRoot,
}: UseAgentThreadScriptsOptions): AgentThreadScripts {
  const target = useStableScriptTarget(requestedTarget);
  const [preferredByRepository, setPreferredByRepository] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const [intent, setIntent] = useState<AgentThreadScriptRunIntent | null>(null);
  const [recorded, setRecorded] = useState<ReadonlyMap<string, AgentThreadScriptOutcome>>(
    () => new Map(),
  );
  const repositoryRoot = target?.repositoryRoot ?? null;
  const threadId = target?.threadId ?? null;
  const activeRunId = runner.active?.runId ?? null;
  const runnerOutcome = runner.lastOutcome ?? null;
  const runnerScripts = runner.scripts;
  const ownedRunId = intent === null ? null : intendedRunId(intent, activeRunId, runnerOutcome);

  useEffect(() => {
    if (intent === null || ownedRunId === null) return;
    if (runnerOutcome !== null && runnerOutcome.runId === ownedRunId) {
      setIntent(null);
      const key = scriptKey(runnerScripts, runnerOutcome);
      if (key === null) return;
      setRecorded((current) =>
        withOutcome(current, outcomeKey(intent.starter, key), runnerOutcome.outcome),
      );
      return;
    }
    if (activeRunId !== ownedRunId) {
      setIntent(null);
      return;
    }
    if (intent.runId !== ownedRunId) setIntent({ ...intent, runId: ownedRunId });
  }, [activeRunId, intent, ownedRunId, runnerOutcome, runnerScripts]);

  const ownedByThread =
    intent !== null &&
    activeRunId !== null &&
    ownedRunId === activeRunId &&
    intent.starter.threadId === threadId;
  const foreignRun = activeRunId !== null && !ownedByThread;

  const scoped = useMemo(
    () => scopedScripts(runner.scripts, workspaceRoot, repositoryRoot),
    [repositoryRoot, runner.scripts, workspaceRoot],
  );

  const availability = useMemo(
    () => targetAvailability(target, runner.available, runner.unavailableReason, foreignRun),
    [foreignRun, runner.available, runner.unavailableReason, target],
  );

  const entries = useMemo(
    () => scoped.scripts.map((script) => scriptEntry(script, availability)),
    [availability, scoped.scripts],
  );

  const remembered = repositoryRoot === null ? null : preferredByRepository.get(repositoryRoot);
  const preferred = useMemo(
    () => preferredEntry(entries, remembered ?? null),
    [entries, remembered],
  );

  const run = useMemo<AgentThreadScriptRunState>(() => {
    if (runner.active === null) return { kind: "idle" };
    const activeKey = scriptKey(scoped.scripts, runner.active);
    return {
      kind: "running",
      key: activeKey,
      label: runner.active.scriptName,
      stoppable: ownedByThread,
      reason: ownedByThread ? null : AGENT_SCRIPT_BUSY_REASON,
    };
  }, [ownedByThread, runner.active, scoped.scripts]);

  const outcomes = useMemo(
    () => threadOutcomes(recorded, scoped.scripts, threadId, workspaceRoot),
    [recorded, scoped.scripts, threadId, workspaceRoot],
  );

  const runScript = useCallback(
    (key: string): boolean => {
      if (runner.active !== null) return false;
      if (threadId === null) return false;
      if (target === null) return false;
      const script = scoped.scripts.find((candidate) => candidate.key === key);
      if (script === undefined) return false;
      if (availability.kind === "blocked") return false;
      if (workspaceRoot === null) return false;
      if (repositoryRoot !== null) {
        setPreferredByRepository((current) => new Map(current).set(repositoryRoot, key));
      }
      onBeforeRun();
      const starter = { threadId, workspaceRoot };
      const started = runner.run(script, launchTarget(target), target.repositoryRoot);
      if (!started) return false;
      setIntent({
        starter,
        script: {
          scriptName: script.scriptName,
          manifestRelativePath: script.manifestRelativePath,
        },
        previousOutcomeRunId: runner.lastOutcome?.runId ?? null,
        runId: null,
      });
      setRecorded((current) => withoutOutcome(current, outcomeKey(starter, key)));
      return true;
    },
    [
      availability,
      onBeforeRun,
      repositoryRoot,
      runner,
      scoped.scripts,
      target,
      threadId,
      workspaceRoot,
    ],
  );

  const stopScript = useCallback(() => {
    if (!ownedByThread) return;
    runner.stop();
  }, [ownedByThread, runner]);

  const truncated = scoped.truncated || runner.truncated;
  return useMemo(
    () => ({ entries, preferred, truncated, run, outcomes, runScript, stopScript }),
    [entries, outcomes, preferred, run, runScript, stopScript, truncated],
  );
}

export function agentScriptRunnerOutcome(
  task: NodePackageTaskState | null,
): AgentThreadScriptRunnerOutcome | null {
  if (task === null) return null;
  const outcome = settledOutcome(task);
  if (outcome === null) return null;
  return {
    runId: task.runId,
    scriptName: task.scriptName,
    manifestRelativePath: task.manifestRelativePath,
    outcome,
  };
}

function settledOutcome(task: NodePackageTaskState): AgentThreadScriptOutcome | null {
  switch (task.status) {
    case "exited":
      return { kind: "exited", exitCode: task.exitCode };
    case "failed":
      return { kind: "failed", message: task.message };
    case "stopped":
      return { kind: "stopped" };
    case "acquiring-terminal":
    case "starting":
    case "running":
    case "stopping":
      return null;
    default: {
      const exhaustive: never = task;
      return exhaustive;
    }
  }
}

function intendedRunId(
  intent: AgentThreadScriptRunIntent,
  activeRunId: string | null,
  outcome: AgentThreadScriptRunnerOutcome | null,
): string | null {
  if (intent.runId !== null) return intent.runId;
  if (activeRunId !== null) return activeRunId;
  if (outcome === null || outcome.runId === intent.previousOutcomeRunId) return null;
  if (outcome.scriptName !== intent.script.scriptName) return null;
  if (outcome.manifestRelativePath !== intent.script.manifestRelativePath) return null;
  return outcome.runId;
}

function outcomeKey(starter: AgentThreadScriptStarter, key: string): string {
  return `${starter.workspaceRoot}\u0000${starter.threadId}\u0000${key}`;
}

function withOutcome(
  current: ReadonlyMap<string, AgentThreadScriptOutcome>,
  key: string,
  outcome: AgentThreadScriptOutcome,
): ReadonlyMap<string, AgentThreadScriptOutcome> {
  const next = new Map(current);
  next.delete(key);
  next.set(key, outcome);
  while (next.size > MAX_AGENT_THREAD_SCRIPT_OUTCOMES) {
    const oldest = next.keys().next().value;
    if (oldest === undefined) break;
    next.delete(oldest);
  }
  return next;
}

function withoutOutcome(
  current: ReadonlyMap<string, AgentThreadScriptOutcome>,
  key: string,
): ReadonlyMap<string, AgentThreadScriptOutcome> {
  if (!current.has(key)) return current;
  const next = new Map(current);
  next.delete(key);
  return next;
}

function threadOutcomes(
  recorded: ReadonlyMap<string, AgentThreadScriptOutcome>,
  scripts: ReadonlyArray<NodePackageScript>,
  threadId: string | null,
  workspaceRoot: string | null,
): ReadonlyMap<string, AgentThreadScriptOutcome> {
  const outcomes = new Map<string, AgentThreadScriptOutcome>();
  if (threadId === null || workspaceRoot === null) return outcomes;
  for (const script of scripts) {
    const outcome = recorded.get(outcomeKey({ threadId, workspaceRoot }, script.key));
    if (outcome !== undefined) outcomes.set(script.key, outcome);
  }
  return outcomes;
}

export function projectScriptTarget(repositoryRoot: string): AgentThreadScriptTarget {
  return {
    threadId: `project:${repositoryRoot}`,
    repositoryRoot,
    isolation: "in-place",
    worktreePath: null,
    worktreeMissing: false,
  };
}

function scriptKey(
  scripts: ReadonlyArray<NodePackageScript>,
  identity: { readonly scriptName: string; readonly manifestRelativePath: string },
): string | null {
  return (
    scripts.find(
      (script) =>
        script.scriptName === identity.scriptName &&
        script.manifestRelativePath === identity.manifestRelativePath,
    )?.key ?? null
  );
}

export function scopedScripts(
  scripts: ReadonlyArray<NodePackageScript>,
  workspaceRoot: string | null,
  repositoryRoot: string | null,
): { readonly scripts: ReadonlyArray<NodePackageScript>; readonly truncated: boolean } {
  if (workspaceRoot === null || repositoryRoot === null) return { scripts: [], truncated: false };
  const root = trimSlashes(workspaceRoot);
  const repository = trimSlashes(repositoryRoot);
  const matching = scripts.filter((script) =>
    isWithin(packageRoot(root, script.packageRootRelativePath), repository),
  );
  return {
    scripts: matching.slice(0, MAX_AGENT_THREAD_SCRIPT_ENTRIES),
    truncated: matching.length > MAX_AGENT_THREAD_SCRIPT_ENTRIES,
  };
}

export function preferredEntry<Entry extends AgentThreadScriptEntry>(
  entries: ReadonlyArray<Entry>,
  rememberedKey: string | null,
): Entry | null {
  const remembered = entries.find((entry) => entry.key === rememberedKey);
  if (remembered !== undefined) return remembered;
  for (const name of PREFERRED_SCRIPT_NAMES) {
    const match = entries.find((entry) => entry.label === name);
    if (match !== undefined) return match;
  }
  return entries[0] ?? null;
}

function useStableScriptTarget(
  target: AgentThreadScriptTarget | null,
): AgentThreadScriptTarget | null {
  const threadId = target?.threadId ?? null;
  const repositoryRoot = target?.repositoryRoot ?? null;
  const isolation = target?.isolation ?? null;
  const worktreePath = target?.worktreePath ?? null;
  const worktreeMissing = target?.worktreeMissing ?? false;
  return useMemo(() => {
    if (threadId === null || repositoryRoot === null || isolation === null) return null;
    return { threadId, repositoryRoot, isolation, worktreePath, worktreeMissing };
  }, [isolation, repositoryRoot, threadId, worktreeMissing, worktreePath]);
}

function targetAvailability(
  target: AgentThreadScriptTarget | null,
  available: boolean,
  unavailableReason: string | null,
  foreignRun: boolean,
): AgentThreadScriptAvailability {
  if (target === null) return blocked("Select a thread first");
  if (!available) return blocked(unavailableReason ?? "Scripts are unavailable");
  if (foreignRun) return blocked(AGENT_SCRIPT_BUSY_REASON);
  if (target.worktreeMissing) return blocked(AGENT_SCRIPT_WORKTREE_MISSING_REASON);
  return { kind: "available" };
}

function launchTarget(target: AgentThreadScriptTarget): NodePackageTaskLaunchTarget {
  if (target.isolation === "in-place") return { kind: "workspaceRoot" };
  return { kind: "agentWorktree", threadId: target.threadId };
}

function scriptEntry(
  script: NodePackageScript,
  availability: AgentThreadScriptAvailability,
): AgentThreadScriptDetailEntry {
  return {
    key: script.key,
    label: script.scriptName,
    detail: script.packageRootRelativePath === "" ? null : script.packageRootRelativePath,
    availability,
    manifestRelativePath: script.manifestRelativePath,
    command: `${script.packageManager} run ${script.scriptName}`,
  };
}

function blocked(reason: string): AgentThreadScriptAvailability {
  return { kind: "blocked", reason };
}

function packageRoot(workspaceRoot: string, relative: string): string {
  const trimmed = trimSlashes(relative);
  if (trimmed === "") return workspaceRoot;
  return `${workspaceRoot}/${trimmed}`;
}

function isWithin(path: string, root: string): boolean {
  if (path === root) return true;
  return path.startsWith(`${root}/`);
}

function trimSlashes(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}
