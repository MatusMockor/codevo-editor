import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  editorConfigDirectoriesForFile,
  editorConfigPathForDirectory,
  parseEditorConfig,
  resolveEditorConfigSettings,
  type EditorConfigFile,
  type ResolvedEditorConfig,
} from "../domain/editorConfig";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  editorConfigCacheKey,
  invalidateEditorConfigCacheForRoot,
  type EditorConfigCache,
} from "./editorConfigCache";

export interface WorkbenchEditorConfigLoadDependencies {
  readonly cache: () => EditorConfigCache;
  readonly cacheGeneration?: (rootPath: string) => string;
  readonly currentWorkspaceRoot: () => string | null;
  readonly readTextFile: (path: string) => Promise<string>;
  readonly resolveWorkspaceRuntimeOwner: (rootPath: string) => WorkspaceRuntimeOwner | null;
}

export interface WorkbenchEditorConfigLoadRequest {
  readonly directory: string;
  readonly owner?: WorkspaceRuntimeOwner;
  readonly rootPath: string;
}

interface WorkbenchEditorConfigResolveDependencies {
  readonly cacheGeneration?: () => string;
  readonly isRequestCurrent: () => boolean;
  readonly loadFile: (
    rootPath: string,
    directory: string,
    owner?: WorkspaceRuntimeOwner,
  ) => Promise<EditorConfigFile | null>;
}

interface WorkbenchEditorConfigResolveRequest {
  readonly filePath: string;
  readonly owner?: WorkspaceRuntimeOwner;
  readonly rootPath: string;
}

interface UseWorkbenchEditorConfigCoordinatorOptions {
  readonly activeDocumentPath: string | null;
  readonly activeDocumentRef: MutableRefObject<{ readonly path: string } | null>;
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly readTextFile: (path: string) => Promise<string>;
  readonly resolveWorkspaceRuntimeOwner: (rootPath: string) => WorkspaceRuntimeOwner | null;
  readonly workspaceRoot: string | null;
}

interface WorkbenchEditorConfigCoordinator {
  readonly activeEditorConfig: ResolvedEditorConfig;
  readonly activeEditorConfigRef: MutableRefObject<ResolvedEditorConfig>;
  readonly editorConfigCacheRef: MutableRefObject<EditorConfigCache>;
  readonly invalidateRoot: (rootPath: string) => void;
  readonly refreshRoot: (rootPath: string) => void;
  readonly reset: () => void;
  readonly resolveForFile: (
    rootPath: string,
    filePath: string,
    owner?: WorkspaceRuntimeOwner,
  ) => Promise<ResolvedEditorConfig>;
}

function editorConfigRequestIsCurrent(
  dependencies: Pick<
    WorkbenchEditorConfigLoadDependencies,
    "currentWorkspaceRoot" | "resolveWorkspaceRuntimeOwner"
  >,
  request: Pick<WorkbenchEditorConfigLoadRequest, "owner" | "rootPath">,
): boolean {
  if (!request.owner) {
    return workspaceRootKeysEqual(dependencies.currentWorkspaceRoot(), request.rootPath);
  }

  const currentOwner = dependencies.resolveWorkspaceRuntimeOwner(request.rootPath);
  return (
    currentOwner?.ownerKey === request.owner.ownerKey &&
    workspaceRootKeysEqual(currentOwner.executionRoot, request.owner.executionRoot)
  );
}

export async function loadWorkbenchEditorConfigFile(
  dependencies: WorkbenchEditorConfigLoadDependencies,
  request: WorkbenchEditorConfigLoadRequest,
): Promise<EditorConfigFile | null> {
  const isCurrent = () => editorConfigRequestIsCurrent(dependencies, request);
  if (!isCurrent()) {
    return null;
  }
  const cacheGeneration = dependencies.cacheGeneration?.(request.rootPath) ?? "0:0";

  const cacheKey = editorConfigCacheKey(request.rootPath, request.owner);
  const cacheForRequest = (dependencies.cache()[cacheKey] ??= {});
  if (request.directory in cacheForRequest) {
    return cacheForRequest[request.directory];
  }

  let content: string | null = null;
  try {
    content = await dependencies.readTextFile(editorConfigPathForDirectory(request.directory));
  } catch {
    content = null;
  }

  if (
    !isCurrent() ||
    (dependencies.cacheGeneration?.(request.rootPath) ?? "0:0") !== cacheGeneration
  ) {
    return null;
  }

  const file: EditorConfigFile | null =
    content === null ? null : { directory: request.directory, parsed: parseEditorConfig(content) };
  (dependencies.cache()[cacheKey] ??= {})[request.directory] = file;
  return file;
}

