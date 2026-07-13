import {
  useCallback,
  useState,
  type MutableRefObject,
} from "react";
import type { NavigationLocation } from "../domain/navigation";
import {
  implementationChooserTitle,
  implementationTargetFromLocation,
  type ImplementationTarget,
} from "../domain/implementationTargets";
import {
  canUseLanguageServerFeature,
  pathFromLanguageServerUri,
  toEditorPosition,
  toLanguageServerTextDocumentPosition,
  type EditorPosition,
  type EditorRevealTarget,
  type LanguageServerFeature,
  type LanguageServerFeaturesGateway,
  type LanguageServerLocation,
} from "../domain/languageServerFeatures";
import {
  isJavaScriptTypeScriptLanguageServerDocument,
  isLanguageServerDocument,
} from "../domain/languageServerDocumentSync";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import { measureLatency, type LatencyTracker } from "../domain/latencyTracker";
import {
  detectLanguage,
  getFileName,
  type EditorDocument,
  type WorkspaceFileGateway,
} from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { LatteDefinitionOutcome } from "./latteIntelligenceContracts";

export interface ImplementationChooserState {
  targets: ImplementationTarget[];
  title: string;
}

interface OpenNavigationOptions {
  readOnly?: boolean;
}

export interface WorkbenchImplementationChooserState {
  implementationChooser: ImplementationChooserState | null;
  setImplementationChooser: (
    chooser: ImplementationChooserState | null,
  ) => void;
}

export interface WorkbenchLanguageNavigationDependencies {
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  activeEditorPositionRef: MutableRefObject<EditorPosition | null>;
  documents: Record<string, EditorDocument>;
  flushPendingDocumentChange: (path: string) => Promise<void>;
  flushPendingJavaScriptTypeScriptDocumentChange: (
    path: string,
  ) => Promise<void>;
  goToContextualPhpDefinition: () => Promise<boolean>;
  goToIndexedPhpImplementation: (
    position?: EditorPosition,
  ) => Promise<boolean>;
  goToIndexedSymbolDefinition: () => Promise<boolean>;
  identifierAtEditorPosition: (
    source: string,
    position: EditorPosition,
  ) => string | null;
  documentOffsetAtEditorPosition: (
    source: string,
    position: EditorPosition,
  ) => number;
  isJavaScriptTypeScriptLanguageServerSessionActiveForRoot: (
    rootPath: string,
    sessionId: number,
  ) => boolean;
  isLanguageServerSessionActiveForRoot: (
    rootPath: string,
    sessionId: number,
  ) => boolean;
  javaScriptTypeScriptLanguageServerFeaturesGateway: LanguageServerFeaturesGateway;
  javaScriptTypeScriptLanguageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  javaScriptTypeScriptLanguageServerRuntimeStatusRoot: string | null;
  languageServerFeaturesGateway: LanguageServerFeaturesGateway;
  languageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  languageServerRuntimeStatusRoot: string | null;
  latencyTrackerForRoot: (rootPath: string) => LatencyTracker;
  openPathForNavigation: (
    path: string,
    options?: OpenNavigationOptions,
  ) => Promise<boolean>;
  provideBladeDefinition: (
    source: string,
    offset: number,
  ) => Promise<boolean>;
  provideLatteDefinitionOutcome: (
    source: string,
    offset: number,
  ) => Promise<LatteDefinitionOutcome>;
  reportErrorForActiveWorkspaceRoot: (
    rootPath: string | null | undefined,
    source: string,
    error: unknown,
  ) => void;
  reportLanguageServerErrorForActiveWorkspaceRoot: (
    rootPath: string | null | undefined,
    error: unknown,
  ) => void;
  currentNavigationLocation: () => NavigationLocation | null;
  recordNavigationLocationSnapshot: (
    location: NavigationLocation | null,
  ) => void;
  setEditorRevealTarget: (target: EditorRevealTarget | null) => void;
  setImplementationChooser: (
    chooser: ImplementationChooserState | null,
  ) => void;
  setMessage: (message: string | null) => void;
  workspaceFiles: WorkspaceFileGateway;
  workspaceRoot: string | null;
}

export interface WorkbenchLanguageNavigation {
  goToDefinition: () => Promise<void>;
  goToSourceDefinition: () => Promise<void>;
  goToDeclaration: () => Promise<void>;
  goToTypeDefinition: () => Promise<void>;
  goToImplementation: () => Promise<void>;
  goToImplementationAt: (position: EditorPosition) => Promise<void>;
  openImplementationTarget: (target: ImplementationTarget) => Promise<void>;
}

