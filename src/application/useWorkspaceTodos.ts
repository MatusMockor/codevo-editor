import { useCallback, useState, type MutableRefObject } from "react";
import { extractTodoComments } from "../domain/todoComments";
import type { WorkspaceTodo } from "../domain/workspaceTodo";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { FileEntry, WorkspaceFileGateway } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

// TODO-comment scan is conservative so it never blocks the UI on large trees:
// it skips dependency / VCS / build directories, only reads source-like files,
// caps the number of files read and skips files that are too large to be hand
// written source (generated bundles, fixtures, etc.).
const WORKSPACE_TODO_MAX_FILES = 2000;
const WORKSPACE_TODO_MAX_FILE_BYTES = 512 * 1024;
const WORKSPACE_TODO_SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  ".git",
  ".hg",
  ".idea",
  ".next",
  ".nuxt",
  ".svn",
  ".turbo",
  ".vscode",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "storage",
  "target",
  "vendor",
]);
const WORKSPACE_TODO_SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  "blade.php",
  "css",
  "htm",
  "html",
  "js",
  "jsx",
  "mjs",
  "php",
  "scss",
  "ts",
  "tsx",
  "vue",
]);

function isWorkspaceTodoSourceFile(name: string): boolean {
  const fileName = name.toLowerCase();

  if (fileName.endsWith(".blade.php")) {
    return true;
  }

  const lastDot = fileName.lastIndexOf(".");

  if (lastDot <= 0) {
    return false;
  }

  return WORKSPACE_TODO_SOURCE_EXTENSIONS.has(fileName.slice(lastDot + 1));
}

/**
 * Collaborators the workspace TODO scanner/panel needs from the workbench
 * shell: the file gateway, the workspace root ref/value, and
 * `openNavigationTarget` (shared with every other navigation flow in the
 * shell). `relativeWorkspacePath` is injected too — it is a shared helper used
 * across many unrelated controller regions, so it stays shell-owned rather
 * than being duplicated here. Every piece of TODO-panel-local state (the
 * panel toggle and the scanned list) is owned by this hook.
 */
export interface WorkspaceTodosDependencies {
  workspaceFiles: WorkspaceFileGateway;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  workspaceRoot: string | null;
  openNavigationTarget: (
    path: string,
    position: EditorPosition,
    label: string,
  ) => Promise<boolean>;
  relativeWorkspacePath: (workspaceRoot: string, path: string) => string;
}

export interface WorkspaceTodos {
  todoPanelOpen: boolean;
  workspaceTodos: WorkspaceTodo[];
  workspaceTodosLoading: boolean;
  refreshWorkspaceTodos: () => Promise<void>;
  openWorkspaceTodo: (todo: WorkspaceTodo) => Promise<boolean>;
  openTodoPanel: () => void;
  closeTodoPanel: () => void;
  toggleTodoPanel: () => void;
  resetWorkspaceTodos: () => void;
}

/**
 * Workspace TODO/FIXME/... comment scan and panel (PhpStorm-style TODO tool
 * window). Harvests TODO-style comments across the active workspace and owns
 * the panel-local state so a switched-away tab's late scan can never
 * repopulate another tab's panel.
 */