export async function resolveWorkbenchEditorConfigForFile(
  dependencies: WorkbenchEditorConfigResolveDependencies,
  request: WorkbenchEditorConfigResolveRequest,
): Promise<ResolvedEditorConfig> {
  const cacheGeneration = dependencies.cacheGeneration?.() ?? "0:0";
  const requestIsCurrent = () =>
    dependencies.isRequestCurrent() &&
    (dependencies.cacheGeneration?.() ?? "0:0") === cacheGeneration;
  const directories = editorConfigDirectoriesForFile(request.filePath, request.rootPath);
  const files: EditorConfigFile[] = [];

  for (const directory of directories) {
    const file = await dependencies.loadFile(request.rootPath, directory, request.owner);
    if (!requestIsCurrent()) {
      return {};
    }

    if (!file) {
      continue;
    }

    files.push(file);
    if (file.parsed.root) {
      break;
    }
  }

  return requestIsCurrent()
    ? resolveEditorConfigSettings(files, request.filePath, request.rootPath)
    : {};
}

function resolvedEditorConfigsEqual(
  left: ResolvedEditorConfig,
  right: ResolvedEditorConfig,
): boolean {
  return (
    left.charset === right.charset &&
    left.endOfLine === right.endOfLine &&
    left.indentSize === right.indentSize &&
    left.indentStyle === right.indentStyle &&
    left.insertFinalNewline === right.insertFinalNewline &&
    left.tabWidth === right.tabWidth &&
    left.trimTrailingWhitespace === right.trimTrailingWhitespace
  );
}

