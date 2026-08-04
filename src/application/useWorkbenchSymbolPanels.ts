import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { CallHierarchyRow, CallHierarchyView } from "../domain/callHierarchy";
import {
  filterFileReferenceLocationsToWorkspace,
  findAllFileReferencesCommand,
} from "../domain/javascriptTypeScriptFileReferences";
import {
  isJavaScriptTypeScriptLanguageServerDocument,
  isLanguageServerDocument,
} from "../domain/languageServerDocumentSync";
import {
  canUseLanguageServerFeature,
  pathFromLanguageServerUri,
  toEditorPosition,
  toLanguageServerTextDocumentPosition,
  type EditorPosition,
  type IdentifiedLanguageServerRequest,
  type JavaScriptTypeScriptLanguageServerFeaturesGateway,
  type LanguageServerFeature,
  type LanguageServerFeaturesGateway,
  type LanguageServerLocation,
  type LanguageServerTextDocumentPosition,
} from "../domain/languageServerFeatures";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import {
  projectReferencesView,
  type ReferenceRow,
  type ReferencesView,
} from "../domain/referencesView";
import type { TypeHierarchyRow, TypeHierarchyView } from "../domain/typeHierarchy";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import {
  captureWorkspaceRuntimeOwnerFence,
  type WorkspaceRuntimeOwnerFence,
} from "./useWorkbenchLanguageNavigation";
import type { LanguageServerDocumentRequestLease } from "./useDocumentSync";

interface OpenNavigationOptions {
  readOnly?: boolean;
  shouldCommit?: () => boolean;
}

type SymbolPanelLanguageServerFeaturesGateway = Pick<
  LanguageServerFeaturesGateway,
  | "incomingCalls"
  | "outgoingCalls"
  | "prepareCallHierarchy"
  | "prepareTypeHierarchy"
  | "typeHierarchySubtypes"
  | "typeHierarchySupertypes"
>;

type JavaScriptTypeScriptSymbolPanelFeaturesGateway = Pick<
  JavaScriptTypeScriptLanguageServerFeaturesGateway,
  keyof SymbolPanelLanguageServerFeaturesGateway | "executeCommandLocations" | "references"
>;

interface LanguageServerFeatureContext {
  featuresGateway: SymbolPanelLanguageServerFeaturesGateway;
  prepareDocumentRequest(path: string): Promise<(() => boolean) | null>;
  references(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ): Promise<LanguageServerLocation[] | typeof SYMBOL_PANEL_REQUEST_TIMED_OUT>;
  isSessionActive(): boolean;
}

const SYMBOL_PANEL_REQUEST_TIMEOUT_MS = 2_500;
const SYMBOL_PANEL_REQUEST_TIMED_OUT = Symbol("symbolPanelRequestTimedOut");

type CancelJavaScriptTypeScriptLanguageServerRequest = (
  rootPath: string,
  sessionId: number,
  requestId: number,
) => Promise<void>;

type BeginReferencesRequest = (cancel: () => void) => () => void;

async function runBoundedSymbolPanelRequest<Result>(
  request: Promise<Result>,
  beginRequest: BeginReferencesRequest,
): Promise<Result | typeof SYMBOL_PANEL_REQUEST_TIMED_OUT> {
  let resolveCancellation: () => void = () => undefined;
  const cancellation = new Promise<typeof SYMBOL_PANEL_REQUEST_TIMED_OUT>((resolve) => {
    resolveCancellation = () => resolve(SYMBOL_PANEL_REQUEST_TIMED_OUT);
  });
  const releaseRequest = beginRequest(resolveCancellation);
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof SYMBOL_PANEL_REQUEST_TIMED_OUT>((resolve) => {
    timeoutHandle = setTimeout(
      () => resolve(SYMBOL_PANEL_REQUEST_TIMED_OUT),
      SYMBOL_PANEL_REQUEST_TIMEOUT_MS,
    );
  });

  return Promise.race([request, timeout, cancellation]).finally(() => {
    clearTimeout(timeoutHandle);
    releaseRequest();
  });
}

