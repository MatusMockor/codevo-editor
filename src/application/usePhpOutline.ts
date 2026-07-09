/**
 * PHP project tree + PHP file structure (outline) intelligence, extracted
 * VERBATIM from the workbench controller as a sibling strangler module (mirrors
 * `useGitWorkspace` / `useBladeIntelligence`): the controller keeps only a thin
 * mount plus the shared React state, while the PHP tree / outline decisions live
 * here behind a small, injected dependency surface so the logic is unit-testable
 * WITHOUT the controller.
 *
 * Responsibilities (unchanged from the controller):
 *   - `refreshPhpTree`: (re)loads the whole-project PHP symbol tree for the PHP
 *     sidebar view.
 *   - `togglePhpTreeNode` / `openPhpTreeNode`: PHP tree node expansion +
 *     navigation.
 *   - `loadPhpFileOutline` / `loadInheritedPhpFileOutline`: the current-file and
 *     parent-class (inherited) PHP file structure loaders. The active PHP file is
 *     always live-parsed (fresh signature metadata) via the outline gateway.
 *   - `togglePhpFileOutline` / `togglePhpFileOutlineNode` /
 *     `openPhpFileOutlineNode`: outline row expansion + navigation.
 *
 * WHY the React state stays in the controller (injected, not owned here): the
 * PHP tree / outline state slices are reset by three controller-lifecycle
 * clear-blocks that run BEFORE `openFile` (which the navigation callbacks need)
 * is defined, so this hook must mount after `openFile`; owning the state here
 * would force those earlier reset blocks to reference setters declared later.
 * The state, its setters and the two refresh EFFECTS (which orchestrate
 * controller-owned `sidebarView` / `indexProgress` triggers, and whose effect
 * registration order must be preserved) therefore remain in the controller and
 * are wired in here as dependencies.
 *
 * ISOLATION (project rule): each async flow captures the requested workspace
 * root up front and re-checks the LIVE root (`currentWorkspaceRootRef`) after
 * every await, dropping stale results so nothing leaks across project tabs. The
 * tree / outline gateways and the navigation primitives are injected so the
 * engines stay owned by the controller and are merely wired here.
 */
import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { type EditorRevealTarget } from "../domain/languageServerFeatures";
import {
  emptyPhpFileOutline,
  type PhpFileOutline,
  type PhpFileOutlineGateway,
  type PhpFileOutlineNode,
} from "../domain/phpFileOutline";
import {
  emptyPhpTree,
  type PhpTree,
  type PhpTreeGateway,
  type PhpTreeNode,
} from "../domain/phpTree";
import {
  phpClassPathCandidates,
  phpExtendsClassName,
  resolvePhpClassName,
} from "../domain/phpNavigation";
import {
  getFileName,
  type EditorDocument,
  type FileEntry,
  type WorkspaceDescriptor,
  type WorkspaceFileGateway,
} from "../domain/workspace";
import {
  defaultLargeSmartDocumentPolicy,
  isLargeSmartDocumentContent,
  type LargeSmartDocumentPolicy,
} from "../domain/largeDocumentPolicy";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

/**
 * Collaborators the PHP tree / outline intelligence needs from the workbench
 * shell. The controller owns the React state (reset with the workspace
 * lifecycle) and the navigation primitives; they are injected verbatim so the
 * expensive engines stay owned by the controller.
 */
