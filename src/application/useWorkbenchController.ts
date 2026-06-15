import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommandRegistry } from "./commandRegistry";
import {
  createWorkbenchNotice,
  type WorkbenchNotice,
} from "./workbenchNotice";
import type { WorkbenchPrompter } from "./workbenchPrompter";
import type { SmartModeGateway } from "../domain/intelligence";
import type {
  LanguageServerGateway,
  LanguageServerPlan,
} from "../domain/languageServer";
import { createPhpactorSetupGuide } from "../domain/languageServerSetup";
import type { WorkspaceTrustGateway, WorkspaceTrustState } from "../domain/trust";
import {
  detectLanguage,
  getFileName,
  getParentPath,
  isDirty,
  joinWorkspacePath,
  type EditorDocument,
  type FileEntry,
  type FileSearchResult,
  type FileSearchGateway,
  type IntelligenceMode,
  type PhpToolGateway,
  type PhpToolAvailability,
  type TextSearchResult,
  type TextSearchGateway,
  type WorkspaceDescriptor,
  type WorkspaceDetectionGateway,
  type WorkspaceFileGateway,
} from "../domain/workspace";

const RECENT_WORKSPACE_KEY = "editor.recentWorkspace";

export interface WorkbenchWorkspaceGateways {
  detection: WorkspaceDetectionGateway;
  fileSearch: FileSearchGateway;
  files: WorkspaceFileGateway;
  phpTools: PhpToolGateway;
  textSearch: TextSearchGateway;
}