async function runBoundedJavaScriptTypeScriptReferencesRequest(
  request: IdentifiedLanguageServerRequest<LanguageServerLocation[]>,
  expectedSessionId: number,
  rootPath: string,
  cancelRequest: CancelJavaScriptTypeScriptLanguageServerRequest,
  beginRequest: BeginReferencesRequest,
): Promise<LanguageServerLocation[] | typeof SYMBOL_PANEL_REQUEST_TIMED_OUT> {
  let resolveCancellation: () => void = () => undefined;
  const cancellation = new Promise<typeof SYMBOL_PANEL_REQUEST_TIMED_OUT>((resolve) => {
    resolveCancellation = () => resolve(SYMBOL_PANEL_REQUEST_TIMED_OUT);
  });
  let cancellationStarted = false;
  const cancelOnce = () => {
    if (cancellationStarted) {
      return;
    }

    cancellationStarted = true;
    resolveCancellation();
    void cancelRequest(rootPath, request.sessionId, request.requestId).catch(() => undefined);
  };

  if (request.sessionId !== expectedSessionId) {
    void request.catch(() => undefined);
    cancelOnce();
    return SYMBOL_PANEL_REQUEST_TIMED_OUT;
  }

  const releaseRequest = beginRequest(cancelOnce);
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof SYMBOL_PANEL_REQUEST_TIMED_OUT>((resolve) => {
    timeoutHandle = setTimeout(() => {
      cancelOnce();
      resolve(SYMBOL_PANEL_REQUEST_TIMED_OUT);
    }, SYMBOL_PANEL_REQUEST_TIMEOUT_MS);
  });

  return Promise.race([request, timeout, cancellation]).finally(() => {
    clearTimeout(timeoutHandle);
    releaseRequest();
  });
}

export interface WorkbenchSymbolPanelsDependencies {
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  activeEditorPositionRef: MutableRefObject<EditorPosition | null>;
  workspaceRoot: string | null;
  languageServerFeaturesGateway: LanguageServerFeaturesGateway;
  languageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  languageServerRuntimeStatusRoot: string | null;
  javaScriptTypeScriptLanguageServerFeaturesGateway: JavaScriptTypeScriptSymbolPanelFeaturesGateway;
  javaScriptTypeScriptLanguageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  javaScriptTypeScriptLanguageServerRuntimeStatusRoot: string | null;
  cancelJavaScriptTypeScriptLanguageServerRequest: CancelJavaScriptTypeScriptLanguageServerRequest;
  requestLanguageServerDocumentLease(
    rootPath: string,
    path: string,
  ): Promise<LanguageServerDocumentRequestLease | null>;
  isLanguageServerDocumentRequestLeaseCurrent(lease: LanguageServerDocumentRequestLease): boolean;
  flushPendingJavaScriptTypeScriptDocumentChange(path: string): Promise<void>;
  isLanguageServerSessionActiveForRoot(
    rootPath: string,
    sessionId: number,
    owner: WorkspaceRuntimeOwner,
  ): boolean;
  isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
    rootPath: string,
    sessionId: number,
    owner: WorkspaceRuntimeOwner,
  ): boolean;
  openNavigationTarget(
    path: string,
    position: EditorPosition,
    label: string,
    options?: OpenNavigationOptions,
  ): Promise<boolean>;
  shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly(rootPath: string, path: string): boolean;
  closeCompetingSurfaces(): void;
  reportError(source: string, error: unknown): void;
  resolveCurrentWorkspaceRuntimeOwner(): WorkspaceRuntimeOwner | null;
  setMessage: Dispatch<SetStateAction<string | null>>;
}

export interface WorkbenchSymbolPanels {
  callHierarchyView: CallHierarchyView | null;
  typeHierarchyView: TypeHierarchyView | null;
  referencesView: ReferencesView | null;
  setCallHierarchyView: Dispatch<SetStateAction<CallHierarchyView | null>>;
  setTypeHierarchyView: Dispatch<SetStateAction<TypeHierarchyView | null>>;
  setReferencesView: Dispatch<SetStateAction<ReferencesView | null>>;
  openCallHierarchyRow(row: CallHierarchyRow): Promise<void>;
  openTypeHierarchyRow(row: TypeHierarchyRow): Promise<void>;
  openReferenceRow(row: ReferenceRow): Promise<void>;
  openCallHierarchy(): Promise<void>;
  openTypeHierarchy(): Promise<void>;
  openReferencesPanel(): Promise<void>;
  openFileReferencesPanel(): Promise<void>;
}