export interface PhpOutlineDependencies {
  largeSmartDocumentPolicy?: LargeSmartDocumentPolicy;
  workspaceRoot: string | null;
  workspaceDescriptor: WorkspaceDescriptor | null;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  documents: Record<string, EditorDocument>;
  workspaceFiles: Pick<WorkspaceFileGateway, "readTextFile">;
  phpTreeGateway: PhpTreeGateway;
  phpFileOutlineGateway: PhpFileOutlineGateway;
  reportError: (source: string, error: unknown) => void;
  setMessage: (message: string | null) => void;
  openFile: (entry: FileEntry) => Promise<boolean>;
  setEditorRevealTarget: Dispatch<SetStateAction<EditorRevealTarget | null>>;
  setPhpTree: Dispatch<SetStateAction<PhpTree>>;
  setPhpTreeExpandedNodeIds: Dispatch<SetStateAction<Set<string>>>;
  setPhpTreeLoading: Dispatch<SetStateAction<boolean>>;
  phpFileOutlinesByPath: Record<string, PhpFileOutline>;
  setPhpFileOutlinesByPath: Dispatch<
    SetStateAction<Record<string, PhpFileOutline>>
  >;
  setPhpInheritedFileOutlinesByPath: Dispatch<
    SetStateAction<Record<string, PhpFileOutline>>
  >;
  expandedPhpFilePaths: Set<string>;
  setExpandedPhpFilePaths: Dispatch<SetStateAction<Set<string>>>;
  loadingPhpFileOutlinePaths: Set<string>;
  setLoadingPhpFileOutlinePaths: Dispatch<SetStateAction<Set<string>>>;
  setLoadingInheritedPhpFileOutlinePaths: Dispatch<SetStateAction<Set<string>>>;
  setPhpFileOutlineExpandedNodeIds: Dispatch<SetStateAction<Set<string>>>;
}

/** The PHP tree / outline callbacks the controller mount consumes. */
export interface PhpOutline {
  refreshPhpTree: () => Promise<void>;
  togglePhpTreeNode: (id: string) => void;
  openPhpTreeNode: (node: PhpTreeNode) => Promise<void>;
  loadPhpFileOutline: (path: string) => Promise<void>;
  loadInheritedPhpFileOutline: (path: string) => Promise<void>;
  togglePhpFileOutline: (path: string) => void;
  togglePhpFileOutlineNode: (id: string) => void;
  openPhpFileOutlineNode: (node: PhpFileOutlineNode) => Promise<void>;
}

