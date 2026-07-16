import {
  useCallback,
  useRef,
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
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import type { LatteDefinitionOutcome } from "./latteIntelligenceContracts";
import type { NavigationRequest } from "./navigationRequest";
import type { LanguageServerDocumentRequestLease } from "./useDocumentSync";

export interface ImplementationChooserState {
  targets: ImplementationTarget[];
  title: string;
}

interface OpenNavigationOptions {
  readOnly?: boolean;
  shouldCommit?: () => boolean;
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
  requestLanguageServerDocumentLease: (
    rootPath: string,
    path: string,
  ) => Promise<LanguageServerDocumentRequestLease | null>;
  isLanguageServerDocumentRequestLeaseCurrent: (
    lease: LanguageServerDocumentRequestLease,
  ) => boolean;
  flushPendingJavaScriptTypeScriptDocumentChange: (
    path: string,
  ) => Promise<void>;
  goToContextualPhpDefinition: (
    request?: NavigationRequest,
  ) => Promise<boolean>;
  goToIndexedPhpImplementation: (
    position?: EditorPosition,
    request?: NavigationRequest,
  ) => Promise<boolean>;
  goToIndexedSymbolDefinition: (
    request?: NavigationRequest,
  ) => Promise<boolean>;
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
    owner: WorkspaceRuntimeOwner,
  ) => boolean;
  isLanguageServerSessionActiveForRoot: (
    rootPath: string,
    sessionId: number,
    owner: WorkspaceRuntimeOwner,
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
    request?: NavigationRequest,
  ) => Promise<boolean>;
  provideLatteDefinitionOutcome: (
    source: string,
    offset: number,
    request?: NavigationRequest,
  ) => Promise<LatteDefinitionOutcome>;
  provideNeonDefinition: (
    source: string,
    offset: number,
    request?: NavigationRequest,
  ) => Promise<boolean>;
  providePhpFrameworkDefinition: (
    source: string,
    offset: number,
    request?: NavigationRequest,
  ) => Promise<boolean>;
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
  resolveCurrentWorkspaceRuntimeOwner: () => WorkspaceRuntimeOwner | null;
  setEditorRevealTarget: (target: EditorRevealTarget | null) => void;
  setImplementationChooser: (
    chooser: ImplementationChooserState | null,
  ) => void;
  setMessage: (message: string | null) => void;
  workspaceFiles: WorkspaceFileGateway;
  workspaceRoot: string | null;
}

export interface WorkspaceRuntimeOwnerFence {
  readonly owner: WorkspaceRuntimeOwner;
  isCurrent(): boolean;
}