export function useWorkbenchSymbolPanels(
  dependencies: WorkbenchSymbolPanelsDependencies,
): WorkbenchSymbolPanels {
  const {
    activeDocumentRef,
    activeEditorPositionRef,
    workspaceRoot,
    languageServerFeaturesGateway,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    cancelJavaScriptTypeScriptLanguageServerRequest,
    requestLanguageServerDocumentLease,
    isLanguageServerDocumentRequestLeaseCurrent,
    flushPendingJavaScriptTypeScriptDocumentChange,
    isLanguageServerSessionActiveForRoot,
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
    openNavigationTarget,
    shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly,
    closeCompetingSurfaces,
    reportError,
    resolveCurrentWorkspaceRuntimeOwner,
    setMessage,
  } = dependencies;

  const [callHierarchyView, setCallHierarchyView] = useState<CallHierarchyView | null>(null);
  const [typeHierarchyView, setTypeHierarchyView] = useState<TypeHierarchyView | null>(null);
  const [referencesView, setReferencesViewState] = useState<ReferencesView | null>(null);
  const referencesRequestGenerationRef = useRef(0);
  const activeReferencesRequestRef = useRef<{
    cancel(): void;
  } | null>(null);
  const cancelActiveReferencesRequest = useCallback(() => {
    const request = activeReferencesRequestRef.current;
    activeReferencesRequestRef.current = null;
    request?.cancel();
  }, []);
  const beginReferencesRequest = useCallback(
    (cancel: () => void) => {
      cancelActiveReferencesRequest();
      const request = { cancel };
      activeReferencesRequestRef.current = request;

      return () => {
        if (activeReferencesRequestRef.current === request) {
          activeReferencesRequestRef.current = null;
        }
      };
    },
    [cancelActiveReferencesRequest],
  );
  const setReferencesView = useCallback<Dispatch<SetStateAction<ReferencesView | null>>>(
    (view) => {
      cancelActiveReferencesRequest();
      referencesRequestGenerationRef.current += 1;
      setReferencesViewState(view);
    },
    [cancelActiveReferencesRequest],
  );

  useEffect(
    () => () => {
      cancelActiveReferencesRequest();
      referencesRequestGenerationRef.current += 1;
    },
    [cancelActiveReferencesRequest],
  );

  const closeSymbolPanels = useCallback(() => {
    closeCompetingSurfaces();
    setCallHierarchyView(null);
    setTypeHierarchyView(null);
    setReferencesView(null);
  }, [closeCompetingSurfaces, setReferencesView]);

  const languageServerFeatureContext = useCallback(
    (
      document: EditorDocument,
      feature: LanguageServerFeature,
      unavailableMessage: string,
      startingMessage: string,
      javaScriptTypeScriptUnavailableMessage: string,
      javaScriptTypeScriptStartingMessage: string,
      ownerFence: WorkspaceRuntimeOwnerFence,
    ): LanguageServerFeatureContext | null => {
      if (!workspaceRoot) {
        return null;
      }

      if (isLanguageServerDocument(document)) {
        if (
          !isRunningLanguageServerForWorkspace(
            languageServerRuntimeStatus,
            languageServerRuntimeStatusRoot,
            workspaceRoot,
          )
        ) {
          setMessage(startingMessage);
          return null;
        }

        if (!canUseLanguageServerFeature(languageServerRuntimeStatus.capabilities, feature)) {
          setMessage(unavailableMessage);
          return null;
        }

        const isSessionActive = () =>
          ownerFence.isCurrent() &&
          isLanguageServerSessionActiveForRoot(
            workspaceRoot,
            languageServerRuntimeStatus.sessionId,
            ownerFence.owner,
          );

        return {
          featuresGateway: languageServerFeaturesGateway,
          isSessionActive,
          references: (rootPath, position) =>
            runBoundedSymbolPanelRequest(
              languageServerFeaturesGateway.references(rootPath, position),
              beginReferencesRequest,
            ),
          prepareDocumentRequest: async (path) => {
            const lease = await requestLanguageServerDocumentLease(workspaceRoot, path);

            if (!lease) {
              return null;
            }

            return () => isSessionActive() && isLanguageServerDocumentRequestLeaseCurrent(lease);
          },
        };
      }

      if (
        !isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          workspaceRoot,
        )
      ) {
        setMessage(javaScriptTypeScriptStartingMessage);
        return null;
      }

      if (
        !canUseLanguageServerFeature(
          javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
          feature,
        )
      ) {
        setMessage(javaScriptTypeScriptUnavailableMessage);
        return null;
      }

      return {
        featuresGateway: javaScriptTypeScriptLanguageServerFeaturesGateway,
        isSessionActive: () =>
          ownerFence.isCurrent() &&
          isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
            workspaceRoot,
            javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId,
            ownerFence.owner,
          ),
        references: (rootPath, position) => {
          const requestedSessionId = javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;
          const request = javaScriptTypeScriptLanguageServerFeaturesGateway.references(
            rootPath,
            position,
            true,
            requestedSessionId,
          );
          return runBoundedJavaScriptTypeScriptReferencesRequest(
            request,
            requestedSessionId,
            rootPath,
            cancelJavaScriptTypeScriptLanguageServerRequest,
            beginReferencesRequest,
          );
        },
        prepareDocumentRequest: async (path) => {
          await flushPendingJavaScriptTypeScriptDocumentChange(path);
          return () =>
            ownerFence.isCurrent() &&
            isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
              workspaceRoot,
              javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId,
              ownerFence.owner,
            );
        },
      };
    },
    [
      beginReferencesRequest,
      flushPendingJavaScriptTypeScriptDocumentChange,
      cancelJavaScriptTypeScriptLanguageServerRequest,
      isLanguageServerDocumentRequestLeaseCurrent,
      isLanguageServerSessionActiveForRoot,
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      languageServerFeaturesGateway,
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      requestLanguageServerDocumentLease,
      setMessage,
      workspaceRoot,
    ],
  );

  const openCallHierarchyRow = useCallback(
    async (row: CallHierarchyRow) => {
      const ownerFence = captureWorkspaceRuntimeOwnerFence(resolveCurrentWorkspaceRuntimeOwner);

      if (!ownerFence) {
        return;
      }

      const path = pathFromLanguageServerUri(row.item.uri);

      if (!path) {
        setMessage("Could not open call hierarchy target.");
        return;
      }

      const opened = await openNavigationTarget(
        path,
        toEditorPosition(row.range.start),
        row.label,
        {
          readOnly: workspaceRoot
            ? shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly(workspaceRoot, path)
            : false,
          shouldCommit: ownerFence.isCurrent,
        },
      );

      if (!opened || !ownerFence.isCurrent()) {
        return;
      }

      setCallHierarchyView(null);
    },
    [
      openNavigationTarget,
      resolveCurrentWorkspaceRuntimeOwner,
      setMessage,
      shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly,
      workspaceRoot,
    ],
  );

  const openTypeHierarchyRow = useCallback(
    async (row: TypeHierarchyRow) => {
      const ownerFence = captureWorkspaceRuntimeOwnerFence(resolveCurrentWorkspaceRuntimeOwner);

      if (!ownerFence) {
        return;
      }

      const path = pathFromLanguageServerUri(row.item.uri);

      if (!path) {
        setMessage("Could not open type hierarchy target.");
        return;
      }

      const opened = await openNavigationTarget(
        path,
        toEditorPosition(row.range.start),
        row.label,
        {
          readOnly: workspaceRoot
            ? shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly(workspaceRoot, path)
            : false,
          shouldCommit: ownerFence.isCurrent,
        },
      );

      if (!opened || !ownerFence.isCurrent()) {
        return;
      }

      setTypeHierarchyView(null);
    },
    [
      openNavigationTarget,
      resolveCurrentWorkspaceRuntimeOwner,
      setMessage,
      shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly,
      workspaceRoot,
    ],
  );

  const openReferenceRow = useCallback(
    async (row: ReferenceRow) => {
      const ownerFence = captureWorkspaceRuntimeOwnerFence(resolveCurrentWorkspaceRuntimeOwner);

      if (!ownerFence) {
        return;
      }

      const opened = await openNavigationTarget(
        row.path,
        toEditorPosition(row.location.range.start),
        "reference",
        {
          readOnly: workspaceRoot
            ? shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly(workspaceRoot, row.path)
            : false,
          shouldCommit: ownerFence.isCurrent,
        },
      );

      if (!opened || !ownerFence.isCurrent()) {
        return;
      }

      setReferencesView(null);
    },
    [
      openNavigationTarget,
      resolveCurrentWorkspaceRuntimeOwner,
      setReferencesView,
      shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly,
      workspaceRoot,
    ],
  );

  const openCallHierarchy = useCallback(async () => {
    const ownerFence = captureWorkspaceRuntimeOwnerFence(resolveCurrentWorkspaceRuntimeOwner);

    if (!ownerFence) {
      return;
    }

    const document = activeDocumentRef.current;
    if (!document) {
      setMessage("Open a PHP, JavaScript, or TypeScript file to show call hierarchy.");
      return;
    }

    if (!isLanguageServerPanelDocument(document, workspaceRoot)) {
      setMessage("Call hierarchy is available for PHP, JavaScript, and TypeScript files.");
      return;
    }

    const context = languageServerFeatureContext(
      document,
      "callHierarchy",
      "PHP language server does not provide call hierarchy.",
      "PHP language server is starting. Try call hierarchy again in a moment.",
      "JavaScript/TypeScript service does not provide call hierarchy.",
      "JavaScript/TypeScript service is starting. Try call hierarchy again in a moment.",
      ownerFence,
    );

    if (!context || !workspaceRoot) {
      return;
    }

    const editorPosition = activeEditorPositionRef.current;

    if (!editorPosition) {
      setMessage("Place the cursor on a symbol to show call hierarchy.");
      return;
    }

    const requestedRoot = workspaceRoot;
    const requestedPath = document.path;
    let isRequestedSessionActive = context.isSessionActive;
    closeSymbolPanels();

    try {
      const documentRequest = await context.prepareDocumentRequest(requestedPath);

      if (!documentRequest || !documentRequest()) {
        return;
      }

      isRequestedSessionActive = documentRequest;

      const [item] = await context.featuresGateway.prepareCallHierarchy(
        requestedRoot,
        toLanguageServerTextDocumentPosition(requestedPath, editorPosition),
      );

      if (!isRequestedSessionActive()) {
        return;
      }

      if (!item) {
        setMessage("No call hierarchy available for this symbol.");
        return;
      }

      const [incoming, outgoing] = await Promise.all([
        context.featuresGateway.incomingCalls(requestedRoot, item),
        context.featuresGateway.outgoingCalls(requestedRoot, item),
      ]);

      if (!isRequestedSessionActive()) {
        return;
      }

      setCallHierarchyView({
        incoming,
        item,
        outgoing,
      });
      setMessage(null);
    } catch (error) {
      if (!isRequestedSessionActive()) {
        return;
      }

      reportError("Call Hierarchy", error);
    }
  }, [
    activeDocumentRef,
    activeEditorPositionRef,
    closeSymbolPanels,
    languageServerFeatureContext,
    reportError,
    resolveCurrentWorkspaceRuntimeOwner,
    setMessage,
    workspaceRoot,
  ]);

  const openTypeHierarchy = useCallback(async () => {
    const ownerFence = captureWorkspaceRuntimeOwnerFence(resolveCurrentWorkspaceRuntimeOwner);

    if (!ownerFence) {
      return;
    }

    const document = activeDocumentRef.current;
    if (!document) {
      setMessage("Open a PHP, JavaScript, or TypeScript file to show type hierarchy.");
      return;
    }

    if (!isLanguageServerPanelDocument(document, workspaceRoot)) {
      setMessage("Type hierarchy is available for PHP, JavaScript, and TypeScript files.");
      return;
    }

    const context = languageServerFeatureContext(
      document,
      "typeHierarchy",
      "PHP language server does not provide type hierarchy.",
      "PHP language server is starting. Try type hierarchy again in a moment.",
      "JavaScript/TypeScript service does not provide type hierarchy.",
      "JavaScript/TypeScript service is starting. Try type hierarchy again in a moment.",
      ownerFence,
    );

    if (!context || !workspaceRoot) {
      return;
    }

    const editorPosition = activeEditorPositionRef.current;

    if (!editorPosition) {
      setMessage("Place the cursor on a type to show type hierarchy.");
      return;
    }

    const requestedRoot = workspaceRoot;
    const requestedPath = document.path;
    let isRequestedSessionActive = context.isSessionActive;
    closeSymbolPanels();

    try {
      const documentRequest = await context.prepareDocumentRequest(requestedPath);

      if (!documentRequest || !documentRequest()) {
        return;
      }

      isRequestedSessionActive = documentRequest;

      const [item] = await context.featuresGateway.prepareTypeHierarchy(
        requestedRoot,
        toLanguageServerTextDocumentPosition(requestedPath, editorPosition),
      );

      if (!isRequestedSessionActive()) {
        return;
      }

      if (!item) {
        setMessage("No type hierarchy available for this symbol.");
        return;
      }

      const [supertypes, subtypes] = await Promise.all([
        context.featuresGateway.typeHierarchySupertypes(requestedRoot, item),
        context.featuresGateway.typeHierarchySubtypes(requestedRoot, item),
      ]);

      if (!isRequestedSessionActive()) {
        return;
      }

      setTypeHierarchyView({
        item,
        subtypes,
        supertypes,
      });
      setMessage(null);
    } catch (error) {
      if (!isRequestedSessionActive()) {
        return;
      }

      reportError("Type Hierarchy", error);
    }
  }, [
    activeDocumentRef,
    activeEditorPositionRef,
    closeSymbolPanels,
    languageServerFeatureContext,
    reportError,
    resolveCurrentWorkspaceRuntimeOwner,
    setMessage,
    workspaceRoot,
  ]);

  const openReferencesPanel = useCallback(async () => {
    const ownerFence = captureWorkspaceRuntimeOwnerFence(resolveCurrentWorkspaceRuntimeOwner);

    if (!ownerFence) {
      return;
    }

    const document = activeDocumentRef.current;
    if (!document) {
      setMessage("Open a PHP, JavaScript, or TypeScript file to find references.");
      return;
    }

    if (!isLanguageServerPanelDocument(document, workspaceRoot)) {
      setMessage("Find references is available for PHP, JavaScript, and TypeScript files.");
      return;
    }

    const context = languageServerFeatureContext(
      document,
      "references",
      "PHP language server does not provide references.",
      "PHP language server is starting. Try find references again in a moment.",
      "JavaScript/TypeScript service does not provide references.",
      "JavaScript/TypeScript service is starting. Try find references again in a moment.",
      ownerFence,
    );

    if (!context || !workspaceRoot) {
      return;
    }

    const editorPosition = activeEditorPositionRef.current;

    if (!editorPosition) {
      setMessage("Place the cursor on a symbol to find references.");
      return;
    }

    const symbolName = identifierAtEditorPosition(document.content, editorPosition) ?? "symbol";
    const requestedRoot = workspaceRoot;
    const requestedPath = document.path;
    let isRequestedSessionActive = context.isSessionActive;
    closeSymbolPanels();
    const requestGeneration = referencesRequestGenerationRef.current;
    const isReferencesRequestCurrent = () =>
      referencesRequestGenerationRef.current === requestGeneration && isRequestedSessionActive();

    try {
      const documentRequest = await context.prepareDocumentRequest(requestedPath);

      if (!documentRequest || !isReferencesRequestCurrent() || !documentRequest()) {
        return;
      }

      isRequestedSessionActive = documentRequest;

      const locations = await context.references(
        requestedRoot,
        toLanguageServerTextDocumentPosition(requestedPath, editorPosition),
      );

      if (locations === SYMBOL_PANEL_REQUEST_TIMED_OUT || !isReferencesRequestCurrent()) {
        return;
      }

      if (locations.length === 0) {
        const view = projectReferencesView(symbolName, locations);
        setReferencesView(view);
        setMessage(
          view.isIncomplete
            ? `References for ${symbolName} were limited by safety bounds.`
            : `No references found for ${symbolName}.`,
        );
        return;
      }

      setReferencesView(projectReferencesView(symbolName, locations));
      setMessage(null);
    } catch (error) {
      if (!isReferencesRequestCurrent()) {
        return;
      }

      reportError("Find References", error);
    }
  }, [
    activeDocumentRef,
    activeEditorPositionRef,
    closeSymbolPanels,
    languageServerFeatureContext,
    reportError,
    resolveCurrentWorkspaceRuntimeOwner,
    setMessage,
    setReferencesView,
    workspaceRoot,
  ]);

  const openFileReferencesPanel = useCallback(async () => {
    const ownerFence = captureWorkspaceRuntimeOwnerFence(resolveCurrentWorkspaceRuntimeOwner);

    if (!ownerFence) {
      return;
    }

    const document = activeDocumentRef.current;

    if (!document || !workspaceRoot) {
      setMessage("Open a JavaScript or TypeScript file to find file references.");
      return;
    }

    if (!isJavaScriptTypeScriptLanguageServerDocument(document)) {
      setMessage("Find File References is available for JavaScript and TypeScript files.");
      return;
    }

    if (
      !isRunningLanguageServerForWorkspace(
        javaScriptTypeScriptLanguageServerRuntimeStatus,
        javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
        workspaceRoot,
      )
    ) {
      setMessage(
        "JavaScript/TypeScript service is starting. Try find file references again in a moment.",
      );
      return;
    }

    const requestedRoot = workspaceRoot;
    const requestedPath = document.path;
    const requestedSessionId = javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;
    const isRequestedSessionActive = () =>
      ownerFence.isCurrent() &&
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
        requestedRoot,
        requestedSessionId,
        ownerFence.owner,
      );

    closeSymbolPanels();
    const requestGeneration = referencesRequestGenerationRef.current;
    const isReferencesRequestCurrent = () =>
      referencesRequestGenerationRef.current === requestGeneration && isRequestedSessionActive();

    try {
      await flushPendingJavaScriptTypeScriptDocumentChange(requestedPath);

      if (!isReferencesRequestCurrent()) {
        return;
      }

      const locations = await runBoundedJavaScriptTypeScriptReferencesRequest(
        javaScriptTypeScriptLanguageServerFeaturesGateway.executeCommandLocations(
          requestedRoot,
          findAllFileReferencesCommand(requestedPath),
          requestedSessionId,
        ),
        requestedSessionId,
        requestedRoot,
        cancelJavaScriptTypeScriptLanguageServerRequest,
        beginReferencesRequest,
      );

      if (locations === SYMBOL_PANEL_REQUEST_TIMED_OUT || !isReferencesRequestCurrent()) {
        return;
      }

      const workspaceLocations = filterFileReferenceLocationsToWorkspace(locations, requestedRoot);
      const symbol = document.name;

      if (workspaceLocations.length === 0) {
        const view = projectReferencesView(symbol, workspaceLocations);
        setReferencesView(view);
        setMessage(
          view.isIncomplete
            ? `File references for ${symbol} were limited by safety bounds.`
            : `No file references found for ${symbol}.`,
        );
        return;
      }

      setReferencesView(projectReferencesView(symbol, workspaceLocations));
      setMessage(null);
    } catch (error) {
      if (!isReferencesRequestCurrent()) {
        return;
      }

      reportError("Find File References", error);
    }
  }, [
    activeDocumentRef,
    beginReferencesRequest,
    cancelJavaScriptTypeScriptLanguageServerRequest,
    closeSymbolPanels,
    flushPendingJavaScriptTypeScriptDocumentChange,
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    reportError,
    resolveCurrentWorkspaceRuntimeOwner,
    setMessage,
    setReferencesView,
    workspaceRoot,
  ]);

  return {
    callHierarchyView,
    typeHierarchyView,
    referencesView,
    setCallHierarchyView,
    setTypeHierarchyView,
    setReferencesView,
    openCallHierarchyRow,
    openTypeHierarchyRow,
    openReferenceRow,
    openCallHierarchy,
    openTypeHierarchy,
    openReferencesPanel,
    openFileReferencesPanel,
  };
}

function isLanguageServerPanelDocument(
  document: EditorDocument,
  workspaceRoot: string | null,
): boolean {
  return (
    Boolean(workspaceRoot) &&
    (isLanguageServerDocument(document) || isJavaScriptTypeScriptLanguageServerDocument(document))
  );
}

function identifierAtEditorPosition(source: string, position: EditorPosition): string | null {
  const line = source.split(/\r?\n/)[position.lineNumber - 1] ?? "";
  const cursorIndex = Math.max(0, Math.min(line.length, position.column - 1));
  const matches = line.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g);

  for (const match of matches) {
    const start = match.index ?? 0;
    const end = start + match[0].length;

    if (cursorIndex >= start && cursorIndex <= end) {
      return match[0];
    }
  }

  return null;
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