export function useWorkbenchController(
  workspaceGateways: WorkbenchWorkspaceGateways,
  smartModeGateway: SmartModeGateway,
  workspaceTrustGateway: WorkspaceTrustGateway,
  languageServerGateway: LanguageServerGateway,
  prompter: WorkbenchPrompter,
) {
  const {
    detection: workspaceDetection,
    fileSearch,
    files: workspaceFiles,
    phpTools: phpToolGateway,
    textSearch,
  } = workspaceGateways;
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [workspaceDescriptor, setWorkspaceDescriptor] =
    useState<WorkspaceDescriptor | null>(null);
  const [workspaceTrust, setWorkspaceTrust] =
    useState<WorkspaceTrustState | null>(null);
  const [phpTools, setPhpTools] = useState<PhpToolAvailability | null>(null);
  const [languageServerPlan, setLanguageServerPlan] =
    useState<LanguageServerPlan | null>(null);
  const [languageServerSetupOpen, setLanguageServerSetupOpen] = useState(false);
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
  const [textSearchOpen, setTextSearchOpen] = useState(false);
  const [textSearchQuery, setTextSearchQuery] = useState("");
  const [textSearchLoading, setTextSearchLoading] = useState(false);
  const [textSearchResults, setTextSearchResults] = useState<TextSearchResult[]>(
    [],
  );
  const [message, setMessage] = useState<string | null>(null);
  const [notices, setNotices] = useState<WorkbenchNotice[]>([]);
  const [intelligenceMode, setIntelligenceMode] =
    useState<IntelligenceMode>("basic");
  const hasRestoredRef = useRef(false);

  const activeDocument = activePath ? documents[activePath] || null : null;
  const openDocuments = openPaths
    .map((path) => documents[path])
    .filter((document): document is EditorDocument => Boolean(document));
  const dirtyCount = openDocuments.filter(isDirty).length;

  const reportError = useCallback((source: string, error: unknown) => {
    const nextMessage = String(error);
    setMessage(nextMessage);
    setNotices((current) => [
      createWorkbenchNotice("error", source, nextMessage),
      ...current,
    ]);
  }, []);

  const refreshLanguageServerPlan = useCallback(
    async (rootPath: string) => {
      try {
        const plan = await languageServerGateway.planPhpLanguageServer(rootPath);
        setLanguageServerPlan(plan);
        return plan;
      } catch (error) {
        setLanguageServerPlan(null);
        reportError("Language Server", error);
        return null;
      }
    },
    [languageServerGateway, reportError],
  );

  const loadDirectory = useCallback(
    async (path: string) => {
      setLoadingDirectories((current) => new Set(current).add(path));

      try {
        const entries = await workspaceFiles.readDirectory(path);
        setEntriesByDirectory((current) => ({
          ...current,
          [path]: entries,
        }));
        setMessage(null);
      } catch (error) {
        reportError("Workspace", error);
      } finally {
        setLoadingDirectories((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
      }
    },
    [reportError, workspaceFiles],
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
      setWorkspaceDescriptor(null);
      setPhpTools(null);
      setWorkspaceTrust(null);
      setLanguageServerPlan(null);
      localStorage.setItem(RECENT_WORKSPACE_KEY, path);
      await loadDirectory(path);

      try {
        const trust = await workspaceTrustGateway.getTrust(path);
        setWorkspaceTrust(trust);
        const descriptor = await workspaceDetection.detectWorkspace(path);
        setWorkspaceDescriptor(descriptor);

        if (!descriptor.php) {
          setLanguageServerPlan(null);
          return;
        }

        const tools = await phpToolGateway.detectPhpTools(path);
        setPhpTools(tools);
        await refreshLanguageServerPlan(path);
      } catch (error) {
        reportError("Workspace Detection", error);
      }
    },
    [
      loadDirectory,
      phpToolGateway,
      refreshLanguageServerPlan,
      reportError,
      workspaceDetection,
      workspaceTrustGateway,
    ],
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
        const content = await workspaceFiles.readTextFile(entry.path);
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
        reportError("Open File", error);
      }
    },
    [documents, reportError, workspaceFiles],
  );

  const saveActiveDocument = useCallback(async () => {
    if (!activeDocument) {
      return;
    }

    try {
      await workspaceFiles.writeTextFile(
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
      reportError("Save File", error);
    }
  }, [activeDocument, reportError, workspaceFiles]);

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
      await workspaceFiles.createTextFile(path);
      const parentPath = getParentPath(path);
      setExpandedDirectories((current) => new Set(current).add(parentPath));
      await refreshDirectory(parentPath);
      await openFile({ kind: "file", name: getFileName(path), path });
    } catch (error) {
      reportError("Create File", error);
    }
  }, [
    openFile,
    prompter,
    refreshDirectory,
    reportError,
    workspaceFiles,
    workspaceRoot,
  ]);

  const openSearchResult = useCallback(
    async (result: FileSearchResult) => {
      await openFile({ kind: "file", name: result.name, path: result.path });
      setQuickOpenOpen(false);
    },
    [openFile],
  );

  const openTextSearchResult = useCallback(
    async (result: TextSearchResult) => {
      await openFile({
        kind: "file",
        name: getFileName(result.path),
        path: result.path,
      });
      setTextSearchOpen(false);
      setMessage(
        `Opened ${result.relativePath}:${result.lineNumber}:${result.column}`,
      );
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
      await workspaceFiles.createDirectory(path);
      const parentPath = getParentPath(path);
      setExpandedDirectories((current) => new Set(current).add(parentPath));
      await refreshDirectory(parentPath);
      setMessage(`Created ${path}`);
    } catch (error) {
      reportError("Create Folder", error);
    }
  }, [prompter, refreshDirectory, reportError, workspaceFiles, workspaceRoot]);

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
      await workspaceFiles.renamePath(activeDocument.path, nextPath);
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
      reportError("Rename File", error);
    }
  }, [activeDocument, prompter, refreshDirectory, reportError, workspaceFiles]);

  const deleteActiveDocument = useCallback(async () => {
    if (!activeDocument) {
      return;
    }

    if (!prompter.confirm(`Delete ${activeDocument.name}?`)) {
      return;
    }

    const parentPath = getParentPath(activeDocument.path);

    try {
      await workspaceFiles.deletePath(activeDocument.path);
      closeDocument(activeDocument.path);
      await refreshDirectory(parentPath);
      setMessage(`Deleted ${activeDocument.name}`);
    } catch (error) {
      reportError("Delete File", error);
    }
  }, [
    activeDocument,
    closeDocument,
    prompter,
    refreshDirectory,
    reportError,
    workspaceFiles,
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
      reportError("Smart Mode", error);
    }
  }, [intelligenceMode, reportError, smartModeGateway, workspaceRoot]);

  const toggleWorkspaceTrust = useCallback(async () => {
    if (!workspaceRoot) {
      return;
    }

    const trusted = !workspaceTrust?.trusted;

    try {
      const trust = await workspaceTrustGateway.setTrust(workspaceRoot, trusted);
      setWorkspaceTrust(trust);
      setMessage(
        trust.trusted ? "Workspace trusted." : "Workspace trust revoked.",
      );

      if (!workspaceDescriptor?.php) {
        return;
      }

      await refreshLanguageServerPlan(workspaceRoot);
    } catch (error) {
      reportError("Workspace Trust", error);
    }
  }, [
    refreshLanguageServerPlan,
    reportError,
    workspaceDescriptor,
    workspaceRoot,
    workspaceTrust,
    workspaceTrustGateway,
  ]);

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
      id: "workspace.trust",
      title: workspaceTrust?.trusted
        ? "Revoke Workspace Trust"
        : "Trust Workspace",
      category: "Workspace",
      isEnabled: (context) => context.hasWorkspace,
      run: toggleWorkspaceTrust,
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
      id: "search.text",
      title: "Search Text",
      category: "Search",
      shortcut: "Cmd+Shift+F",
      isEnabled: (context) => context.hasWorkspace,
      run: () => setTextSearchOpen(true),
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

    registry.register({
      id: "smart.phpactorSetup",
      title: "Show PHPactor Setup",
      category: "Smart Mode",
      isEnabled: () => Boolean(createPhpactorSetupGuide(languageServerPlan)),
      run: () => setLanguageServerSetupOpen(true),
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
    toggleWorkspaceTrust,
    languageServerPlan,
    workspaceTrust,
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
        return;
      }

      if (event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        if (workspaceRoot) {
          setTextSearchOpen(true);
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
      fileSearch
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
          reportError("Quick Open", error);
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
  }, [fileSearch, quickOpenOpen, quickOpenQuery, reportError, workspaceRoot]);

  useEffect(() => {
    if (!textSearchOpen || !workspaceRoot || !textSearchQuery.trim()) {
      setTextSearchResults([]);
      setTextSearchLoading(false);
      return;
    }

    let active = true;
    setTextSearchLoading(true);

    const timeout = window.setTimeout(() => {
      textSearch
        .searchText(workspaceRoot, textSearchQuery, 100)
        .then((results) => {
          if (!active) {
            return;
          }

          setTextSearchResults(results);
          setMessage(null);
        })
        .catch((error) => {
          if (!active) {
            return;
          }

          setTextSearchResults([]);
          reportError("Text Search", error);
        })
        .finally(() => {
          if (!active) {
            return;
          }

          setTextSearchLoading(false);
        });
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [
    reportError,
    textSearchOpen,
    textSearchQuery,
    textSearch,
    workspaceRoot,
  ]);

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
    languageServerPlan,
    languageServerSetupOpen,
    message,
    openDocuments,
    openFile,
    openWorkspace,
    paletteOpen,
    phpTools,
    quickOpenLoading,
    quickOpenOpen,
    quickOpenQuery,
    quickOpenResults,
    clearNotices: () => setNotices([]),
    notices,
    reportCommandError: (error: unknown) => reportError("Command", error),
    saveActiveDocument,
    setActivePath,
    setPaletteOpen,
    setQuickOpenOpen,
    setQuickOpenQuery,
    setTextSearchOpen,
    setTextSearchQuery,
    setLanguageServerSetupOpen,
    textSearchLoading,
    textSearchOpen,
    textSearchQuery,
    textSearchResults,
    toggleDirectory,
    toggleSmartMode,
    updateActiveDocument,
    openSearchResult,
    openTextSearchResult,
    workspaceDescriptor,
    workspaceRoot,
    workspaceTrust,
  };
}
