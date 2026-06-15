import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommandRegistry } from "./commandRegistry";
import type { WorkbenchPrompter } from "./workbenchPrompter";
import type { SmartModeGateway } from "../domain/intelligence";
import {
  detectLanguage,
  getFileName,
  getParentPath,
  isDirty,
  joinWorkspacePath,
  type EditorDocument,
  type FileEntry,
  type FileSearchResult,
  type IntelligenceMode,
  type WorkspaceGateway,
} from "../domain/workspace";

const RECENT_WORKSPACE_KEY = "editor.recentWorkspace";

export function useWorkbenchController(
  workspaceGateway: WorkspaceGateway,
  smartModeGateway: SmartModeGateway,
  prompter: WorkbenchPrompter,
) {
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [entriesByDirectory, setEntriesByDirectory] = useState<
    Record<string, FileEntry[]>
  >({});
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(
    new Set(),
  );
  const [loadingDirectories, setLoadingDirectories] = useState<Set<string>>(
    new Set(),
  );
  const [documents, setDocuments] = useState<Record<string, EditorDocument>>(
    {},
  );
  const [openPaths, setOpenPaths] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [quickOpenQuery, setQuickOpenQuery] = useState("");
  const [quickOpenLoading, setQuickOpenLoading] = useState(false);
  const [quickOpenResults, setQuickOpenResults] = useState<FileSearchResult[]>(
    [],
  );
  const [message, setMessage] = useState<string | null>(null);
  const [intelligenceMode, setIntelligenceMode] =
    useState<IntelligenceMode>("basic");
  const hasRestoredRef = useRef(false);

  const activeDocument = activePath ? documents[activePath] || null : null;
  const openDocuments = openPaths
    .map((path) => documents[path])
    .filter((document): document is EditorDocument => Boolean(document));
  const dirtyCount = openDocuments.filter(isDirty).length;

  const loadDirectory = useCallback(
    async (path: string) => {
      setLoadingDirectories((current) => new Set(current).add(path));

      try {
        const entries = await workspaceGateway.readDirectory(path);
        setEntriesByDirectory((current) => ({
          ...current,
          [path]: entries,
        }));
        setMessage(null);
      } catch (error) {
        setMessage(String(error));
      } finally {
        setLoadingDirectories((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
      }
    },
    [workspaceGateway],
  );

  const openWorkspacePath = useCallback(
    async (path: string) => {
      setWorkspaceRoot(path);
      setEntriesByDirectory({});
      setExpandedDirectories(new Set([path]));
      setDocuments({});
      setOpenPaths([]);
      setActivePath(null);
      setIntelligenceMode("basic");
      localStorage.setItem(RECENT_WORKSPACE_KEY, path);
      await loadDirectory(path);
    },
    [loadDirectory],
  );

  const openWorkspace = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Open workspace",
    });

    if (typeof selected !== "string") {
      return;
    }

    await openWorkspacePath(selected);
  }, [openWorkspacePath]);

  const refreshDirectory = useCallback(
    async (path: string) => {
      await loadDirectory(path);
    },
    [loadDirectory],
  );

  const refreshWorkspace = useCallback(async () => {
    if (!workspaceRoot) {
      return;
    }

    await refreshDirectory(workspaceRoot);
  }, [refreshDirectory, workspaceRoot]);

  const toggleDirectory = useCallback(
    async (path: string) => {
      const isExpanded = expandedDirectories.has(path);

      setExpandedDirectories((current) => {
        const next = new Set(current);

        if (next.has(path)) {
          next.delete(path);
          return next;
        }

        next.add(path);
        return next;
      });

      if (isExpanded || entriesByDirectory[path]) {
        return;
      }

      await loadDirectory(path);
    },
    [entriesByDirectory, expandedDirectories, loadDirectory],
  );

  const openFile = useCallback(
    async (entry: FileEntry) => {
      if (documents[entry.path]) {
        setActivePath(entry.path);
        return;
      }

      try {
        const content = await workspaceGateway.readTextFile(entry.path);
        const document: EditorDocument = {
          path: entry.path,
          name: entry.name,
          content,
          savedContent: content,
          language: detectLanguage(entry.path),
        };

        setDocuments((current) => ({ ...current, [entry.path]: document }));
        setOpenPaths((current) => [...current, entry.path]);
        setActivePath(entry.path);
        setMessage(null);
      } catch (error) {
        setMessage(String(error));
      }
    },
    [documents, workspaceGateway],
  );

  const saveActiveDocument = useCallback(async () => {
    if (!activeDocument) {
      return;
    }

    try {
      await workspaceGateway.writeTextFile(
        activeDocument.path,
        activeDocument.content,
      );
      setDocuments((current) => ({
        ...current,
        [activeDocument.path]: {
          ...activeDocument,
          savedContent: activeDocument.content,
        },
      }));
      setMessage(`Saved ${activeDocument.name}`);
    } catch (error) {
      setMessage(String(error));
    }
  }, [activeDocument, workspaceGateway]);

  const closeDocument = useCallback(
    (path: string) => {
      const document = documents[path];

      if (document && isDirty(document) && !prompter.confirm("Discard changes?")) {
        return;
      }

      setDocuments((current) => {
        const next = { ...current };
        delete next[path];
        return next;
      });

      setOpenPaths((current) => {
        const next = current.filter((item) => item !== path);

        if (activePath === path) {
          setActivePath(next[next.length - 1] || null);
        }

        return next;
      });
    },
    [activePath, documents, prompter],
  );

  const updateActiveDocument = useCallback(
    (content: string) => {
      if (!activeDocument) {
        return;
      }

      setDocuments((current) => ({
        ...current,
        [activeDocument.path]: {
          ...activeDocument,
          content,
        },
      }));
    },
    [activeDocument],
  );

  const createFile = useCallback(async () => {
    if (!workspaceRoot) {
      return;
    }

    const relativePath = prompter.prompt("New file path", "src/NewFile.php");

    if (!relativePath) {
      return;
    }

    const path = joinWorkspacePath(workspaceRoot, relativePath);

    try {
      await workspaceGateway.createTextFile(path);
      const parentPath = getParentPath(path);
      setExpandedDirectories((current) => new Set(current).add(parentPath));
      await refreshDirectory(parentPath);
      await openFile({ kind: "file", name: getFileName(path), path });
    } catch (error) {
      setMessage(String(error));
    }
  }, [openFile, prompter, refreshDirectory, workspaceGateway, workspaceRoot]);

  const openSearchResult = useCallback(
    async (result: FileSearchResult) => {
      await openFile({ kind: "file", name: result.name, path: result.path });
      setQuickOpenOpen(false);
    },
    [openFile],
  );

  const createDirectory = useCallback(async () => {
    if (!workspaceRoot) {
      return;
    }

    const relativePath = prompter.prompt("New folder path", "src/Domain");

    if (!relativePath) {
      return;
    }

    const path = joinWorkspacePath(workspaceRoot, relativePath);

    try {
      await workspaceGateway.createDirectory(path);
      const parentPath = getParentPath(path);
      setExpandedDirectories((current) => new Set(current).add(parentPath));
      await refreshDirectory(parentPath);
      setMessage(`Created ${path}`);
    } catch (error) {
      setMessage(String(error));
    }
  }, [prompter, refreshDirectory, workspaceGateway, workspaceRoot]);

  const renameActiveDocument = useCallback(async () => {
    if (!activeDocument) {
      return;
    }

    const nextName = prompter.prompt("Rename file", activeDocument.name);

    if (!nextName || nextName === activeDocument.name) {
      return;
    }

    const parentPath = getParentPath(activeDocument.path);
    const nextPath = joinWorkspacePath(parentPath, nextName);

    try {
      await workspaceGateway.renamePath(activeDocument.path, nextPath);
      const renamedDocument = {
        ...activeDocument,
        language: detectLanguage(nextPath),
        name: nextName,
        path: nextPath,
      };

      setDocuments((current) => {
        const next = { ...current };
        delete next[activeDocument.path];
        next[nextPath] = renamedDocument;
        return next;
      });
      setOpenPaths((current) =>
        current.map((path) => (path === activeDocument.path ? nextPath : path)),
      );
      setActivePath(nextPath);
      await refreshDirectory(parentPath);
      setMessage(`Renamed ${activeDocument.name}`);
    } catch (error) {
      setMessage(String(error));
    }
  }, [activeDocument, prompter, refreshDirectory, workspaceGateway]);

  const deleteActiveDocument = useCallback(async () => {
    if (!activeDocument) {
      return;
    }

    if (!prompter.confirm(`Delete ${activeDocument.name}?`)) {
      return;
    }

    const parentPath = getParentPath(activeDocument.path);

    try {
      await workspaceGateway.deletePath(activeDocument.path);
      closeDocument(activeDocument.path);
      await refreshDirectory(parentPath);
      setMessage(`Deleted ${activeDocument.name}`);
    } catch (error) {
      setMessage(String(error));
    }
  }, [
    activeDocument,
    closeDocument,
    prompter,
    refreshDirectory,
    workspaceGateway,
  ]);

  const toggleSmartMode = useCallback(async () => {
    if (!workspaceRoot) {
      return;
    }

    const nextMode = intelligenceMode === "basic" ? "lightSmart" : "basic";

    try {
      const state = await smartModeGateway.setMode(nextMode);
      setIntelligenceMode(state.mode);
      setMessage(state.message);
    } catch (error) {
      setMessage(String(error));
    }
  }, [intelligenceMode, smartModeGateway, workspaceRoot]);

  const commandRegistry = useMemo(() => {
    const registry = new CommandRegistry();

    registry.register({
      id: "workspace.open",
      title: "Open Workspace",
      category: "Workspace",
      shortcut: "Cmd+O",
      isEnabled: () => true,
      run: openWorkspace,
    });

    registry.register({
      id: "workspace.refresh",
      title: "Refresh Workspace",
      category: "Workspace",
      isEnabled: (context) => context.hasWorkspace,
      run: refreshWorkspace,
    });

    registry.register({
      id: "file.new",
      title: "New File",
      category: "File",
      isEnabled: (context) => context.hasWorkspace,
      run: createFile,
    });

    registry.register({
      id: "file.quickOpen",
      title: "Quick Open File",
      category: "File",
      shortcut: "Cmd+P",
      isEnabled: (context) => context.hasWorkspace,
      run: () => setQuickOpenOpen(true),
    });

    registry.register({
      id: "folder.new",
      title: "New Folder",
      category: "File",
      isEnabled: (context) => context.hasWorkspace,
      run: createDirectory,
    });

    registry.register({
      id: "file.rename",
      title: "Rename Active File",
      category: "File",
      isEnabled: (context) => context.hasActiveDocument,
      run: renameActiveDocument,
    });

    registry.register({
      id: "file.delete",
      title: "Delete Active File",
      category: "File",
      isEnabled: (context) => context.hasActiveDocument,
      run: deleteActiveDocument,
    });

    registry.register({
      id: "editor.save",
      title: "Save File",
      category: "Editor",
      shortcut: "Cmd+S",
      isEnabled: (context) =>
        context.hasActiveDocument && context.activeDocumentDirty,
      run: saveActiveDocument,
    });

    registry.register({
      id: "commands.show",
      title: "Show Commands",
      category: "Workbench",
      shortcut: "Cmd+K",
      isEnabled: () => true,
      run: () => setPaletteOpen(true),
    });

    registry.register({
      id: "smart.toggle",
      title: "Toggle Smart Mode",
      category: "Smart Mode",
      isEnabled: (context) => context.hasWorkspace,
      run: toggleSmartMode,
    });

    return registry;
  }, [
    createDirectory,
    createFile,
    deleteActiveDocument,
    openWorkspace,
    refreshWorkspace,
    renameActiveDocument,
    saveActiveDocument,
    toggleSmartMode,
  ]);

  const commandContext = {
    hasWorkspace: Boolean(workspaceRoot),
    hasActiveDocument: Boolean(activeDocument),
    activeDocumentDirty: Boolean(activeDocument && isDirty(activeDocument)),
  };

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const primaryModifier = event.metaKey || event.ctrlKey;

      if (!primaryModifier) {
        return;
      }

      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveActiveDocument();
        return;
      }

      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }

      if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        void openWorkspace();
        return;
      }

      if (event.key.toLowerCase() === "p") {
        event.preventDefault();
        if (workspaceRoot) {
          setQuickOpenOpen(true);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openWorkspace, saveActiveDocument, workspaceRoot]);

  useEffect(() => {
    if (hasRestoredRef.current) {
      return;
    }

    const recentWorkspace = localStorage.getItem(RECENT_WORKSPACE_KEY);

    if (!recentWorkspace) {
      return;
    }

    hasRestoredRef.current = true;
    void openWorkspacePath(recentWorkspace);
  }, [openWorkspacePath]);

  useEffect(() => {
    if (!quickOpenOpen || !workspaceRoot) {
      setQuickOpenResults([]);
      setQuickOpenLoading(false);
      return;
    }

    let active = true;
    setQuickOpenLoading(true);

    const timeout = window.setTimeout(() => {
      workspaceGateway
        .searchFiles(workspaceRoot, quickOpenQuery, 80)
        .then((results) => {
          if (!active) {
            return;
          }

          setQuickOpenResults(results);
          setMessage(null);
        })
        .catch((error) => {
          if (!active) {
            return;
          }

          setQuickOpenResults([]);
          setMessage(String(error));
        })
        .finally(() => {
          if (!active) {
            return;
          }

          setQuickOpenLoading(false);
        });
    }, 120);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [quickOpenOpen, quickOpenQuery, workspaceGateway, workspaceRoot]);

  return {
    activeDocument,
    activePath,
    closeDocument,
    commandContext,
    commands: commandRegistry.list(),
    dirtyCount,
    entriesByDirectory,
    expandedDirectories,
    intelligenceMode,
    loadingDirectories,
    message,
    openDocuments,
    openFile,
    openWorkspace,
    paletteOpen,
    quickOpenLoading,
    quickOpenOpen,
    quickOpenQuery,
    quickOpenResults,
    reportCommandError: (error: unknown) => setMessage(String(error)),
    saveActiveDocument,
    setActivePath,
    setPaletteOpen,
    setQuickOpenOpen,
    setQuickOpenQuery,
    toggleDirectory,
    toggleSmartMode,
    updateActiveDocument,
    openSearchResult,
    workspaceRoot,
  };
}