export function useWorkspaceTodos(
  dependencies: WorkspaceTodosDependencies,
): WorkspaceTodos {
  const {
    workspaceFiles,
    currentWorkspaceRootRef,
    workspaceRoot,
    openNavigationTarget,
    relativeWorkspacePath,
  } = dependencies;

  const [todoPanelOpen, setTodoPanelOpen] = useState(false);
  const [workspaceTodos, setWorkspaceTodos] = useState<WorkspaceTodo[]>([]);
  const [workspaceTodosLoading, setWorkspaceTodosLoading] = useState(false);

  // Harvests TODO/FIXME/... comments across the active workspace. The walk is
  // conservative (skips dependency / build / VCS directories, only reads
  // source-like files, caps the file count + file size) so it never blocks the
  // UI on large trees. Per-project isolation is sacred here: the requested root
  // is captured up front and re-checked after EVERY readDirectory / readTextFile
  // await — the moment the user switches project tabs the scan bails out and
  // returns null so stale-workspace TODOs can never land in the now-active tab.
  const collectWorkspaceTodos = useCallback(
    async (root: string): Promise<WorkspaceTodo[] | null> => {
      const requestedRoot = root;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!isRequestedRootActive()) {
        return null;
      }

      const todos: WorkspaceTodo[] = [];
      let filesScanned = 0;

      const visitDirectory = async (directory: string): Promise<boolean> => {
        if (!isRequestedRootActive()) {
          return false;
        }

        let entries: FileEntry[];

        try {
          entries = await workspaceFiles.readDirectory(directory);
        } catch {
          // A directory that disappears mid-scan is skipped; a stale switch is
          // reported so the whole scan is dropped by the caller.
          return isRequestedRootActive();
        }

        if (!isRequestedRootActive()) {
          return false;
        }

        for (const entry of entries) {
          if (!isRequestedRootActive()) {
            return false;
          }

          if (filesScanned >= WORKSPACE_TODO_MAX_FILES) {
            return true;
          }

          if (entry.kind === "directory") {
            if (WORKSPACE_TODO_SKIPPED_DIRECTORIES.has(entry.name)) {
              continue;
            }

            const ok = await visitDirectory(entry.path);

            if (!ok) {
              return false;
            }

            continue;
          }

          if (!isWorkspaceTodoSourceFile(entry.name)) {
            continue;
          }

          filesScanned += 1;

          let content: string;

          try {
            content = await workspaceFiles.readTextFile(entry.path);
          } catch {
            if (!isRequestedRootActive()) {
              return false;
            }

            continue;
          }

          if (!isRequestedRootActive()) {
            return false;
          }

          if (content.length > WORKSPACE_TODO_MAX_FILE_BYTES) {
            continue;
          }

          const relativePath = relativeWorkspacePath(requestedRoot, entry.path);

          for (const comment of extractTodoComments(content)) {
            todos.push({
              column: comment.column,
              filePath: entry.path,
              line: comment.line,
              relativePath,
              tag: comment.tag,
              text: comment.text,
            });
          }
        }

        return true;
      };

      const completed = await visitDirectory(requestedRoot);

      if (!completed || !isRequestedRootActive()) {
        return null;
      }

      return todos;
    },
    [relativeWorkspacePath, workspaceFiles],
  );

  const refreshWorkspaceTodos = useCallback(async (): Promise<void> => {
    const requestedRoot = workspaceRoot;

    if (!requestedRoot) {
      setWorkspaceTodos([]);
      setWorkspaceTodosLoading(false);
      return;
    }

    setWorkspaceTodosLoading(true);

    const todos = await collectWorkspaceTodos(requestedRoot);

    // Re-check after the awaited scan before mutating shared state: a tab switch
    // during the scan must not splash another workspace's TODOs into this tab.
    if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
      return;
    }

    if (todos === null) {
      setWorkspaceTodosLoading(false);
      return;
    }

    setWorkspaceTodos(todos);
    setWorkspaceTodosLoading(false);
  }, [collectWorkspaceTodos, workspaceRoot]);

  const openWorkspaceTodo = useCallback(
    async (todo: WorkspaceTodo): Promise<boolean> => {
      // WorkspaceTodo mirrors the pure extractTodoComments result, whose `line`
      // and `column` are already 1-based — the same convention EditorPosition's
      // `lineNumber`/`column` use — so this is a direct 1:1 mapping, no offset.
      return openNavigationTarget(
        todo.filePath,
        { column: todo.column, lineNumber: todo.line },
        todo.tag,
      );
    },
    [openNavigationTarget],
  );

  const openTodoPanel = useCallback(() => {
    setTodoPanelOpen(true);
    void refreshWorkspaceTodos();
  }, [refreshWorkspaceTodos]);

  const closeTodoPanel = useCallback(() => {
    setTodoPanelOpen(false);
  }, []);

  const toggleTodoPanel = useCallback(() => {
    setTodoPanelOpen((open) => {
      if (open) {
        return false;
      }

      void refreshWorkspaceTodos();
      return true;
    });
  }, [refreshWorkspaceTodos]);

  // Resets every piece of TODO-panel state to its closed/empty defaults in one
  // call. The TODO panel is a transient, workspace-scoped overlay (never part
  // of the cached per-tab state), so the shell calls this on a full workspace
  // clear and on every workspace switch so one project's TODOs can never
  // appear inside another project's tab.
  const resetWorkspaceTodos = useCallback(() => {
    setTodoPanelOpen(false);
    setWorkspaceTodos([]);
    setWorkspaceTodosLoading(false);
  }, []);

  return {
    todoPanelOpen,
    workspaceTodos,
    workspaceTodosLoading,
    refreshWorkspaceTodos,
    openWorkspaceTodo,
    openTodoPanel,
    closeTodoPanel,
    toggleTodoPanel,
    resetWorkspaceTodos,
  };
}
