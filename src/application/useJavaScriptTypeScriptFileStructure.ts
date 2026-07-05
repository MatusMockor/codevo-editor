import { useCallback, useState, type MutableRefObject } from "react";
import {
  canUseLanguageServerFeature,
  type LanguageServerDocumentSymbol,
  type LanguageServerFeaturesGateway,
} from "../domain/languageServerFeatures";
import {
  isJavaScriptTypeScriptLanguageServerDocument,
} from "../domain/languageServerDocumentSync";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import {
  emptyPhpFileOutline,
  type PhpFileOutline,
  type PhpFileOutlineNode,
} from "../domain/phpFileOutline";
import {
  getFileName,
  type EditorDocument,
} from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

export interface JavaScriptTypeScriptFileStructureDependencies {
  workspaceRoot: string | null;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  languageServerFeaturesGateway: LanguageServerFeaturesGateway;
  languageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  languageServerRuntimeStatusRoot: string | null;
  isLanguageServerSessionActiveForRoot: (
    rootPath: string,
    sessionId: number,
  ) => boolean;
  reportError: (source: string, error: unknown) => void;
  setMessage: (message: string | null) => void;
  setFileStructureOpen: (open: boolean) => void;
  setFileStructureScopeCurrent: () => void;
}

export interface JavaScriptTypeScriptFileStructure {
  javaScriptTypeScriptFileOutlinesByPath: Record<string, PhpFileOutline>;
  loadingJavaScriptTypeScriptFileOutlinePaths: Set<string>;
  loadJavaScriptTypeScriptFileOutline: (path: string) => Promise<void>;
  openJavaScriptTypeScriptFileStructure: (
    document: EditorDocument,
  ) => boolean;
  javaScriptTypeScriptFileStructureOutlineForDocument: (
    document: EditorDocument | null,
  ) => PhpFileOutline | null;
  javaScriptTypeScriptFileStructureLoadingForDocument: (
    document: EditorDocument | null,
  ) => boolean;
  resetJavaScriptTypeScriptFileStructure: () => void;
}

