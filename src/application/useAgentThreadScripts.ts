import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentTaskIsolation } from "../domain/agentTask";
import type { NodePackageScript } from "../domain/nodePackageScripts";

export const MAX_AGENT_THREAD_SCRIPT_ENTRIES = 64;
export const AGENT_SCRIPT_WORKTREE_BLOCKED_REASON = "Runs in the main checkout only";
export const AGENT_SCRIPT_WORKTREE_MISSING_REASON = "The worktree no longer exists";
export const AGENT_SCRIPT_BUSY_REASON = "Another script is already running";
const SCRIPT_RUNNER_ACCEPTS_WORKTREE_CWD = false;
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
  run(script: NodePackageScript): boolean;
  stop(): void;
}

interface AgentThreadScriptOwner {
  readonly runId: string;
  readonly threadId: string;
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
  target,
  workspaceRoot,
}: UseAgentThreadScriptsOptions): AgentThreadScriptsSurface {
  const [preferredByRepository, setPreferredByRepository] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const [owner, setOwner] = useState<AgentThreadScriptOwner | null>(null);
  const startedByRef = useRef<string | null>(null);
  const repositoryRoot = target?.repositoryRoot ?? null;
  const threadId = target?.threadId ?? null;
  const activeRunId = runner.active?.runId ?? null;

  useEffect(() => {
    if (activeRunId === null) {
      startedByRef.current = null;
      setOwner(null);
      return;
    }
    const startedBy = startedByRef.current;
    startedByRef.current = null;
    setOwner((current) =>
      current !== null && current.runId === activeRunId
        ? current
        : startedBy === null
          ? null
          : { runId: activeRunId, threadId: startedBy },
    );
  }, [activeRunId]);

  const ownedByThread =
    owner !== null &&
    activeRunId !== null &&
    owner.runId === activeRunId &&
    owner.threadId === threadId;
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
    const activeKey =
      scoped.scripts.find(
        (script) =>
          script.scriptName === runner.active?.scriptName &&
          script.manifestRelativePath === runner.active?.manifestRelativePath,
      )?.key ?? null;
    return {
      kind: "running",
      key: activeKey,
      label: runner.active.scriptName,
      stoppable: ownedByThread,
      reason: ownedByThread ? null : AGENT_SCRIPT_BUSY_REASON,
    };
  }, [ownedByThread, runner.active, scoped.scripts]);

  const runScript = useCallback(
    (key: string): boolean => {
      if (runner.active !== null) return false;
      if (threadId === null) return false;
      const script = scoped.scripts.find((candidate) => candidate.key === key);
      if (script === undefined) return false;
      if (availability.kind === "blocked") return false;
      if (repositoryRoot !== null) {
        setPreferredByRepository((current) => new Map(current).set(repositoryRoot, key));
      }
      onBeforeRun();
      startedByRef.current = threadId;
      const started = runner.run(script);
      if (!started) {
        startedByRef.current = null;
      }
      return started;
    },
    [availability, onBeforeRun, repositoryRoot, runner, scoped.scripts, threadId],
  );

  const stopScript = useCallback(() => {
    if (!ownedByThread) return;
    runner.stop();
  }, [ownedByThread, runner]);

  return {
    entries,
    preferred,
    truncated: scoped.truncated || runner.truncated,
    run,
    runScript,
    stopScript,
  };
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

export function preferredEntry(
  entries: ReadonlyArray<AgentThreadScriptEntry>,
  rememberedKey: string | null,
): AgentThreadScriptEntry | null {
  const remembered = entries.find((entry) => entry.key === rememberedKey);
  if (remembered !== undefined) return remembered;
  for (const name of PREFERRED_SCRIPT_NAMES) {
    const match = entries.find((entry) => entry.label === name);
    if (match !== undefined) return match;
  }
  return entries[0] ?? null;
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
  if (target.isolation === "worktree" && !SCRIPT_RUNNER_ACCEPTS_WORKTREE_CWD) {
    return blocked(AGENT_SCRIPT_WORKTREE_BLOCKED_REASON);
  }
  return { kind: "available" };
}

function scriptEntry(
  script: NodePackageScript,
  availability: AgentThreadScriptAvailability,
): AgentThreadScriptEntry {
  return {
    key: script.key,
    label: script.scriptName,
    detail: script.packageRootRelativePath === "" ? null : script.packageRootRelativePath,
    availability,
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