export function captureWorkspaceRuntimeOwnerFence(
  resolveCurrentOwner: () => WorkspaceRuntimeOwner | null,
): WorkspaceRuntimeOwnerFence | null {
  const owner = resolveCurrentOwner();

  if (!owner) {
    return null;
  }

  return {
    owner,
    isCurrent: () => resolveCurrentOwner()?.ownerKey === owner.ownerKey,
  };
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
    requestLanguageServerDocumentLease,
    isLanguageServerDocumentRequestLeaseCurrent,
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
    provideNeonDefinition,
    providePhpFrameworkDefinition,
    reportErrorForActiveWorkspaceRoot,
    reportLanguageServerErrorForActiveWorkspaceRoot,
    currentNavigationLocation,
    recordNavigationLocationSnapshot,
    resolveCurrentWorkspaceRuntimeOwner,
    setEditorRevealTarget,
    setImplementationChooser,
    setMessage,
    workspaceFiles,
    workspaceRoot,
  } = dependencies;
  const implementationChooserCommitPredicateRef = useRef<
    (() => boolean) | null
  >(null);

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
      ownerFence?: WorkspaceRuntimeOwnerFence,
    ): Promise<boolean> => {
      if (ownerFence && !ownerFence.isCurrent()) {
        return false;
      }

      const shouldCommit = () => {
        if (ownerFence && !ownerFence.isCurrent()) {
          return false;
        }

        return options.shouldCommit?.() !== false;
      };

      if (!shouldCommit()) {
        return false;
      }

      const previousLocation = currentNavigationLocation();
      const opened = await openPathForNavigation(path, {
        ...options,
        shouldCommit,
      });

      if (!opened) {
        return false;
      }

      if (ownerFence && !ownerFence.isCurrent()) {
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
      const ownerFence = captureWorkspaceRuntimeOwnerFence(
        resolveCurrentWorkspaceRuntimeOwner,
      );

      if (!ownerFence) {
        return;
      }

      const chooserShouldCommit =
        implementationChooserCommitPredicateRef.current;
      const shouldCommit = () => {
        if (!ownerFence.isCurrent()) {
          return false;
        }

        return chooserShouldCommit?.() !== false;
      };

      if (!shouldCommit()) {
        return;
      }

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
          shouldCommit,
        },
        ownerFence,
      );

      if (!opened || !ownerFence.isCurrent()) {
        return;
      }

      implementationChooserCommitPredicateRef.current = null;
      setImplementationChooser(null);
    },
    [
      openNavigationTargetPath,
      resolveCurrentWorkspaceRuntimeOwner,
      setImplementationChooser,
      workspaceRoot,
    ],
  );

  const goToLanguageServerLocation = useCallback(async (
    feature: Extract<
      LanguageServerFeature,
      "declaration" | "definition" | "implementation" | "typeDefinition"
    >,
    label: string,
    ownerFence: WorkspaceRuntimeOwnerFence,
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
      ownerFence.isCurrent() &&
      isLanguageServerSessionActiveForRoot(
        requestedRoot,
        requestedSessionId,
        ownerFence.owner,
      );

    if (feature === "implementation") {
      implementationChooserCommitPredicateRef.current = null;
      setImplementationChooser(null);
    }

    try {
      const documentLease = await requestLanguageServerDocumentLease(
        requestedRoot,
        requestedPath,
      );

      if (!documentLease) {
        return false;
      }

      const isDocumentRequestCurrent = () =>
        isRequestedSessionActive() &&
        isLanguageServerDocumentRequestLeaseCurrent(documentLease);

      if (!isDocumentRequestCurrent()) {
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

      if (!isDocumentRequestCurrent()) {
        return false;
      }

      const symbolName = identifierAtEditorPosition(
        document.content,
        editorPosition,
      );

      if (feature === "implementation" && locations.length > 1) {
        const targets = await implementationTargetsFromLocations(
          locations,
          isDocumentRequestCurrent,
        );

        if (!isDocumentRequestCurrent()) {
          return false;
        }

        if (targets.length > 1) {
          implementationChooserCommitPredicateRef.current =
            isDocumentRequestCurrent;
          setImplementationChooser({
            targets,
            title: implementationChooserTitle(symbolName),
          });
          return true;
        }

        const [onlyTarget] = targets;

        if (onlyTarget) {
          if (!isDocumentRequestCurrent()) {
            return false;
          }

          const opened = await openNavigationTargetPath(
            onlyTarget.path,
            onlyTarget.position,
            onlyTarget.label,
            {
              readOnly: shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly(
                requestedRoot,
                onlyTarget.path,
              ),
              shouldCommit: isDocumentRequestCurrent,
            },
            ownerFence,
          );

          if (!opened || !isRequestedSessionActive()) {
            return false;
          }

          setImplementationChooser(null);
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
      const opened = await openPathForNavigation(targetPath, {
        shouldCommit: isDocumentRequestCurrent,
      });

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
    implementationTargetsFromLocations,
    isLanguageServerDocumentRequestLeaseCurrent,
    isLanguageServerSessionActiveForRoot,
    languageServerFeaturesGateway,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    latencyTrackerForRoot,
    openNavigationTargetPath,
    openPathForNavigation,
    currentNavigationLocation,
    recordNavigationLocationSnapshot,
    requestLanguageServerDocumentLease,
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
    ownerFence: WorkspaceRuntimeOwnerFence,
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
    const isRequestedJavaScriptTypeScriptSessionActive = () =>
      ownerFence.isCurrent() &&
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
        requestedRoot,
        requestedSessionId,
        ownerFence.owner,
      );

    if (feature === "implementation") {
      implementationChooserCommitPredicateRef.current = null;
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
          implementationChooserCommitPredicateRef.current =
            isRequestedJavaScriptTypeScriptSessionActive;
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
            shouldCommit: isRequestedJavaScriptTypeScriptSessionActive,
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
        shouldCommit: isRequestedJavaScriptTypeScriptSessionActive,
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
    const ownerFence = captureWorkspaceRuntimeOwnerFence(
      resolveCurrentWorkspaceRuntimeOwner,
    );

    if (!ownerFence) {
      return;
    }

    const document = activeDocumentRef.current;
    const editorPosition = activeEditorPositionRef.current;

    if (document?.path.endsWith(".blade.php") && editorPosition) {
      const openedBladeTarget = await provideBladeDefinition(
        document.content,
        documentOffsetAtEditorPosition(document.content, editorPosition),
        { canNavigate: ownerFence.isCurrent },
      );

      if (!ownerFence.isCurrent()) {
        return;
      }

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
        { canNavigate: ownerFence.isCurrent },
      );

      if (!ownerFence.isCurrent()) {
        return;
      }

      if (latteDefinition.handled || latteDefinition.shouldBlockFallback) {
        return;
      }
    }

    if (document?.path.endsWith(".neon") && editorPosition) {
      const openedNeonTarget = await provideNeonDefinition(
        document.content,
        documentOffsetAtEditorPosition(document.content, editorPosition),
        { canNavigate: ownerFence.isCurrent },
      );

      if (!ownerFence.isCurrent()) {
        return;
      }

      if (openedNeonTarget) {
        return;
      }
    }

    const openedJavaScriptTypeScriptTarget =
      await goToJavaScriptTypeScriptLanguageServerLocation(
        "definition",
        "definition",
        ownerFence,
      );

    if (!ownerFence.isCurrent()) {
      return;
    }

    if (openedJavaScriptTypeScriptTarget) {
      return;
    }

    const openedContextualPhpTarget = await goToContextualPhpDefinition({
      canNavigate: ownerFence.isCurrent,
    });

    if (!ownerFence.isCurrent()) {
      return;
    }

    if (openedContextualPhpTarget) {
      return;
    }

    if (document?.language === "php" && editorPosition) {
      const openedPhpFrameworkTarget = await providePhpFrameworkDefinition(
        document.content,
        documentOffsetAtEditorPosition(document.content, editorPosition),
        { canNavigate: ownerFence.isCurrent },
      );

      if (!ownerFence.isCurrent()) {
        return;
      }

      if (openedPhpFrameworkTarget) {
        return;
      }
    }

    const openedLanguageServerTarget = await goToLanguageServerLocation(
      "definition",
      "definition",
      ownerFence,
    );

    if (!ownerFence.isCurrent()) {
      return;
    }

    if (openedLanguageServerTarget) {
      return;
    }

    await goToIndexedSymbolDefinition({
      canNavigate: ownerFence.isCurrent,
    });
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
    provideNeonDefinition,
    providePhpFrameworkDefinition,
    resolveCurrentWorkspaceRuntimeOwner,
  ]);

  const goToSourceDefinition = useCallback(async () => {
    const ownerFence = captureWorkspaceRuntimeOwnerFence(
      resolveCurrentWorkspaceRuntimeOwner,
    );

    if (!ownerFence) {
      return;
    }

    await goToJavaScriptTypeScriptLanguageServerLocation(
      "sourceDefinition",
      "source definition",
      ownerFence,
    );
  }, [
    goToJavaScriptTypeScriptLanguageServerLocation,
    resolveCurrentWorkspaceRuntimeOwner,
  ]);

  const goToDeclaration = useCallback(async () => {
    const ownerFence = captureWorkspaceRuntimeOwnerFence(
      resolveCurrentWorkspaceRuntimeOwner,
    );

    if (!ownerFence) {
      return;
    }

    const openedJavaScriptTypeScriptTarget =
      await goToJavaScriptTypeScriptLanguageServerLocation(
        "declaration",
        "declaration",
        ownerFence,
      );

    if (!ownerFence.isCurrent()) {
      return;
    }

    if (openedJavaScriptTypeScriptTarget) {
      return;
    }

    await goToLanguageServerLocation(
      "declaration",
      "declaration",
      ownerFence,
    );
  }, [
    goToJavaScriptTypeScriptLanguageServerLocation,
    goToLanguageServerLocation,
    resolveCurrentWorkspaceRuntimeOwner,
  ]);

  const goToTypeDefinition = useCallback(async () => {
    const ownerFence = captureWorkspaceRuntimeOwnerFence(
      resolveCurrentWorkspaceRuntimeOwner,
    );

    if (!ownerFence) {
      return;
    }

    const openedJavaScriptTypeScriptTarget =
      await goToJavaScriptTypeScriptLanguageServerLocation(
        "typeDefinition",
        "type definition",
        ownerFence,
      );

    if (!ownerFence.isCurrent()) {
      return;
    }

    if (openedJavaScriptTypeScriptTarget) {
      return;
    }

    await goToLanguageServerLocation(
      "typeDefinition",
      "type definition",
      ownerFence,
    );
  }, [
    goToJavaScriptTypeScriptLanguageServerLocation,
    goToLanguageServerLocation,
    resolveCurrentWorkspaceRuntimeOwner,
  ]);

  const goToImplementation = useCallback(async () => {
    const ownerFence = captureWorkspaceRuntimeOwnerFence(
      resolveCurrentWorkspaceRuntimeOwner,
    );

    if (!ownerFence) {
      return;
    }

    const openedJavaScriptTypeScriptTarget =
      await goToJavaScriptTypeScriptLanguageServerLocation(
        "implementation",
        "implementation",
        ownerFence,
      );

    if (!ownerFence.isCurrent()) {
      return;
    }

    if (openedJavaScriptTypeScriptTarget) {
      return;
    }

    const openedLanguageServerTarget = await goToLanguageServerLocation(
      "implementation",
      "implementation",
      ownerFence,
    );

    if (!ownerFence.isCurrent()) {
      return;
    }

    if (openedLanguageServerTarget) {
      return;
    }

    await goToIndexedPhpImplementation(undefined, {
      canNavigate: ownerFence.isCurrent,
    });
  }, [
    goToIndexedPhpImplementation,
    goToJavaScriptTypeScriptLanguageServerLocation,
    goToLanguageServerLocation,
    resolveCurrentWorkspaceRuntimeOwner,
  ]);

  const goToImplementationAt = useCallback(async (position: EditorPosition) => {
    const ownerFence = captureWorkspaceRuntimeOwnerFence(
      resolveCurrentWorkspaceRuntimeOwner,
    );

    if (!ownerFence) {
      return;
    }

    const openedJavaScriptTypeScriptTarget =
      await goToJavaScriptTypeScriptLanguageServerLocation(
        "implementation",
        "implementation",
        ownerFence,
        position,
      );

    if (!ownerFence.isCurrent()) {
      return;
    }

    if (openedJavaScriptTypeScriptTarget) {
      return;
    }

    const openedLanguageServerTarget = await goToLanguageServerLocation(
      "implementation",
      "implementation",
      ownerFence,
      position,
    );

    if (!ownerFence.isCurrent()) {
      return;
    }

    if (openedLanguageServerTarget) {
      return;
    }

    await goToIndexedPhpImplementation(position, {
      canNavigate: ownerFence.isCurrent,
    });
  }, [
    goToIndexedPhpImplementation,
    goToJavaScriptTypeScriptLanguageServerLocation,
    goToLanguageServerLocation,
    resolveCurrentWorkspaceRuntimeOwner,
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
