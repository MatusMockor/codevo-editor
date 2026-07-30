import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
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
  type IdentifiedLanguageServerRequest,
  type JavaScriptTypeScriptLanguageServerFeaturesGateway,
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
import {
  createDefinitionNavigationRequestCoordinator,
  DEFINITION_NAVIGATION_REQUEST_INTERRUPTED,
  type DefinitionNavigationRequestCoordinator,
  type DefinitionNavigationRequestLease,
} from "./definitionNavigationRequestCoordinator";

export interface ImplementationChooserState {
  targets: ImplementationTarget[];
  title: string;
}

export const MAX_NAVIGATION_LOCATION_TARGETS = 64;
export const MAX_NAVIGATION_TARGET_SOURCE_BYTES = 128 * 1024;
export const MAX_NAVIGATION_TARGET_TOTAL_SOURCE_BYTES = 512 * 1024;

interface OpenNavigationOptions {
  readOnly?: boolean;
  shouldCommit?: () => boolean;
  shouldFinalize?: () => boolean;
}

export interface WorkbenchImplementationChooserState {
  implementationChooser: ImplementationChooserState | null;
  setImplementationChooser: (chooser: ImplementationChooserState | null) => void;
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
  flushPendingJavaScriptTypeScriptDocumentChange: (path: string) => Promise<void>;
  goToContextualPhpDefinition: (request?: NavigationRequest) => Promise<boolean>;
  goToIndexedPhpImplementation: (
    position?: EditorPosition,
    request?: NavigationRequest,
  ) => Promise<boolean>;
  goToIndexedSymbolDefinition: (request?: NavigationRequest) => Promise<boolean>;
  identifierAtEditorPosition: (source: string, position: EditorPosition) => string | null;
  documentOffsetAtEditorPosition: (source: string, position: EditorPosition) => number;
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
  javaScriptTypeScriptLanguageServerFeaturesGateway: JavaScriptTypeScriptLanguageServerFeaturesGateway;
  javaScriptTypeScriptLanguageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  javaScriptTypeScriptLanguageServerRuntimeStatusRoot: string | null;
  languageServerFeaturesGateway: LanguageServerFeaturesGateway;
  languageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  languageServerRuntimeStatusRoot: string | null;
  latencyTrackerForRoot: (rootPath: string) => LatencyTracker;
  openPathForNavigation: (path: string, options?: OpenNavigationOptions) => Promise<boolean>;
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
  recordNavigationLocationSnapshot: (location: NavigationLocation | null) => void;
  resolveCurrentWorkspaceRuntimeOwner: () => WorkspaceRuntimeOwner | null;
  setEditorRevealTarget: (target: EditorRevealTarget | null) => void;
  setImplementationChooser: (chooser: ImplementationChooserState | null) => void;
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

export function useWorkbenchImplementationChooserState(): WorkbenchImplementationChooserState {
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
  const implementationChooserCommitPredicateRef = useRef<(() => boolean) | null>(null);
  const implementationChooserFinalizePredicateRef = useRef<(() => boolean) | null>(null);
  const definitionRequestCoordinatorRef = useRef<DefinitionNavigationRequestCoordinator | null>(
    null,
  );
  if (!definitionRequestCoordinatorRef.current) {
    definitionRequestCoordinatorRef.current = createDefinitionNavigationRequestCoordinator();
  }

  useEffect(() => {
    const coordinator =
      definitionRequestCoordinatorRef.current ?? createDefinitionNavigationRequestCoordinator();
    definitionRequestCoordinatorRef.current = coordinator;

    return () => {
      coordinator.dispose();
      if (definitionRequestCoordinatorRef.current === coordinator) {
        definitionRequestCoordinatorRef.current = null;
      }
    };
  }, []);

  const implementationTargetsFromLocations = useCallback(
    async (
      locations: LanguageServerLocation[],
      shouldContinue: () => boolean = () => true,
      requestLease?: DefinitionNavigationRequestLease,
    ): Promise<{ readonly targets: ImplementationTarget[]; readonly truncated: boolean }> => {
      const uniqueTargets = new Map<string, ImplementationTarget>();
      const projectedLocations = locations.slice(0, MAX_NAVIGATION_LOCATION_TARGETS);
      const sourcesByPath = new Map<string, string | null>();
      let retainedSourceBytes = 0;

      for (const location of projectedLocations) {
        if (!shouldContinue()) {
          return { targets: [], truncated: locations.length > projectedLocations.length };
        }

        const path = pathFromLanguageServerUri(location.uri);
        let source: string | null = null;

        if (path) {
          if (sourcesByPath.has(path)) {
            source = sourcesByPath.get(path) ?? null;
          } else {
            try {
              const remainingSourceBytes =
                MAX_NAVIGATION_TARGET_TOTAL_SOURCE_BYTES - retainedSourceBytes;
              const maximumSourceBytes = Math.min(
                MAX_NAVIGATION_TARGET_SOURCE_BYTES,
                remainingSourceBytes,
              );
              const openDocumentSource = documents[path]?.content;
              if (openDocumentSource !== undefined) {
                source = boundedNavigationTargetSource(openDocumentSource, maximumSourceBytes);
              } else if (maximumSourceBytes > 0 && workspaceFiles.readTextFileBounded) {
                const pendingSource = workspaceFiles.readTextFileBounded(path, maximumSourceBytes);
                const resolvedSource = requestLease
                  ? await requestLease.waitFor(pendingSource)
                  : await pendingSource;
                source =
                  resolvedSource === DEFINITION_NAVIGATION_REQUEST_INTERRUPTED ||
                  resolvedSource.status === "tooLarge"
                    ? null
                    : resolvedSource.content;
              }
              sourcesByPath.set(path, source);
              retainedSourceBytes += source ? utf8ByteLength(source) : 0;
            } catch {
              sourcesByPath.set(path, null);
              source = null;
            }
          }
        }

        if (!shouldContinue()) {
          return { targets: [], truncated: locations.length > projectedLocations.length };
        }

        const target = implementationTargetFromLocation(location, source);

        if (!target) {
          continue;
        }

        uniqueTargets.set(target.id, target);
      }

      return {
        targets: [...uniqueTargets.values()],
        truncated: locations.length > projectedLocations.length,
      };
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

      if (!opened || !(options.shouldFinalize?.() ?? shouldCommit())) {
        return false;
      }

      recordNavigationLocationSnapshot(previousLocation);
      setEditorRevealTarget({ path, position });
      setMessage(`Opened ${label} ${getFileName(path)}:${position.lineNumber}:${position.column}`);
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
      const ownerFence = captureWorkspaceRuntimeOwnerFence(resolveCurrentWorkspaceRuntimeOwner);

      if (!ownerFence) {
        return;
      }

      const chooserShouldCommit = implementationChooserCommitPredicateRef.current;
      const chooserShouldFinalize = implementationChooserFinalizePredicateRef.current;
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
            ? shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly(workspaceRoot, target.path)
            : false,
          shouldCommit,
          shouldFinalize: chooserShouldFinalize ?? shouldCommit,
        },
        ownerFence,
      );

      if (!opened || !ownerFence.isCurrent()) {
        return;
      }

      implementationChooserCommitPredicateRef.current = null;
      implementationChooserFinalizePredicateRef.current = null;
      setImplementationChooser(null);
    },
    [
      openNavigationTargetPath,
      resolveCurrentWorkspaceRuntimeOwner,
      setImplementationChooser,
      workspaceRoot,
    ],
  );

  const goToLanguageServerLocation = useCallback(
    async (
      feature: Extract<
        LanguageServerFeature,
        "declaration" | "definition" | "implementation" | "typeDefinition"
      >,
      label: string,
      ownerFence: WorkspaceRuntimeOwnerFence,
      requestedPosition?: EditorPosition,
      definitionRequestLease?: DefinitionNavigationRequestLease,
    ): Promise<boolean> => {
      const document = activeDocumentRef.current;
      const requestedRoot = workspaceRoot;
      const runtimeStatus = languageServerRuntimeStatus;
      const runtimeStatusRoot = languageServerRuntimeStatusRoot;

      if (!document || !requestedRoot || !isLanguageServerDocument(document)) {
        return false;
      }

      if (!isRunningLanguageServerForWorkspace(runtimeStatus, runtimeStatusRoot, requestedRoot)) {
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
      const isRequestedDocumentActive = () =>
        activeDocumentRef.current === document &&
        activeDocumentRef.current?.path === requestedPath &&
        activeDocumentRef.current?.content === document.content &&
        activeDocumentRef.current?.revision === document.revision;
      const isRequestedSessionActive = () =>
        ownerFence.isCurrent() &&
        isLanguageServerSessionActiveForRoot(requestedRoot, requestedSessionId, ownerFence.owner);

      if (feature === "implementation" || feature === "definition") {
        implementationChooserCommitPredicateRef.current = null;
        implementationChooserFinalizePredicateRef.current = null;
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

        const isDocumentLeaseFinalizable = () =>
          isRequestedSessionActive() && isLanguageServerDocumentRequestLeaseCurrent(documentLease);
        const isDocumentLeaseCurrent = () =>
          isDocumentLeaseFinalizable() && isRequestedDocumentActive();
        const isDocumentRequestCurrent = () =>
          isDocumentLeaseCurrent() && definitionRequestLease?.isCurrent() !== false;
        const isDocumentRequestFinalizable = () =>
          isDocumentLeaseFinalizable() && definitionRequestLease?.isRequestCurrent() !== false;

        if (!isDocumentRequestCurrent()) {
          return false;
        }

        if (activeDocumentRef.current?.path !== requestedPath) {
          return false;
        }

        const requestPosition = toLanguageServerTextDocumentPosition(requestedPath, editorPosition);
        const identifiedRequests = languageServerFeaturesGateway.identifiedRequests;
        const identifiedRequest = identifiedRequests?.[feature](
          requestedRoot,
          requestPosition,
          requestedSessionId,
        );
        if (
          definitionRequestLease &&
          identifiedRequest &&
          rejectForeignIdentifiedRequest(
            requestedRoot,
            requestedSessionId,
            identifiedRequest,
            identifiedRequests?.cancelRequest.bind(identifiedRequests),
          )
        ) {
          return false;
        }
        if (identifiedRequest && definitionRequestLease) {
          definitionRequestLease.observeBackendRequest(
            requestedRoot,
            identifiedRequest,
            identifiedRequests?.cancelRequest.bind(identifiedRequests),
          );
        }
        const pendingLocations =
          identifiedRequest ??
          languageServerFeaturesGateway[feature](requestedRoot, requestPosition);
        const measuredLocations =
          feature === "definition"
            ? measureLatency(
                latencyTrackerForRoot(requestedRoot),
                "definition",
                () => pendingLocations,
              )
            : pendingLocations;
        const locations = definitionRequestLease
          ? await definitionRequestLease.waitFor(measuredLocations)
          : await measuredLocations;

        if (locations === DEFINITION_NAVIGATION_REQUEST_INTERRUPTED) {
          return false;
        }

        if (!isDocumentRequestCurrent()) {
          return false;
        }

        const symbolName = identifierAtEditorPosition(document.content, editorPosition);

        if ((feature === "implementation" || feature === "definition") && locations.length > 1) {
          const targetProjection = await implementationTargetsFromLocations(
            locations,
            isDocumentRequestCurrent,
            definitionRequestLease,
          );
          const { targets } = targetProjection;

          if (!isDocumentRequestCurrent()) {
            return false;
          }

          if (targets.length > 1 || (targetProjection.truncated && targets.length > 0)) {
            implementationChooserCommitPredicateRef.current = isDocumentLeaseCurrent;
            implementationChooserFinalizePredicateRef.current = isDocumentLeaseFinalizable;
            setImplementationChooser({
              targets,
              title:
                feature === "definition"
                  ? definitionChooserTitle(
                      symbolName,
                      targetProjection.truncated ? locations.length : null,
                    )
                  : implementationChooserTitle(symbolName),
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
                shouldFinalize: isDocumentRequestFinalizable,
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

        if (!isDocumentRequestCurrent()) {
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

        if (!opened || !isDocumentRequestFinalizable()) {
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
        if (
          !isRequestedSessionActive() ||
          (definitionRequestLease && !definitionRequestLease.isCurrent())
        ) {
          return false;
        }

        reportLanguageServerErrorForActiveWorkspaceRoot(requestedRoot, error);
        return false;
      }
    },
    [
      activeDocumentRef,
      activeEditorPositionRef,
      identifierAtEditorPosition,
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
    ],
  );

  const goToJavaScriptTypeScriptLanguageServerLocation = useCallback(
    async (
      feature: Extract<
        LanguageServerFeature,
        "declaration" | "definition" | "implementation" | "sourceDefinition" | "typeDefinition"
      >,
      label: string,
      ownerFence: WorkspaceRuntimeOwnerFence,
      requestedPosition?: EditorPosition,
      definitionRequestLease?: DefinitionNavigationRequestLease,
    ): Promise<boolean> => {
      const document = activeDocumentRef.current;
      const requestedRoot = workspaceRoot;
      const runtimeStatus = javaScriptTypeScriptLanguageServerRuntimeStatus;
      const runtimeStatusRoot = javaScriptTypeScriptLanguageServerRuntimeStatusRoot;

      if (!document || !requestedRoot || !isJavaScriptTypeScriptLanguageServerDocument(document)) {
        return false;
      }

      if (!isRunningLanguageServerForWorkspace(runtimeStatus, runtimeStatusRoot, requestedRoot)) {
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
      const isRequestedDocumentActive = () =>
        activeDocumentRef.current === document &&
        activeDocumentRef.current?.path === requestedPath &&
        activeDocumentRef.current?.content === document.content &&
        activeDocumentRef.current?.revision === document.revision;
      const isRequestedJavaScriptTypeScriptSessionActive = () =>
        ownerFence.isCurrent() &&
        isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
          requestedRoot,
          requestedSessionId,
          ownerFence.owner,
        );
      const isRequestedJavaScriptTypeScriptDocumentActive = () =>
        isRequestedJavaScriptTypeScriptSessionActive() && isRequestedDocumentActive();
      const isNavigationRequestCurrent = () =>
        isRequestedJavaScriptTypeScriptDocumentActive() &&
        definitionRequestLease?.isCurrent() !== false;
      const isNavigationRequestFinalizable = () =>
        isRequestedJavaScriptTypeScriptSessionActive() &&
        definitionRequestLease?.isRequestCurrent() !== false;

      if (feature === "implementation" || feature === "definition") {
        implementationChooserCommitPredicateRef.current = null;
        implementationChooserFinalizePredicateRef.current = null;
        setImplementationChooser(null);
      }

      try {
        await flushPendingJavaScriptTypeScriptDocumentChange(requestedPath);

        if (!isNavigationRequestCurrent()) {
          return false;
        }

        if (activeDocumentRef.current?.path !== requestedPath) {
          return false;
        }

        const backendRequest = javaScriptTypeScriptLanguageServerFeaturesGateway[feature](
          requestedRoot,
          toLanguageServerTextDocumentPosition(requestedPath, editorPosition),
          requestedSessionId,
        );
        if (
          definitionRequestLease &&
          rejectForeignIdentifiedRequest(
            requestedRoot,
            requestedSessionId,
            backendRequest,
            javaScriptTypeScriptLanguageServerFeaturesGateway.identifiedRequests?.cancelRequest.bind(
              javaScriptTypeScriptLanguageServerFeaturesGateway.identifiedRequests,
            ),
          )
        ) {
          return false;
        }
        if (definitionRequestLease) {
          definitionRequestLease.observeBackendRequest(
            requestedRoot,
            backendRequest,
            javaScriptTypeScriptLanguageServerFeaturesGateway.identifiedRequests?.cancelRequest.bind(
              javaScriptTypeScriptLanguageServerFeaturesGateway.identifiedRequests,
            ),
          );
        }
        const locations = definitionRequestLease
          ? await definitionRequestLease.waitFor(backendRequest)
          : await backendRequest;

        if (locations === DEFINITION_NAVIGATION_REQUEST_INTERRUPTED) {
          return false;
        }

        if (!isNavigationRequestCurrent()) {
          return false;
        }

        const symbolName = identifierAtEditorPosition(document.content, editorPosition);

        if ((feature === "implementation" || feature === "definition") && locations.length > 1) {
          const targetProjection = await implementationTargetsFromLocations(
            locations,
            isNavigationRequestCurrent,
            definitionRequestLease,
          );
          const { targets } = targetProjection;

          if (!isNavigationRequestCurrent()) {
            return false;
          }

          if (targets.length > 1 || (targetProjection.truncated && targets.length > 0)) {
            implementationChooserCommitPredicateRef.current =
              isRequestedJavaScriptTypeScriptDocumentActive;
            implementationChooserFinalizePredicateRef.current =
              isRequestedJavaScriptTypeScriptSessionActive;
            setImplementationChooser({
              targets,
              title:
                feature === "definition"
                  ? definitionChooserTitle(
                      symbolName,
                      targetProjection.truncated ? locations.length : null,
                    )
                  : implementationChooserTitle(symbolName),
            });
            return true;
          }

          const [onlyTarget] = targets;

          if (onlyTarget) {
            if (!isNavigationRequestCurrent()) {
              return false;
            }

            const previousLocation = currentNavigationLocation();
            const opened = await openPathForNavigation(onlyTarget.path, {
              readOnly: shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly(
                requestedRoot,
                onlyTarget.path,
              ),
              shouldCommit: isNavigationRequestCurrent,
              shouldFinalize: isNavigationRequestFinalizable,
            });

            if (!opened) {
              return false;
            }

            if (!isNavigationRequestFinalizable()) {
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

        if (!isNavigationRequestCurrent()) {
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
          shouldCommit: isNavigationRequestCurrent,
        });

        if (!opened) {
          return false;
        }

        if (!isNavigationRequestFinalizable()) {
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
        if (
          !isRequestedJavaScriptTypeScriptSessionActive() ||
          (definitionRequestLease && !definitionRequestLease.isCurrent())
        ) {
          return false;
        }

        reportErrorForActiveWorkspaceRoot(requestedRoot, "JavaScript/TypeScript", error);
        return false;
      }
    },
    [
      activeDocumentRef,
      activeEditorPositionRef,
      flushPendingJavaScriptTypeScriptDocumentChange,
      identifierAtEditorPosition,
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
    ],
  );

  const goToDefinition = useCallback(async () => {
    const ownerFence = captureWorkspaceRuntimeOwnerFence(resolveCurrentWorkspaceRuntimeOwner);

    if (!ownerFence) {
      return;
    }

    const document = activeDocumentRef.current;
    const editorPosition = activeEditorPositionRef.current;
    const requestedRoot = workspaceRoot;
    const definitionRequestLease = definitionRequestCoordinatorRef.current?.begin(
      () =>
        ownerFence.isCurrent() &&
        workspaceRoot === requestedRoot &&
        activeDocumentRef.current === document &&
        activeDocumentRef.current?.path === document?.path &&
        activeDocumentRef.current?.content === document?.content &&
        activeDocumentRef.current?.revision === document?.revision,
    );

    if (!definitionRequestLease) {
      return;
    }

    const waitForDefinitionStep = async <T>(
      step: Promise<T>,
    ): Promise<T | typeof DEFINITION_NAVIGATION_REQUEST_INTERRUPTED> =>
      definitionRequestLease.waitFor(step);

    try {
      if (document?.path.endsWith(".blade.php") && editorPosition) {
        const openedBladeTarget = await waitForDefinitionStep(
          provideBladeDefinition(
            document.content,
            documentOffsetAtEditorPosition(document.content, editorPosition),
            { canNavigate: definitionRequestLease.isCurrent },
          ),
        );

        if (!definitionRequestLease.isCurrent()) {
          return;
        }

        if (openedBladeTarget === true) {
          return;
        }
      }

      if (document?.path.endsWith(".latte") && editorPosition) {
        const offset = documentOffsetAtEditorPosition(document.content, editorPosition);
        const latteDefinition = await waitForDefinitionStep(
          provideLatteDefinitionOutcome(document.content, offset, {
            canNavigate: definitionRequestLease.isCurrent,
          }),
        );

        if (
          !definitionRequestLease.isCurrent() ||
          latteDefinition === DEFINITION_NAVIGATION_REQUEST_INTERRUPTED
        ) {
          return;
        }

        if (latteDefinition.handled || latteDefinition.shouldBlockFallback) {
          return;
        }
      }

      if (document?.path.endsWith(".neon") && editorPosition) {
        const openedNeonTarget = await waitForDefinitionStep(
          provideNeonDefinition(
            document.content,
            documentOffsetAtEditorPosition(document.content, editorPosition),
            { canNavigate: definitionRequestLease.isCurrent },
          ),
        );

        if (!definitionRequestLease.isCurrent()) {
          return;
        }

        if (openedNeonTarget === true) {
          return;
        }
      }

      const openedJavaScriptTypeScriptTarget = await waitForDefinitionStep(
        goToJavaScriptTypeScriptLanguageServerLocation(
          "definition",
          "definition",
          ownerFence,
          undefined,
          definitionRequestLease,
        ),
      );

      if (!definitionRequestLease.isCurrent()) {
        return;
      }

      if (openedJavaScriptTypeScriptTarget === true) {
        return;
      }

      const openedContextualPhpTarget = await waitForDefinitionStep(
        goToContextualPhpDefinition({
          canNavigate: definitionRequestLease.isCurrent,
        }),
      );

      if (!definitionRequestLease.isCurrent()) {
        return;
      }

      if (openedContextualPhpTarget === true) {
        return;
      }

      if (document?.language === "php" && editorPosition) {
        const openedPhpFrameworkTarget = await waitForDefinitionStep(
          providePhpFrameworkDefinition(
            document.content,
            documentOffsetAtEditorPosition(document.content, editorPosition),
            { canNavigate: definitionRequestLease.isCurrent },
          ),
        );

        if (!definitionRequestLease.isCurrent()) {
          return;
        }

        if (openedPhpFrameworkTarget === true) {
          return;
        }
      }

      const openedLanguageServerTarget = await waitForDefinitionStep(
        goToLanguageServerLocation(
          "definition",
          "definition",
          ownerFence,
          undefined,
          definitionRequestLease,
        ),
      );

      if (!definitionRequestLease.isCurrent()) {
        return;
      }

      if (openedLanguageServerTarget === true) {
        return;
      }

      await waitForDefinitionStep(
        goToIndexedSymbolDefinition({
          canNavigate: definitionRequestLease.isCurrent,
        }),
      );
    } finally {
      definitionRequestLease.finish();
    }
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
    workspaceRoot,
  ]);

  const goToSourceDefinition = useCallback(async () => {
    const ownerFence = captureWorkspaceRuntimeOwnerFence(resolveCurrentWorkspaceRuntimeOwner);

    if (!ownerFence) {
      return;
    }

    await goToJavaScriptTypeScriptLanguageServerLocation(
      "sourceDefinition",
      "source definition",
      ownerFence,
    );
  }, [goToJavaScriptTypeScriptLanguageServerLocation, resolveCurrentWorkspaceRuntimeOwner]);

  const goToDeclaration = useCallback(async () => {
    const ownerFence = captureWorkspaceRuntimeOwnerFence(resolveCurrentWorkspaceRuntimeOwner);

    if (!ownerFence) {
      return;
    }

    const openedJavaScriptTypeScriptTarget = await goToJavaScriptTypeScriptLanguageServerLocation(
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

    await goToLanguageServerLocation("declaration", "declaration", ownerFence);
  }, [
    goToJavaScriptTypeScriptLanguageServerLocation,
    goToLanguageServerLocation,
    resolveCurrentWorkspaceRuntimeOwner,
  ]);

  const goToTypeDefinition = useCallback(async () => {
    const ownerFence = captureWorkspaceRuntimeOwnerFence(resolveCurrentWorkspaceRuntimeOwner);

    if (!ownerFence) {
      return;
    }

    const openedJavaScriptTypeScriptTarget = await goToJavaScriptTypeScriptLanguageServerLocation(
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

    await goToLanguageServerLocation("typeDefinition", "type definition", ownerFence);
  }, [
    goToJavaScriptTypeScriptLanguageServerLocation,
    goToLanguageServerLocation,
    resolveCurrentWorkspaceRuntimeOwner,
  ]);

  const goToImplementation = useCallback(async () => {
    const ownerFence = captureWorkspaceRuntimeOwnerFence(resolveCurrentWorkspaceRuntimeOwner);

    if (!ownerFence) {
      return;
    }

    const openedJavaScriptTypeScriptTarget = await goToJavaScriptTypeScriptLanguageServerLocation(
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

  const goToImplementationAt = useCallback(
    async (position: EditorPosition) => {
      const ownerFence = captureWorkspaceRuntimeOwnerFence(resolveCurrentWorkspaceRuntimeOwner);

      if (!ownerFence) {
        return;
      }

      const openedJavaScriptTypeScriptTarget = await goToJavaScriptTypeScriptLanguageServerLocation(
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
    },
    [
      goToIndexedPhpImplementation,
      goToJavaScriptTypeScriptLanguageServerLocation,
      goToLanguageServerLocation,
      resolveCurrentWorkspaceRuntimeOwner,
    ],
  );

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

  const rootedStatus = status.rootPath ?? (status.kind === "stopped" ? statusRoot : null);

  return Boolean(rootedStatus) && workspaceRootKeysEqual(rootedStatus, workspaceRoot);
}

function shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly(
  rootPath: string,
  path: string,
): boolean {
  return isJavaScriptTypeScriptNavigationPath(path) && !isSessionPathInWorkspace(rootPath, path);
}

function boundedNavigationTargetSource(source: string | null, maximumBytes: number): string | null {
  if (!source || maximumBytes <= 0 || source.length > maximumBytes) {
    return null;
  }

  return utf8ByteLength(source) <= maximumBytes ? source : null;
}

function utf8ByteLength(source: string): number {
  return new TextEncoder().encode(source).byteLength;
}

function rejectForeignIdentifiedRequest<T>(
  rootPath: string,
  expectedSessionId: number,
  request: IdentifiedLanguageServerRequest<T>,
  cancelRequest:
    ((rootPath: string, sessionId: number, requestId: number) => Promise<void>) | undefined,
): boolean {
  const validRequestId = Number.isSafeInteger(request.requestId) && request.requestId > 0;
  const validSessionId = Number.isSafeInteger(request.sessionId) && request.sessionId > 0;
  if (request.sessionId === expectedSessionId && validRequestId && validSessionId) {
    return false;
  }

  void request.catch(() => undefined);
  if (cancelRequest && validRequestId && validSessionId) {
    void cancelRequest(rootPath, request.sessionId, request.requestId).catch(() => undefined);
  }
  return true;
}

function definitionChooserTitle(symbolName: string | null, totalLocations: number | null): string {
  const title = `Definitions for ${symbolName ?? "symbol"}`;

  return totalLocations === null
    ? title
    : `${title} (showing a bounded subset of ${totalLocations})`;
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