export function useWorkbenchEditorConfigCoordinator(
  options: UseWorkbenchEditorConfigCoordinatorOptions,
): WorkbenchEditorConfigCoordinator {
  const [resolvedActiveConfig, setResolvedActiveConfig] = useState<{
    path: string;
    refreshVersion: number;
    rootPath: string;
    value: ResolvedEditorConfig;
  } | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const activeEditorConfigRef = useRef<ResolvedEditorConfig>({});
  const editorConfigCacheRef = useRef<EditorConfigCache>({});
  const cacheEpochRef = useRef(0);
  const rootCacheGenerationsRef = useRef<Array<{ generation: number; rootPath: string }>>([]);
  const activeWorkspaceScopeRootRef = useRef<string | null>(null);
  const cacheGeneration = useCallback((rootPath: string) => {
    const generation =
      rootCacheGenerationsRef.current.find((entry) =>
        workspaceRootKeysEqual(entry.rootPath, rootPath),
      )?.generation ?? 0;
    return `${cacheEpochRef.current}:${generation}`;
  }, []);

  const requestIsCurrent = useCallback(
    (rootPath: string, owner?: WorkspaceRuntimeOwner) =>
      editorConfigRequestIsCurrent(
        {
          currentWorkspaceRoot: () => options.currentWorkspaceRootRef.current,
          resolveWorkspaceRuntimeOwner: options.resolveWorkspaceRuntimeOwner,
        },
        { rootPath, ...(owner ? { owner } : {}) },
      ),
    [options.currentWorkspaceRootRef, options.resolveWorkspaceRuntimeOwner],
  );

  const loadFile = useCallback(
    (rootPath: string, directory: string, owner?: WorkspaceRuntimeOwner) =>
      loadWorkbenchEditorConfigFile(
        {
          cache: () => editorConfigCacheRef.current,
          cacheGeneration,
          currentWorkspaceRoot: () => options.currentWorkspaceRootRef.current,
          readTextFile: options.readTextFile,
          resolveWorkspaceRuntimeOwner: options.resolveWorkspaceRuntimeOwner,
        },
        { directory, rootPath, ...(owner ? { owner } : {}) },
      ),
    [
      cacheGeneration,
      options.currentWorkspaceRootRef,
      options.readTextFile,
      options.resolveWorkspaceRuntimeOwner,
    ],
  );

  const resolveForFile = useCallback(
    (rootPath: string, filePath: string, owner?: WorkspaceRuntimeOwner) =>
      resolveWorkbenchEditorConfigForFile(
        {
          cacheGeneration: () => cacheGeneration(rootPath),
          isRequestCurrent: () => requestIsCurrent(rootPath, owner),
          loadFile,
        },
        { filePath, rootPath, ...(owner ? { owner } : {}) },
      ),
    [cacheGeneration, loadFile, requestIsCurrent],
  );

  const invalidateRoot = useCallback((rootPath: string) => {
    invalidateEditorConfigCacheForRoot(editorConfigCacheRef.current, rootPath);
    const existing = rootCacheGenerationsRef.current.find((entry) =>
      workspaceRootKeysEqual(entry.rootPath, rootPath),
    );
    if (existing) existing.generation += 1;
    else rootCacheGenerationsRef.current.push({ generation: 1, rootPath });
  }, []);

  useEffect(() => {
    const previousWorkspaceRoot = activeWorkspaceScopeRootRef.current;
    activeWorkspaceScopeRootRef.current = options.workspaceRoot;
    if (
      options.workspaceRoot &&
      (!previousWorkspaceRoot ||
        !workspaceRootKeysEqual(previousWorkspaceRoot, options.workspaceRoot))
    ) {
      invalidateRoot(options.workspaceRoot);
    }

    if (!options.activeDocumentPath || !options.workspaceRoot) {
      setResolvedActiveConfig(null);
      return;
    }

    const requestedPath = options.activeDocumentPath;
    const requestedRoot = options.workspaceRoot;
    let cancelled = false;

    void resolveForFile(requestedRoot, requestedPath).then((resolved) => {
      if (
        cancelled ||
        !workspaceRootKeysEqual(options.currentWorkspaceRootRef.current, requestedRoot) ||
        options.activeDocumentRef.current?.path !== requestedPath
      ) {
        return;
      }

      setResolvedActiveConfig((current) => {
        if (
          current?.path === requestedPath &&
          current.refreshVersion === refreshVersion &&
          workspaceRootKeysEqual(current.rootPath, requestedRoot) &&
          resolvedEditorConfigsEqual(current.value, resolved)
        ) {
          return current;
        }

        return {
          path: requestedPath,
          refreshVersion,
          rootPath: requestedRoot,
          value: resolved,
        };
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    options.activeDocumentPath,
    options.activeDocumentRef,
    options.currentWorkspaceRootRef,
    options.workspaceRoot,
    invalidateRoot,
    refreshVersion,
    resolveForFile,
  ]);

  const refreshRoot = useCallback(
    (rootPath: string) => {
      invalidateRoot(rootPath);
      if (workspaceRootKeysEqual(options.currentWorkspaceRootRef.current, rootPath)) {
        setRefreshVersion((current) => current + 1);
      }
    },
    [invalidateRoot, options.currentWorkspaceRootRef],
  );
  const reset = useCallback(() => {
    editorConfigCacheRef.current = {};
    cacheEpochRef.current += 1;
    rootCacheGenerationsRef.current = [];
  }, []);

  const activeScopeMatches = Boolean(
    resolvedActiveConfig &&
    options.activeDocumentPath === resolvedActiveConfig.path &&
    options.workspaceRoot &&
    workspaceRootKeysEqual(options.workspaceRoot, resolvedActiveConfig.rootPath) &&
    refreshVersion === resolvedActiveConfig.refreshVersion,
  );
  const activeEditorConfig = activeScopeMatches ? (resolvedActiveConfig?.value ?? {}) : {};
  activeEditorConfigRef.current = activeEditorConfig;

  return {
    activeEditorConfig,
    activeEditorConfigRef,
    editorConfigCacheRef,
    invalidateRoot,
    refreshRoot,
    reset,
    resolveForFile,
  };
}