export function useWorkbenchImplementationChooserState():
  WorkbenchImplementationChooserState {
  const [implementationChooser, setImplementationChooser] =
    useState<ImplementationChooserState | null>(null);

  return {
    implementationChooser,
    setImplementationChooser,
  };
}

export function useWorkbenchLanguageNavigation(
  dependencies: WorkbenchLanguageNavigationDependencies,
): WorkbenchLanguageNavigation {
  const {
    activeDocumentRef,
    activeEditorPositionRef,
    documents,
    flushPendingDocumentChange,
    flushPendingJavaScriptTypeScriptDocumentChange,
    goToContextualPhpDefinition,
    goToIndexedPhpImplementation,
    goToIndexedSymbolDefinition,
    identifierAtEditorPosition,
    documentOffsetAtEditorPosition,
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
    isLanguageServerSessionActiveForRoot,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    languageServerFeaturesGateway,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    latencyTrackerForRoot,
    openPathForNavigation,
    provideBladeDefinition,
    provideLatteDefinitionOutcome,
    reportErrorForActiveWorkspaceRoot,
    reportLanguageServerErrorForActiveWorkspaceRoot,
    currentNavigationLocation,
    recordNavigationLocationSnapshot,
    setEditorRevealTarget,
    setImplementationChooser,
    setMessage,
    workspaceFiles,
    workspaceRoot,
  } = dependencies;

  const implementationTargetsFromLocations = useCallback(
    async (
      locations: LanguageServerLocation[],
      shouldContinue: () => boolean = () => true,
    ): Promise<ImplementationTarget[]> => {
      const uniqueTargets = new Map<string, ImplementationTarget>();

      for (const location of locations) {
        if (!shouldContinue()) {
          return [];
        }

        const path = pathFromLanguageServerUri(location.uri);
        let source: string | null = null;

        if (path) {
          try {
            source =
              documents[path]?.content ?? (await workspaceFiles.readTextFile(path));
          } catch {
            source = null;
          }
        }

        if (!shouldContinue()) {
          return [];
        }

        const target = implementationTargetFromLocation(location, source);

        if (!target) {
          continue;
        }

        uniqueTargets.set(target.id, target);
      }

      return [...uniqueTargets.values()];
    },
    [documents, workspaceFiles],
  );

  const openNavigationTargetPath = useCallback(
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
      setEditorRevealTarget({ path, position });
      setMessage(
        `Opened ${label} ${getFileName(path)}:${position.lineNumber}:${position.column}`,
      );
      return true;
    },
    [
      currentNavigationLocation,
      openPathForNavigation,
      recordNavigationLocationSnapshot,
      setEditorRevealTarget,
      setMessage,
    ],
  );

  const openImplementationTarget = useCallback(
    async (target: ImplementationTarget) => {
      const opened = await openNavigationTargetPath(
        target.path,
        target.position,
        target.label,
        {
          readOnly: workspaceRoot
            ? shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly(
                workspaceRoot,
                target.path,
              )
            : false,
        },
      );

      if (opened) {
        setImplementationChooser(null);
      }
    },
    [openNavigationTargetPath, setImplementationChooser, workspaceRoot],
  );

  const goToLanguageServerLocation = useCallback(async (
    feature: Extract<
      LanguageServerFeature,
      "declaration" | "definition" | "implementation" | "typeDefinition"
    >,
    label: string,
    requestedPosition?: EditorPosition,
  ): Promise<boolean> => {
    const document = activeDocumentRef.current;
    const requestedRoot = workspaceRoot;
    const runtimeStatus = languageServerRuntimeStatus;
    const runtimeStatusRoot = languageServerRuntimeStatusRoot;

    if (!document || !requestedRoot || !isLanguageServerDocument(document)) {
      return false;
    }

    if (
      !isRunningLanguageServerForWorkspace(
        runtimeStatus,
        runtimeStatusRoot,
        requestedRoot,
      )
    ) {
      return false;
    }

    if (!canUseLanguageServerFeature(runtimeStatus.capabilities, feature)) {
      return false;
    }

    const requestedSessionId = runtimeStatus.sessionId;
    const editorPosition = requestedPosition ?? activeEditorPositionRef.current;

    if (!editorPosition) {
      return false;
    }

    const requestedPath = document.path;
    const isRequestedSessionActive = () =>
      isLanguageServerSessionActiveForRoot(requestedRoot, requestedSessionId);

    if (feature === "implementation") {
      setImplementationChooser(null);
    }

    try {
      await flushPendingDocumentChange(requestedPath);

      if (!isRequestedSessionActive()) {
        return false;
      }

      if (activeDocumentRef.current?.path !== requestedPath) {
        return false;
      }

      const locations =
        feature === "definition"
          ? await measureLatency(
              latencyTrackerForRoot(requestedRoot),
              "definition",
              () =>
                languageServerFeaturesGateway[feature](
                  requestedRoot,
                  toLanguageServerTextDocumentPosition(
                    requestedPath,
                    editorPosition,
                  ),
                ),
            )
          : await languageServerFeaturesGateway[feature](
              requestedRoot,
              toLanguageServerTextDocumentPosition(
                requestedPath,
                editorPosition,
              ),
            );

      if (!isRequestedSessionActive()) {
        return false;
      }

      const symbolName = identifierAtEditorPosition(
        document.content,
        editorPosition,
      );

      if (feature === "implementation" && locations.length > 1) {
        const targets = await implementationTargetsFromLocations(
          locations,
          isRequestedSessionActive,
        );

        if (!isRequestedSessionActive()) {
          return false;
        }

        if (targets.length > 1) {
          setImplementationChooser({
            targets,
            title: implementationChooserTitle(symbolName),
          });
          return true;
        }

        const [onlyTarget] = targets;

        if (onlyTarget) {
          if (!isRequestedSessionActive()) {
            return false;
          }

          await openImplementationTarget(onlyTarget);
          return true;
        }
      }

      const [target] = locations;

      if (!target) {
        return false;
      }

      if (!isRequestedSessionActive()) {
        return false;
      }

      const targetPath = pathFromLanguageServerUri(target.uri);

      if (!targetPath) {
        setMessage(`Could not open ${label} target.`);
        return false;
      }

      const previousLocation = currentNavigationLocation();
      const opened = await openPathForNavigation(targetPath);

      if (!opened) {
        return false;
      }

      if (!isRequestedSessionActive()) {
        return false;
      }

      recordNavigationLocationSnapshot(previousLocation);
      const targetPosition = toEditorPosition(target.range.start);
      setEditorRevealTarget({
        path: targetPath,
        position: targetPosition,
      });
      setMessage(
        `Opened ${label} ${getFileName(targetPath)}:${targetPosition.lineNumber}:${targetPosition.column}`,
      );
      return true;
    } catch (error) {
      if (!isRequestedSessionActive()) {
        return false;
      }

      reportLanguageServerErrorForActiveWorkspaceRoot(requestedRoot, error);
      return false;
    }
  }, [
    activeDocumentRef,
    activeEditorPositionRef,
    flushPendingDocumentChange,
    implementationTargetsFromLocations,
    isLanguageServerSessionActiveForRoot,
    languageServerFeaturesGateway,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    latencyTrackerForRoot,
    openImplementationTarget,
    openPathForNavigation,
    currentNavigationLocation,
    recordNavigationLocationSnapshot,
    reportLanguageServerErrorForActiveWorkspaceRoot,
    setEditorRevealTarget,
    setImplementationChooser,
    setMessage,
    workspaceRoot,
  ]);

  const goToJavaScriptTypeScriptLanguageServerLocation = useCallback(async (
    feature: Extract<
      LanguageServerFeature,
      | "declaration"
      | "definition"
      | "implementation"
      | "sourceDefinition"
      | "typeDefinition"
    >,
    label: string,
    requestedPosition?: EditorPosition,
  ): Promise<boolean> => {
    const document = activeDocumentRef.current;
    const requestedRoot = workspaceRoot;
    const runtimeStatus = javaScriptTypeScriptLanguageServerRuntimeStatus;
    const runtimeStatusRoot = javaScriptTypeScriptLanguageServerRuntimeStatusRoot;

    if (
      !document ||
      !requestedRoot ||
      !isJavaScriptTypeScriptLanguageServerDocument(document)
    ) {
      return false;
    }

    if (
      !isRunningLanguageServerForWorkspace(
        runtimeStatus,
        runtimeStatusRoot,
        requestedRoot,
      )
    ) {
      return false;
    }

    if (!canUseLanguageServerFeature(runtimeStatus.capabilities, feature)) {
      return false;
    }

    const requestedSessionId = runtimeStatus.sessionId;
    const editorPosition = requestedPosition ?? activeEditorPositionRef.current;

    if (!editorPosition) {
      return false;
    }

    const requestedPath = document.path;
    const isRequestedJavaScriptTypeScriptSessionActive = () => {
      return isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
        requestedRoot,
        requestedSessionId,
      );
    };

    if (feature === "implementation") {
      setImplementationChooser(null);
    }

    try {
      await flushPendingJavaScriptTypeScriptDocumentChange(requestedPath);

      if (!isRequestedJavaScriptTypeScriptSessionActive()) {
        return false;
      }

      if (activeDocumentRef.current?.path !== requestedPath) {
        return false;
      }

      const locations =
        await javaScriptTypeScriptLanguageServerFeaturesGateway[feature](
          requestedRoot,
          toLanguageServerTextDocumentPosition(requestedPath, editorPosition),
        );

      if (!isRequestedJavaScriptTypeScriptSessionActive()) {
        return false;
      }

      const symbolName = identifierAtEditorPosition(
        document.content,
        editorPosition,
      );

      if (feature === "implementation" && locations.length > 1) {
        const targets = await implementationTargetsFromLocations(
          locations,
          isRequestedJavaScriptTypeScriptSessionActive,
        );

        if (!isRequestedJavaScriptTypeScriptSessionActive()) {
          return false;
        }

        if (targets.length > 1) {
          setImplementationChooser({
            targets,
            title: implementationChooserTitle(symbolName),
          });
          return true;
        }

        const [onlyTarget] = targets;

        if (onlyTarget) {
          if (!isRequestedJavaScriptTypeScriptSessionActive()) {
            return false;
          }

          const previousLocation = currentNavigationLocation();
          const opened = await openPathForNavigation(onlyTarget.path, {
            readOnly: shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly(
              requestedRoot,
              onlyTarget.path,
            ),
          });

          if (!opened) {
            return false;
          }

          if (!isRequestedJavaScriptTypeScriptSessionActive()) {
            return false;
          }

          recordNavigationLocationSnapshot(previousLocation);
          setImplementationChooser(null);
          setEditorRevealTarget({
            path: onlyTarget.path,
            position: onlyTarget.position,
          });
          const targetPosition = onlyTarget.position;
          setMessage(
            `Opened ${onlyTarget.label} ${getFileName(onlyTarget.path)}:${targetPosition.lineNumber}:${targetPosition.column}`,
          );
          return true;
        }
      }

      const [target] = locations;

      if (!target) {
        return false;
      }

      if (!isRequestedJavaScriptTypeScriptSessionActive()) {
        return false;
      }

      const targetPath = pathFromLanguageServerUri(target.uri);

      if (!targetPath) {
        setMessage(`Could not open ${label} target.`);
        return false;
      }

      const previousLocation = currentNavigationLocation();
      const opened = await openPathForNavigation(targetPath, {
        readOnly: shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly(
          requestedRoot,
          targetPath,
        ),
      });

      if (!opened) {
        return false;
      }

      if (!isRequestedJavaScriptTypeScriptSessionActive()) {
        return false;
      }

      recordNavigationLocationSnapshot(previousLocation);
      const targetPosition = toEditorPosition(target.range.start);
      setEditorRevealTarget({
        path: targetPath,
        position: targetPosition,
      });
      setMessage(
        `Opened ${label} ${getFileName(targetPath)}:${targetPosition.lineNumber}:${targetPosition.column}`,
      );
      return true;
    } catch (error) {
      if (!isRequestedJavaScriptTypeScriptSessionActive()) {
        return false;
      }

      reportErrorForActiveWorkspaceRoot(
        requestedRoot,
        "JavaScript/TypeScript",
        error,
      );
      return false;
    }
  }, [
    activeDocumentRef,
    activeEditorPositionRef,
    flushPendingJavaScriptTypeScriptDocumentChange,
    implementationTargetsFromLocations,
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    openPathForNavigation,
    currentNavigationLocation,
    recordNavigationLocationSnapshot,
    reportErrorForActiveWorkspaceRoot,
    setEditorRevealTarget,
    setImplementationChooser,
    setMessage,
    workspaceRoot,
  ]);

  const goToDefinition = useCallback(async () => {
    const document = activeDocumentRef.current;
    const editorPosition = activeEditorPositionRef.current;

    if (document?.path.endsWith(".blade.php") && editorPosition) {
      const openedBladeTarget = await provideBladeDefinition(
        document.content,
        documentOffsetAtEditorPosition(document.content, editorPosition),
      );

      if (openedBladeTarget) {
        return;
      }
    }

    if (document?.path.endsWith(".latte") && editorPosition) {
      const offset = documentOffsetAtEditorPosition(
        document.content,
        editorPosition,
      );
      const latteDefinition = await provideLatteDefinitionOutcome(
        document.content,
        offset,
      );

      if (latteDefinition.handled || latteDefinition.shouldBlockFallback) {
        return;
      }
    }

    const openedJavaScriptTypeScriptTarget =
      await goToJavaScriptTypeScriptLanguageServerLocation(
        "definition",
        "definition",
      );

    if (openedJavaScriptTypeScriptTarget) {
      return;
    }

    const openedContextualPhpTarget = await goToContextualPhpDefinition();

    if (openedContextualPhpTarget) {
      return;
    }

    const openedLanguageServerTarget = await goToLanguageServerLocation(
      "definition",
      "definition",
    );

    if (openedLanguageServerTarget) {
      return;
    }

    await goToIndexedSymbolDefinition();
  }, [
    activeDocumentRef,
    activeEditorPositionRef,
    documentOffsetAtEditorPosition,
    goToContextualPhpDefinition,
    goToIndexedSymbolDefinition,
    goToJavaScriptTypeScriptLanguageServerLocation,
    goToLanguageServerLocation,
    provideBladeDefinition,
    provideLatteDefinitionOutcome,
  ]);

  const goToSourceDefinition = useCallback(async () => {
    await goToJavaScriptTypeScriptLanguageServerLocation(
      "sourceDefinition",
      "source definition",
    );
  }, [goToJavaScriptTypeScriptLanguageServerLocation]);

  const goToDeclaration = useCallback(async () => {
    const openedJavaScriptTypeScriptTarget =
      await goToJavaScriptTypeScriptLanguageServerLocation(
        "declaration",
        "declaration",
      );

    if (openedJavaScriptTypeScriptTarget) {
      return;
    }

    await goToLanguageServerLocation("declaration", "declaration");
  }, [
    goToJavaScriptTypeScriptLanguageServerLocation,
    goToLanguageServerLocation,
  ]);

  const goToTypeDefinition = useCallback(async () => {
    const openedJavaScriptTypeScriptTarget =
      await goToJavaScriptTypeScriptLanguageServerLocation(
        "typeDefinition",
        "type definition",
      );

    if (openedJavaScriptTypeScriptTarget) {
      return;
    }

    await goToLanguageServerLocation("typeDefinition", "type definition");
  }, [
    goToJavaScriptTypeScriptLanguageServerLocation,
    goToLanguageServerLocation,
  ]);

  const goToImplementation = useCallback(async () => {
    const openedJavaScriptTypeScriptTarget =
      await goToJavaScriptTypeScriptLanguageServerLocation(
        "implementation",
        "implementation",
      );

    if (openedJavaScriptTypeScriptTarget) {
      return;
    }

    const openedLanguageServerTarget = await goToLanguageServerLocation(
      "implementation",
      "implementation",
    );

    if (openedLanguageServerTarget) {
      return;
    }

    await goToIndexedPhpImplementation();
  }, [
    goToIndexedPhpImplementation,
    goToJavaScriptTypeScriptLanguageServerLocation,
    goToLanguageServerLocation,
  ]);

  const goToImplementationAt = useCallback(async (position: EditorPosition) => {
    const openedJavaScriptTypeScriptTarget =
      await goToJavaScriptTypeScriptLanguageServerLocation(
        "implementation",
        "implementation",
        position,
      );

    if (openedJavaScriptTypeScriptTarget) {
      return;
    }

    const openedLanguageServerTarget = await goToLanguageServerLocation(
      "implementation",
      "implementation",
      position,
    );

    if (openedLanguageServerTarget) {
      return;
    }

    await goToIndexedPhpImplementation(position);
  }, [
    goToIndexedPhpImplementation,
    goToJavaScriptTypeScriptLanguageServerLocation,
    goToLanguageServerLocation,
  ]);

  return {
    goToDeclaration,
    goToDefinition,
    goToImplementation,
    goToImplementationAt,
    goToSourceDefinition,
    goToTypeDefinition,
    openImplementationTarget,
  };
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

function shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly(
  rootPath: string,
  path: string,
): boolean {
  return (
    isJavaScriptTypeScriptNavigationPath(path) &&
    !isSessionPathInWorkspace(rootPath, path)
  );
}

function isJavaScriptTypeScriptNavigationPath(path: string): boolean {
  const language = detectLanguage(path);

  return (
    language === "javascript" ||
    language === "javascriptreact" ||
    language === "typescript" ||
    language === "typescriptreact"
  );
}

function isSessionPathInWorkspace(rootPath: string, path: string): boolean {
  const root = normalizedSessionPath(rootPath);
  const candidate = normalizedSessionPath(path);

  if (candidate === root) {
    return true;
  }

  return candidate.startsWith(`${root}/`);
}

function normalizedSessionPath(path: string): string {
  return path.trim().split("\\").join("/").replace(/\/+$/, "");
}
