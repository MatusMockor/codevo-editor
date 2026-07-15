import { useCallback, useRef, type MutableRefObject } from "react";
import {
  executeCommandAndWait,
  type CommandContext,
} from "./commandRegistry";
import type { WorkbenchNotice } from "./workbenchNotice";
import { editorPositionFromProjectSymbol } from "./projectSymbolNavigation";
import {
  nextProblemLocation,
  previousProblemLocation,
  type ProblemLocation,
} from "../domain/problemNavigation";
import type { ProjectSymbolSearchResult } from "../domain/projectSymbols";
import type { SearchEverywhereItem } from "../domain/searchEverywhere";
import {
  getFileName,
  type EditorDocument,
  type FileEntry,
  type FileSearchResult,
  type WorkspaceFileGateway,
} from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type {
  EditorPosition,
  EditorRevealTarget,
} from "../domain/languageServerFeatures";
import type { NavigationLocation } from "../domain/navigation";
import { shouldOpenPhpNavigationTargetReadOnly } from "../domain/phpNavigationTargetReadOnly";
import type { RecentFileEntry } from "../domain/recentFiles";

interface OpenNavigationOptions {
  readOnly?: boolean;
  shouldCommit?: () => boolean;
}

interface OpenFileOptions {
  readOnly?: boolean;
  recordNavigation?: boolean;
  shouldCommit?: () => boolean;
}

export interface WorkbenchNavigationDependencies {
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  activeEditorPositionRef: MutableRefObject<EditorPosition | null>;
  commandContextRef: MutableRefObject<CommandContext>;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  documentsRef: MutableRefObject<Record<string, EditorDocument>>;
  noticesRef: MutableRefObject<WorkbenchNotice[]>;
  workspaceFiles: WorkspaceFileGateway;
  openFile: (entry: FileEntry, options?: OpenFileOptions) => Promise<boolean>;
  currentNavigationLocation: () => NavigationLocation | null;
  forgetRecentFile: (path: string) => void;
  recordNavigationLocationSnapshot: (
    location: NavigationLocation | null,
  ) => void;
  reportError: (source: string, error: unknown) => void;
  setClassOpenOpen: (isOpen: boolean) => void;
  setEditorRevealTarget: (target: EditorRevealTarget | null) => void;
  setMessage: (message: string | null) => void;
  setQuickOpenOpen: (isOpen: boolean) => void;
  setRecentFilesSwitcherOpen: (isOpen: boolean) => void;
  setSearchEverywhereOpen: (isOpen: boolean) => void;
  setWorkspaceSymbolsOpen: (isOpen: boolean) => void;
}

export interface WorkbenchNavigation {
  activateSearchEverywhereItem: (item: SearchEverywhereItem) => Promise<void>;
  openClassSearchResult: (result: ProjectSymbolSearchResult) => Promise<void>;
  openNavigationTarget: (
    path: string,
    position: EditorPosition,
    label: string,
    options?: OpenNavigationOptions,
  ) => Promise<boolean>;
  openPathForNavigation: (
    path: string,
    options?: OpenNavigationOptions,
  ) => Promise<boolean>;
  openProblemNotice: (notice: WorkbenchNotice) => Promise<boolean>;
  openRecentFile: (entry: RecentFileEntry) => Promise<void>;
  openSearchResult: (result: FileSearchResult) => Promise<void>;
  openWorkspaceSymbolResult: (
    result: ProjectSymbolSearchResult,
  ) => Promise<void>;
  goToNextProblem: () => Promise<boolean>;
  goToPreviousProblem: () => Promise<boolean>;
  readNavigationFileContent: (path: string) => Promise<string>;
}

/**
 * Shared non-LSP navigation operations for the workbench shell. Broad document
 * and tab state stays shell-owned; this hook owns the generic "open + reveal +
 * record previous location" callbacks and simple file/symbol result jumps that
 * several features build on.
 */
