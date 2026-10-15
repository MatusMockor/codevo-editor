import type { TerminalGateway } from "../../domain/terminal";
import type { FileEntry } from "../../domain/workspace";
import type {
  ProjectRuntimeStopResult,
  WorkspaceRuntimeLifecycleGateway,
} from "../../domain/workspaceRuntimeLifecycle";

export const SCRIPTS_WORKSPACE_ROOT_ENTRY_LIMIT = 512;
export const SCRIPTS_WORKSPACE_NESTED_DEPTH = 2;
export const SCRIPTS_WORKSPACE_NESTED_DIRECTORY_LIMIT = 64;

const SCRIPTS_WORKSPACE_SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  "node_modules",
  "vendor",
]);

const SCRIPTS_WORKSPACE_MARKERS: ReadonlySet<string> = new Set([
  "jsconfig.json",
  "package.json",
  "tsconfig.json",
]);

export type AgentScriptsWorkspace = "javaScriptTypeScript" | "none" | "unknown";

export interface AgentWorkspaceRuntimeGateways {
  readonly runtimeLifecycle: Pick<WorkspaceRuntimeLifecycleGateway, "disposeWorkspace">;
  readonly terminal: Pick<TerminalGateway, "stopRoot">;
}

export interface AgentScriptsWorkspaceReader {
  readDirectoryBounded(
    path: string,
    maxEntries: number,
  ): Promise<{ readonly entries: readonly FileEntry[]; readonly truncated: boolean }>;
}

export interface AgentWorkspaceRuntimeStopRequest {
  readonly isCurrent: () => boolean;
  readonly reportError: (error: unknown) => void;
  readonly rootPath: string;
}

export async function stopAgentWorkspaceRuntimes(
  gateways: AgentWorkspaceRuntimeGateways,
  { isCurrent, reportError, rootPath }: AgentWorkspaceRuntimeStopRequest,
): Promise<ProjectRuntimeStopResult> {
  if (!isCurrent()) return "stale";
  try {
    await gateways.runtimeLifecycle.disposeWorkspace(rootPath);
    return isCurrent() ? "stopped" : "stale";
  } catch (error) {
    if (!isCurrent()) return "stale";
    reportError(error);
  }

  if (!isCurrent()) return "stale";
  try {
    await gateways.terminal.stopRoot(rootPath);
  } catch (error) {
    if (!isCurrent()) return "stale";
    reportError(error);
  }
  return isCurrent() ? "incomplete" : "stale";
}

export function scriptsWorkspaceFromRootEntries(
  entries: readonly FileEntry[],
  truncated: boolean,
): AgentScriptsWorkspace {
  const hasMarker = entries.some(
    (entry) => entry.kind === "file" && SCRIPTS_WORKSPACE_MARKERS.has(entry.name),
  );
  if (hasMarker) return "javaScriptTypeScript";
  if (truncated) return "unknown";
  return "none";
}

export async function detectAgentScriptsWorkspace(
  reader: AgentScriptsWorkspaceReader,
  rootPath: string,
): Promise<AgentScriptsWorkspace> {
  const listing = await reader.readDirectoryBounded(rootPath, SCRIPTS_WORKSPACE_ROOT_ENTRY_LIMIT);
  const root = scriptsWorkspaceFromRootEntries(listing.entries, listing.truncated);
  if (root !== "none") return root;

  let pending = nestedScriptDirectories(listing.entries, 1);
  let budget = SCRIPTS_WORKSPACE_NESTED_DIRECTORY_LIMIT;
  let incomplete = false;
  while (pending.length > 0) {
    const next: Array<{ readonly path: string; readonly depth: number }> = [];
    for (const directory of pending) {
      if (budget === 0) return "unknown";
      budget -= 1;
      const nested = await reader.readDirectoryBounded(
        directory.path,
        SCRIPTS_WORKSPACE_ROOT_ENTRY_LIMIT,
      );
      const detected = scriptsWorkspaceFromRootEntries(nested.entries, nested.truncated);
      if (detected === "javaScriptTypeScript") return detected;
      if (detected === "unknown") incomplete = true;
      if (directory.depth < SCRIPTS_WORKSPACE_NESTED_DEPTH) {
        next.push(...nestedScriptDirectories(nested.entries, directory.depth + 1));
      }
    }
    pending = next;
  }
  return incomplete ? "unknown" : "none";
}

function nestedScriptDirectories(
  entries: readonly FileEntry[],
  depth: number,
): Array<{ readonly path: string; readonly depth: number }> {
  return entries
    .filter(
      (entry) =>
        entry.kind === "directory" &&
        !entry.name.startsWith(".") &&
        !SCRIPTS_WORKSPACE_SKIPPED_DIRECTORIES.has(entry.name),
    )
    .map((entry) => ({ path: entry.path, depth }));
}

export function scriptsWorkspaceHasJavaScriptTypeScript(workspace: AgentScriptsWorkspace): boolean {
  switch (workspace) {
    case "javaScriptTypeScript":
    case "unknown":
      return true;
    case "none":
      return false;
    default: {
      const unsupported: never = workspace;
      return unsupported;
    }
  }
}
