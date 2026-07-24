import type { NodePackageScript } from "../domain/nodePackageScripts";
import {
  nodePackageTaskIsActive,
  type NodePackageTaskState,
} from "../application/nodePackageTaskLifecycle";

export interface NodePackageScriptsPanelSource {
  readonly available: boolean;
  readonly pending: boolean;
  readonly scripts: readonly NodePackageScript[];
  readonly task: NodePackageTaskState | null;
  readonly total: number;
}

export interface NodePackageScriptPanelRow {
  readonly active: boolean;
  readonly canRun: boolean;
  readonly canStop: boolean;
  readonly id: string;
  readonly manager: NodePackageScript["packageManager"];
  readonly script: NodePackageScript;
  readonly status: string | null;
}

export interface NodePackageScriptPanelGroup {
  readonly description: string;
  readonly id: string;
  readonly label: string;
  readonly manifestRelativePath: string;
  readonly rows: readonly NodePackageScriptPanelRow[];
}

export interface NodePackageScriptsPanelModel {
  readonly activeTask: {
    readonly label: string;
    readonly status: string;
  } | null;
  readonly groups: readonly NodePackageScriptPanelGroup[];
  readonly running: boolean;
  readonly shown: number;
  readonly total: number;
}

export function presentNodePackageScriptsPanel({
  available,
  pending,
  scripts,
  task,
  total,
}: NodePackageScriptsPanelSource): NodePackageScriptsPanelModel {
  const running = nodePackageTaskIsActive(task);
  const groups = new Map<
    string,
    {
      readonly group: Omit<NodePackageScriptPanelGroup, "rows">;
      readonly rows: NodePackageScriptPanelRow[];
    }
  >();

  for (const script of scripts) {
    let entry = groups.get(script.manifestRelativePath);
    if (!entry) {
      entry = {
        group: {
          description:
            script.packageRootRelativePath === ""
              ? script.manifestRelativePath
              : `${script.packageRootRelativePath} · ${script.manifestRelativePath}`,
          id: `node-package-group:${encodeURIComponent(script.manifestRelativePath)}`,
          label:
            script.packageName ??
            (script.packageRootRelativePath === ""
              ? "Workspace root"
              : script.packageRootRelativePath),
          manifestRelativePath: script.manifestRelativePath,
        },
        rows: [],
      };
      groups.set(script.manifestRelativePath, entry);
    }

    const active = taskMatchesScript(task, script);
    entry.rows.push({
      active,
      canRun: available && !pending && !running,
      // The application callback is idempotent and retryable. Keep Stop actionable while the
      // owner is stopping so a rejected backend stop can be requested again.
      canStop: active && running,
      id: script.key,
      manager: script.packageManager,
      script,
      status: active && task ? taskStatus(task) : null,
    });
  }

  const presentedGroups = [...groups.values()]
    .sort((left, right) => compareManifestPaths(left.group, right.group))
    .map(({ group, rows }) => ({
      ...group,
      rows: rows.sort((left, right) =>
        compareText(left.script.scriptName, right.script.scriptName),
      ),
    }));

  return {
    activeTask:
      running && task
        ? {
            label: `${task.manifestRelativePath} · ${task.scriptName}`,
            status: taskStatus(task),
          }
        : null,
    groups: presentedGroups,
    running,
    shown: scripts.length,
    total: Math.max(total, scripts.length),
  };
}

function taskMatchesScript(task: NodePackageTaskState | null, script: NodePackageScript): boolean {
  return (
    task !== null &&
    task.manifestRelativePath === script.manifestRelativePath &&
    task.scriptName === script.scriptName
  );
}

function taskStatus(task: NodePackageTaskState): string {
  switch (task.status) {
    case "acquiring-terminal":
      return "Waiting for terminal";
    case "starting":
      return "Starting";
    case "running":
      return "Running";
    case "stopping":
      return "Stopping";
    case "failed":
      return `Failed: ${task.message}`;
    case "stopped":
      return "Stopped";
    case "exited":
      return task.exitCode === null ? "Exited" : `Exited (${task.exitCode})`;
  }
}

function compareManifestPaths(
  left: Pick<NodePackageScriptPanelGroup, "manifestRelativePath">,
  right: Pick<NodePackageScriptPanelGroup, "manifestRelativePath">,
): number {
  if (left.manifestRelativePath === "package.json") return -1;
  if (right.manifestRelativePath === "package.json") return 1;
  return compareText(left.manifestRelativePath, right.manifestRelativePath);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