export function useWorkbenchNavigation(
  dependencies: WorkbenchNavigationDependencies,
): WorkbenchNavigation {
  const {
    activeDocumentRef,
    activeEditorPositionRef,
    commandContextRef,
    currentWorkspaceRootRef,
    documentsRef,
    noticesRef,
    workspaceFiles,
    openFile,
    currentNavigationLocation,
    forgetRecentFile,
    recordNavigationLocationSnapshot,
    reportError,
    setClassOpenOpen,
    setEditorRevealTarget,
    setMessage,
    setQuickOpenOpen,
    setRecentFilesSwitcherOpen,
    setSearchEverywhereOpen,
    setWorkspaceSymbolsOpen,
  } = dependencies;
  const pendingSearchEverywhereCommandIdsRef = useRef(new Set<string>());

  const openSearchResult = useCallback(
    async (result: FileSearchResult) => {
      const requestedRoot = currentWorkspaceRootRef.current;
      const opened = await openFile({
        kind: "file",
        name: result.name,
        path: result.path,
      });

      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
      ) {
        return;
      }

      if (!opened) {
        forgetRecentFile(result.path);
        return;
      }

      setQuickOpenOpen(false);
    },
    [forgetRecentFile, openFile],
  );

  const openRecentFile = useCallback(
    async (entry: RecentFileEntry) => {
      // Capture the requested root up front so a workspace switch during the
      // open cannot make us prune another tab's MRU after the await resolves.
      const requestedRoot = currentWorkspaceRootRef.current;
      const opened = await openFile({
        kind: "file",
        name: entry.name,
        path: entry.path,
      });

      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
      ) {
        return;
      }

      if (!opened) {
        // The file vanished out from under the MRU (deleted/moved outside the
        // editor). Prune the dead entry so it stops being offered.
        forgetRecentFile(entry.path);
        return;
      }

      setRecentFilesSwitcherOpen(false);
    },
    [forgetRecentFile, openFile],
  );

  const openClassSearchResult = useCallback(
    async (result: ProjectSymbolSearchResult) => {
      const opened = await openFile({
        kind: "file",
        name: getFileName(result.path),
        path: result.path,
      });

      if (!opened) {
        return;
      }

      setClassOpenOpen(false);
      setEditorRevealTarget({
        path: result.path,
        position: editorPositionFromProjectSymbol(result),
      });
      setMessage(
        `Opened ${result.name} ${result.relativePath}:${result.lineNumber}:${result.column}`,
      );
    },
    [openFile],
  );

  const openWorkspaceSymbolResult = useCallback(
    async (result: ProjectSymbolSearchResult) => {
      const opened = await openFile({
        kind: "file",
        name: getFileName(result.path),
        path: result.path,
      });

      if (!opened) {
        return;
      }

      setWorkspaceSymbolsOpen(false);
      setEditorRevealTarget({
        path: result.path,
        position: editorPositionFromProjectSymbol(result),
      });
      setMessage(
        `Opened ${result.name} ${result.relativePath}:${result.lineNumber}:${result.column}`,
      );
    },
    [openFile],
  );

  const openPathForNavigation = useCallback(
    async (
      path: string,
      options: OpenNavigationOptions = {},
    ): Promise<boolean> => {
      const readOnly = navigationTargetReadOnly(
        currentWorkspaceRootRef.current,
        path,
        options.readOnly,
      );
      const opened = await openFile(
        {
          kind: "file",
          name: getFileName(path),
          path,
        },
        {
          readOnly,
          recordNavigation: false,
          ...(options.shouldCommit
            ? { shouldCommit: options.shouldCommit }
            : {}),
        },
      );

      if (!opened) {
        return false;
      }

      return true;
    },
    [openFile],
  );

  const openNavigationTarget = useCallback(
    async (
      path: string,
      position: EditorPosition,
      label: string,
      options: OpenNavigationOptions = {},
    ): Promise<boolean> => {
      const previousLocation = currentNavigationLocation();

      const opened = await openPathForNavigation(path, options);

      if (!opened) {
        return false;
      }

      recordNavigationLocationSnapshot(previousLocation);
      setEditorRevealTarget({
        path,
        position,
      });
      setMessage(
        `Opened ${label} ${getFileName(path)}:${position.lineNumber}:${position.column}`,
      );
      return true;
    },
    [
      currentNavigationLocation,
      openPathForNavigation,
      recordNavigationLocationSnapshot,
    ],
  );

  const openProblemNotice = useCallback(
    async (notice: WorkbenchNotice) => {
      const target = notice.navigationTarget;

      if (!target) {
        return false;
      }

      return openNavigationTarget(
        target.path,
        target.range.start,
        "problem",
      );
    },
    [openNavigationTarget],
  );

  const currentProblemLocation = useCallback((): ProblemLocation | null => {
    const path = activeDocumentRef.current?.path;

    if (!path) {
      return null;
    }

    const position = activeEditorPositionRef.current ?? {
      column: 1,
      lineNumber: 1,
    };

    return {
      path,
      position: { column: position.column, lineNumber: position.lineNumber },
    };
  }, []);

  const goToProblemLocation = useCallback(
    async (location: ProblemLocation | null): Promise<boolean> => {
      if (!location) {
        return false;
      }

      const opened = await openNavigationTarget(
        location.path,
        location.position,
        "problem",
      );

      if (opened) {
        activeEditorPositionRef.current = location.position;
      }

      return opened;
    },
    [openNavigationTarget],
  );

  const goToNextProblem = useCallback(async (): Promise<boolean> => {
    return goToProblemLocation(
      nextProblemLocation(noticesRef.current, currentProblemLocation()),
    );
  }, [currentProblemLocation, goToProblemLocation]);

  const goToPreviousProblem = useCallback(async (): Promise<boolean> => {
    return goToProblemLocation(
      previousProblemLocation(noticesRef.current, currentProblemLocation()),
    );
  }, [currentProblemLocation, goToProblemLocation]);

  const readNavigationFileContent = useCallback(
    async (path: string): Promise<string> => {
      const activeOpenDocument = activeDocumentRef.current;

      if (activeOpenDocument?.path === path) {
        return activeOpenDocument.content;
      }

      const openDocument = documentsRef.current[path];

      if (openDocument) {
        return openDocument.content;
      }

      return workspaceFiles.readTextFile(path);
    },
    [workspaceFiles],
  );

  const activateSearchEverywhereItem = useCallback(
    async (item: SearchEverywhereItem) => {
      if (item.kind === "action") {
        setSearchEverywhereOpen(false);

        if (pendingSearchEverywhereCommandIdsRef.current.has(item.command.id)) {
          return;
        }

        pendingSearchEverywhereCommandIdsRef.current.add(item.command.id);

        try {
          await executeCommandAndWait(item.command, commandContextRef.current);
        } catch (error) {
          reportError("Command", error);
        } finally {
          pendingSearchEverywhereCommandIdsRef.current.delete(item.command.id);
        }

        return;
      }

      // Capture the requested root up front so a workspace switch during the
      // open cannot reveal a symbol position in another tab's editor.
      const requestedRoot = currentWorkspaceRootRef.current;
      const path = item.kind === "file" ? item.file.path : item.symbol.path;
      const name =
        item.kind === "file" ? item.file.name : getFileName(item.symbol.path);

      const opened = await openFile({ kind: "file", name, path });

      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
      ) {
        return;
      }

      if (!opened) {
        return;
      }

      setSearchEverywhereOpen(false);

      if (item.kind === "symbol") {
        setEditorRevealTarget({
          path: item.symbol.path,
          position: editorPositionFromProjectSymbol(item.symbol),
        });
        setMessage(
          `Opened ${item.symbol.name} ${item.symbol.relativePath}:${item.symbol.lineNumber}:${item.symbol.column}`,
        );
      }
    },
    [commandContextRef, openFile, reportError, setSearchEverywhereOpen],
  );

  return {
    activateSearchEverywhereItem,
    openClassSearchResult,
    openNavigationTarget,
    openPathForNavigation,
    openProblemNotice,
    openRecentFile,
    openSearchResult,
    openWorkspaceSymbolResult,
    goToNextProblem,
    goToPreviousProblem,
    readNavigationFileContent,
  };
}

function navigationTargetReadOnly(
  rootPath: string | null,
  path: string,
  readOnly: boolean | undefined,
): boolean | undefined {
  if (readOnly === true) {
    return true;
  }

  if (!rootPath) {
    return readOnly;
  }

  if (shouldOpenPhpNavigationTargetReadOnly(rootPath, path)) {
    return true;
  }

  return readOnly;
}