export function useJavaScriptTypeScriptFileStructure(
  dependencies: JavaScriptTypeScriptFileStructureDependencies,
): JavaScriptTypeScriptFileStructure {
  const {
    workspaceRoot,
    currentWorkspaceRootRef,
    languageServerFeaturesGateway,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    isLanguageServerSessionActiveForRoot,
    reportError,
    setMessage,
    setFileStructureOpen,
    setFileStructureScopeCurrent,
  } = dependencies;
  const [
    javaScriptTypeScriptFileOutlinesByPath,
    setJavaScriptTypeScriptFileOutlinesByPath,
  ] = useState<Record<string, PhpFileOutline>>({});
  const [
    loadingJavaScriptTypeScriptFileOutlinePaths,
    setLoadingJavaScriptTypeScriptFileOutlinePaths,
  ] = useState<Set<string>>(new Set());

  const loadJavaScriptTypeScriptFileOutline = useCallback(
    async (path: string) => {
      if (!workspaceRoot) {
        setJavaScriptTypeScriptFileOutlinesByPath((current) => ({
          ...current,
          [path]: emptyPhpFileOutline(),
        }));
        return;
      }

      if (
        !isRunningLanguageServerForWorkspace(
          languageServerRuntimeStatus,
          languageServerRuntimeStatusRoot,
          workspaceRoot,
        )
      ) {
        return;
      }

      const requestedRoot = workspaceRoot;
      const requestedSessionId = languageServerRuntimeStatus.sessionId;
      const isRequestedJavaScriptTypeScriptSessionActive = () =>
        isLanguageServerSessionActiveForRoot(requestedRoot, requestedSessionId);
      setLoadingJavaScriptTypeScriptFileOutlinePaths((current) =>
        new Set(current).add(path),
      );

      try {
        const symbols = await languageServerFeaturesGateway.documentSymbols(
          requestedRoot,
          path,
        );

        if (!isRequestedJavaScriptTypeScriptSessionActive()) {
          return;
        }

        setJavaScriptTypeScriptFileOutlinesByPath((current) => ({
          ...current,
          [path]: fileOutlineFromLanguageServerDocumentSymbols(
            requestedRoot,
            path,
            symbols,
          ),
        }));
        setMessage(null);
      } catch (error) {
        if (!isRequestedJavaScriptTypeScriptSessionActive()) {
          return;
        }

        setJavaScriptTypeScriptFileOutlinesByPath((current) => ({
          ...current,
          [path]: emptyPhpFileOutline(),
        }));
        reportError("JavaScript/TypeScript File Structure", error);
      } finally {
        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        setLoadingJavaScriptTypeScriptFileOutlinePaths((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
      }
    },
    [
      currentWorkspaceRootRef,
      isLanguageServerSessionActiveForRoot,
      languageServerFeaturesGateway,
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      reportError,
      setMessage,
      workspaceRoot,
    ],
  );

  const openJavaScriptTypeScriptFileStructure = useCallback(
    (document: EditorDocument): boolean => {
      if (!isJavaScriptTypeScriptLanguageServerDocument(document)) {
        return false;
      }

      if (
        !workspaceRoot ||
        !isRunningLanguageServerForWorkspace(
          languageServerRuntimeStatus,
          languageServerRuntimeStatusRoot,
          workspaceRoot,
        )
      ) {
        setMessage("JavaScript/TypeScript service is starting. Try structure again in a moment.");
        return true;
      }

      if (
        !canUseLanguageServerFeature(
          languageServerRuntimeStatus.capabilities,
          "documentSymbol",
        )
      ) {
        setMessage("JavaScript/TypeScript service does not provide file structure.");
        return true;
      }

      setFileStructureScopeCurrent();
      setFileStructureOpen(true);

      if (
        !javaScriptTypeScriptFileOutlinesByPath[document.path] &&
        !loadingJavaScriptTypeScriptFileOutlinePaths.has(document.path)
      ) {
        void loadJavaScriptTypeScriptFileOutline(document.path);
      }

      return true;
    },
    [
      javaScriptTypeScriptFileOutlinesByPath,
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      loadJavaScriptTypeScriptFileOutline,
      loadingJavaScriptTypeScriptFileOutlinePaths,
      setFileStructureOpen,
      setFileStructureScopeCurrent,
      setMessage,
      workspaceRoot,
    ],
  );

  const javaScriptTypeScriptFileStructureOutlineForDocument = useCallback(
    (document: EditorDocument | null): PhpFileOutline | null => {
      if (!document || !isJavaScriptTypeScriptLanguageServerDocument(document)) {
        return null;
      }

      return javaScriptTypeScriptFileOutlinesByPath[document.path] ?? null;
    },
    [javaScriptTypeScriptFileOutlinesByPath],
  );

  const javaScriptTypeScriptFileStructureLoadingForDocument = useCallback(
    (document: EditorDocument | null): boolean =>
      Boolean(
        document &&
          isJavaScriptTypeScriptLanguageServerDocument(document) &&
          loadingJavaScriptTypeScriptFileOutlinePaths.has(document.path),
      ),
    [loadingJavaScriptTypeScriptFileOutlinePaths],
  );

  const resetJavaScriptTypeScriptFileStructure = useCallback(() => {
    setJavaScriptTypeScriptFileOutlinesByPath({});
    setLoadingJavaScriptTypeScriptFileOutlinePaths(new Set());
  }, []);

  return {
    javaScriptTypeScriptFileOutlinesByPath,
    loadingJavaScriptTypeScriptFileOutlinePaths,
    loadJavaScriptTypeScriptFileOutline,
    openJavaScriptTypeScriptFileStructure,
    javaScriptTypeScriptFileStructureOutlineForDocument,
    javaScriptTypeScriptFileStructureLoadingForDocument,
    resetJavaScriptTypeScriptFileStructure,
  };
}

function fileOutlineFromLanguageServerDocumentSymbols(
  workspaceRoot: string,
  path: string,
  symbols: LanguageServerDocumentSymbol[],
): PhpFileOutline {
  return {
    nodes: symbols.map((symbol) =>
      fileOutlineNodeFromLanguageServerDocumentSymbol(
        workspaceRoot,
        path,
        symbol,
        null,
      ),
    ),
  };
}

function fileOutlineNodeFromLanguageServerDocumentSymbol(
  workspaceRoot: string,
  path: string,
  symbol: LanguageServerDocumentSymbol,
  parentName: string | null,
): PhpFileOutlineNode {
  const fullyQualifiedName = parentName
    ? `${parentName}.${symbol.name}`
    : symbol.name;

  return {
    children: symbol.children.map((child) =>
      fileOutlineNodeFromLanguageServerDocumentSymbol(
        workspaceRoot,
        path,
        child,
        fullyQualifiedName,
      ),
    ),
    column: symbol.selectionRange.start.character + 1,
    fullyQualifiedName,
    id: `${path}:${symbol.selectionRange.start.line}:${symbol.selectionRange.start.character}:${fullyQualifiedName}`,
    kind: fileOutlineKindFromLanguageServerSymbolKind(symbol.kind),
    label: symbol.name,
    lineNumber: symbol.selectionRange.start.line + 1,
    path,
    relativePath: relativeWorkspacePath(workspaceRoot, path),
  };
}

function fileOutlineKindFromLanguageServerSymbolKind(
  kind: number,
): PhpFileOutlineNode["kind"] {
  if (kind === 5) {
    return "class";
  }

  if (kind === 6 || kind === 9) {
    return "method";
  }

  if (kind === 7 || kind === 8) {
    return "property";
  }

  if (kind === 10) {
    return "enum";
  }

  if (kind === 11) {
    return "interface";
  }

  if (kind === 12) {
    return "function";
  }

  if (kind === 13) {
    return "variable";
  }

  if (kind === 14 || kind === 22) {
    return "constant";
  }

  return "container";
}

function relativeWorkspacePath(workspaceRoot: string, path: string): string {
  const normalizedRoot = workspaceRoot.replace(/\/+$/, "");
  const normalizedPath = path.split("\\").join("/");

  if (normalizedPath === normalizedRoot) {
    return getFileName(path);
  }

  if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }

  return path;
}

function isRunningLanguageServerForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  statusRoot: string | null,
  workspaceRoot: string | null | undefined,
): status is Extract<LanguageServerRuntimeStatus, { kind: "running" }> {
  if (!isLanguageServerStatusForWorkspace(status, statusRoot, workspaceRoot)) {
    return false;
  }

  return status.kind === "running";
}

function isLanguageServerStatusForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  statusRoot: string | null,
  workspaceRoot: string | null | undefined,
): status is LanguageServerRuntimeStatus {
  if (!workspaceRoot || !status) {
    return false;
  }

  const rootedStatus =
    status.rootPath ?? (status.kind === "stopped" ? statusRoot : null);

  return (
    Boolean(rootedStatus) && workspaceRootKeysEqual(rootedStatus, workspaceRoot)
  );
}