export function usePhpOutline(deps: PhpOutlineDependencies): PhpOutline {
  const {
    largeSmartDocumentPolicy = defaultLargeSmartDocumentPolicy,
    workspaceRoot,
    workspaceDescriptor,
    currentWorkspaceRootRef,
    documents,
    workspaceFiles,
    phpTreeGateway,
    phpFileOutlineGateway,
    reportError,
    setMessage,
    openFile,
    setEditorRevealTarget,
    setPhpTree,
    setPhpTreeExpandedNodeIds,
    setPhpTreeLoading,
    phpFileOutlinesByPath,
    setPhpFileOutlinesByPath,
    setPhpInheritedFileOutlinesByPath,
    expandedPhpFilePaths,
    setExpandedPhpFilePaths,
    loadingPhpFileOutlinePaths,
    setLoadingPhpFileOutlinePaths,
    setLoadingInheritedPhpFileOutlinePaths,
    setPhpFileOutlineExpandedNodeIds,
  } = deps;

  const refreshPhpTree = useCallback(async () => {
    if (!workspaceRoot) {
      setPhpTree(emptyPhpTree());
      setPhpTreeExpandedNodeIds(new Set());
      setPhpTreeLoading(false);
      return;
    }

    const requestedRoot = workspaceRoot;
    setPhpTreeLoading(true);

    try {
      const tree = await phpTreeGateway.getPhpTree(requestedRoot);

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      setPhpTree(tree);
      setMessage(null);
    } catch (error) {
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      setPhpTree(emptyPhpTree());
      reportError("PHP Tree", error);
    } finally {
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      setPhpTreeLoading(false);
    }
  }, [
    currentWorkspaceRootRef,
    phpTreeGateway,
    reportError,
    setMessage,
    setPhpTree,
    setPhpTreeExpandedNodeIds,
    setPhpTreeLoading,
    workspaceRoot,
  ]);

  const togglePhpTreeNode = useCallback(
    (id: string) => {
      setPhpTreeExpandedNodeIds((current) => {
        const next = new Set(current);

        if (next.has(id)) {
          next.delete(id);
          return next;
        }

        next.add(id);
        return next;
      });
    },
    [setPhpTreeExpandedNodeIds],
  );

  const openPhpTreeNode = useCallback(
    async (node: PhpTreeNode) => {
      if (!node.path) {
        return;
      }

      const opened = await openFile({
        kind: "file",
        name: getFileName(node.path),
        path: node.path,
      });

      if (!opened || !node.lineNumber || !node.column) {
        return;
      }

      setEditorRevealTarget({
        path: node.path,
        position: {
          column: node.column,
          lineNumber: node.lineNumber,
        },
      });
    },
    [openFile, setEditorRevealTarget],
  );

  const readPhpFileOutlineSource = useCallback(
    async (path: string): Promise<string> => {
      const openDocument = documents[path];

      if (openDocument) {
        return openDocument.content;
      }

      return workspaceFiles.readTextFile(path);
    },
    [documents, workspaceFiles],
  );

  // Always live-parse the single active PHP file (instant tree-sitter parse) so
  // the structure carries fresh signature metadata (visibility, parameters,
  // return type) that the SQLite project index does not store. The index only
  // serves non-PHP paths defensively. The caller re-checks the active root
  // after this resolves, so no shared state is mutated for a stale workspace.
  const loadActivePhpFileOutline = useCallback(
    async (requestedRoot: string, path: string): Promise<PhpFileOutline> => {
      if (isPhpPath(path)) {
        const source = await readPhpFileOutlineSource(path);

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return emptyPhpFileOutline();
        }

        if (isLargeSmartDocumentContent(source, largeSmartDocumentPolicy)) {
          return emptyPhpFileOutline();
        }

        return phpFileOutlineGateway.parsePhpFileOutline(path, source);
      }

      return phpFileOutlineGateway.getPhpFileOutline(requestedRoot, path);
    },
    [
      currentWorkspaceRootRef,
      largeSmartDocumentPolicy,
      phpFileOutlineGateway,
      readPhpFileOutlineSource,
    ],
  );

  const loadPhpFileOutline = useCallback(
    async (path: string) => {
      if (!workspaceRoot) {
        setPhpFileOutlinesByPath((current) => ({
          ...current,
          [path]: emptyPhpFileOutline(),
        }));
        return;
      }

      const requestedRoot = workspaceRoot;
      setLoadingPhpFileOutlinePaths((current) => new Set(current).add(path));

      try {
        const outline = await loadActivePhpFileOutline(requestedRoot, path);

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        setPhpFileOutlinesByPath((current) => ({
          ...current,
          [path]: outline,
        }));
        setMessage(null);
      } catch (error) {
        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        setPhpFileOutlinesByPath((current) => ({
          ...current,
          [path]: emptyPhpFileOutline(),
        }));
        reportError("PHP File Outline", error);
      } finally {
        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        setLoadingPhpFileOutlinePaths((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
      }
    },
    [
      currentWorkspaceRootRef,
      loadActivePhpFileOutline,
      reportError,
      setLoadingPhpFileOutlinePaths,
      setMessage,
      setPhpFileOutlinesByPath,
      workspaceRoot,
    ],
  );

  const loadInheritedPhpFileOutline = useCallback(
    async (path: string) => {
      if (!workspaceRoot || !workspaceDescriptor?.php) {
        setPhpInheritedFileOutlinesByPath((current) => ({
          ...current,
          [path]: emptyPhpFileOutline(),
        }));
        return;
      }

      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);
      setLoadingInheritedPhpFileOutlinePaths((current) =>
        new Set(current).add(path),
      );

      try {
        const source = await readPhpFileOutlineSource(path);

        if (!isRequestedRootActive()) {
          return;
        }

        if (isLargeSmartDocumentContent(source, largeSmartDocumentPolicy)) {
          setPhpInheritedFileOutlinesByPath((current) => ({
            ...current,
            [path]: emptyPhpFileOutline(),
          }));
          return;
        }

        const parentClassName = phpExtendsClassName(source);
        const resolvedParentClassName = parentClassName
          ? resolvePhpClassName(source, parentClassName)
          : null;

        if (!resolvedParentClassName) {
          if (!isRequestedRootActive()) {
            return;
          }

          setPhpInheritedFileOutlinesByPath((current) => ({
            ...current,
            [path]: emptyPhpFileOutline(),
          }));
          return;
        }

        for (const parentPath of phpClassPathCandidates(
          requestedRoot,
          workspaceDescriptor.php,
          resolvedParentClassName,
        )) {
          if (!isRequestedRootActive()) {
            return;
          }

          try {
            const parentSource = await readPhpFileOutlineSource(parentPath);

            if (!isRequestedRootActive()) {
              return;
            }

            if (
              isLargeSmartDocumentContent(parentSource, largeSmartDocumentPolicy)
            ) {
              continue;
            }

            const outline = await phpFileOutlineGateway.parsePhpFileOutline(
              parentPath,
              parentSource,
            );

            if (!isRequestedRootActive()) {
              return;
            }

            setPhpInheritedFileOutlinesByPath((current) => ({
              ...current,
              [path]: outline,
            }));
            setMessage(null);
            return;
          } catch {
            if (!isRequestedRootActive()) {
              return;
            }

            continue;
          }
        }

        if (!isRequestedRootActive()) {
          return;
        }

        setPhpInheritedFileOutlinesByPath((current) => ({
          ...current,
          [path]: emptyPhpFileOutline(),
        }));
      } catch (error) {
        if (!isRequestedRootActive()) {
          return;
        }

        setPhpInheritedFileOutlinesByPath((current) => ({
          ...current,
          [path]: emptyPhpFileOutline(),
        }));
        reportError("PHP Inherited Structure", error);
      } finally {
        if (!isRequestedRootActive()) {
          return;
        }

        setLoadingInheritedPhpFileOutlinePaths((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
      }
    },
    [
      currentWorkspaceRootRef,
      largeSmartDocumentPolicy,
      phpFileOutlineGateway,
      readPhpFileOutlineSource,
      reportError,
      setLoadingInheritedPhpFileOutlinePaths,
      setMessage,
      setPhpInheritedFileOutlinesByPath,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const togglePhpFileOutline = useCallback(
    (path: string) => {
      if (expandedPhpFilePaths.has(path)) {
        setExpandedPhpFilePaths((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
        return;
      }

      setExpandedPhpFilePaths((current) => new Set(current).add(path));

      if (phpFileOutlinesByPath[path] || loadingPhpFileOutlinePaths.has(path)) {
        return;
      }

      void loadPhpFileOutline(path);
    },
    [
      expandedPhpFilePaths,
      loadPhpFileOutline,
      loadingPhpFileOutlinePaths,
      phpFileOutlinesByPath,
      setExpandedPhpFilePaths,
    ],
  );

  const togglePhpFileOutlineNode = useCallback(
    (id: string) => {
      setPhpFileOutlineExpandedNodeIds((current) => {
        const next = new Set(current);

        if (next.has(id)) {
          next.delete(id);
          return next;
        }

        next.add(id);
        return next;
      });
    },
    [setPhpFileOutlineExpandedNodeIds],
  );

  const openPhpFileOutlineNode = useCallback(
    async (node: PhpFileOutlineNode) => {
      if (!node.path) {
        return;
      }

      const opened = await openFile({
        kind: "file",
        name: getFileName(node.path),
        path: node.path,
      });

      if (!opened || !node.lineNumber || !node.column) {
        return;
      }

      setEditorRevealTarget({
        path: node.path,
        position: {
          column: node.column,
          lineNumber: node.lineNumber,
        },
      });
    },
    [openFile, setEditorRevealTarget],
  );

  return {
    refreshPhpTree,
    togglePhpTreeNode,
    openPhpTreeNode,
    loadPhpFileOutline,
    loadInheritedPhpFileOutline,
    togglePhpFileOutline,
    togglePhpFileOutlineNode,
    openPhpFileOutlineNode,
  };
}

function isPhpPath(path: string): boolean {
  return path.toLowerCase().endsWith(".php");
}
