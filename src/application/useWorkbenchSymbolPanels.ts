import {
  useCallback,
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
  type LanguageServerFeature,
  type LanguageServerFeaturesGateway,
} from "../domain/languageServerFeatures";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import type { ReferenceRow, ReferencesView } from "../domain/referencesView";
import type { TypeHierarchyRow, TypeHierarchyView } from "../domain/typeHierarchy";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import {
  captureWorkspaceRuntimeOwnerFence,
  type WorkspaceRuntimeOwnerFence,
} from "./useWorkbenchLanguageNavigation";

interface OpenNavigationOptions {
  readOnly?: boolean;
  shouldCommit?: () => boolean;
}

interface LanguageServerFeatureContext {
  featuresGateway: LanguageServerFeaturesGateway;
  flushPendingChange(path: string): Promise<void>;
  isSessionActive(): boolean;
}

export interface WorkbenchSymbolPanelsDependencies {
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  activeEditorPositionRef: MutableRefObject<EditorPosition | null>;
  workspaceRoot: string | null;
  languageServerFeaturesGateway: LanguageServerFeaturesGateway;
  languageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  languageServerRuntimeStatusRoot: string | null;
  javaScriptTypeScriptLanguageServerFeaturesGateway: LanguageServerFeaturesGateway;
  javaScriptTypeScriptLanguageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  javaScriptTypeScriptLanguageServerRuntimeStatusRoot: string | null;
  flushPendingDocumentChange(path: string): Promise<void>;
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
  shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly(
    rootPath: string,
    path: string,
  ): boolean;
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
    flushPendingDocumentChange,
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

  const [callHierarchyView, setCallHierarchyView] =
    useState<CallHierarchyView | null>(null);
  const [typeHierarchyView, setTypeHierarchyView] =
    useState<TypeHierarchyView | null>(null);
  const [referencesView, setReferencesView] =
    useState<ReferencesView | null>(null);

  const closeSymbolPanels = useCallback(() => {
    closeCompetingSurfaces();
    setCallHierarchyView(null);
    setTypeHierarchyView(null);
    setReferencesView(null);
  }, [closeCompetingSurfaces]);

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

        if (
          !canUseLanguageServerFeature(
            languageServerRuntimeStatus.capabilities,
            feature,
          )
        ) {
          setMessage(unavailableMessage);
          return null;
        }

        return {
          featuresGateway: languageServerFeaturesGateway,
          flushPendingChange: flushPendingDocumentChange,
          isSessionActive: () =>
            ownerFence.isCurrent() &&
            isLanguageServerSessionActiveForRoot(
              workspaceRoot,
              languageServerRuntimeStatus.sessionId,
              ownerFence.owner,
            ),
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
        flushPendingChange: flushPendingJavaScriptTypeScriptDocumentChange,
        isSessionActive: () =>
          ownerFence.isCurrent() &&
          isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
            workspaceRoot,
            javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId,
            ownerFence.owner,
          ),
      };
    },
    [
      flushPendingDocumentChange,
      flushPendingJavaScriptTypeScriptDocumentChange,
      isLanguageServerSessionActiveForRoot,
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      languageServerFeaturesGateway,
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      setMessage,
      workspaceRoot,
    ],
  );

  const openCallHierarchyRow = useCallback(
    async (row: CallHierarchyRow) => {
      const ownerFence = captureWorkspaceRuntimeOwnerFence(
        resolveCurrentWorkspaceRuntimeOwner,
      );

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
            ? shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly(
                workspaceRoot,
                path,
              )
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
      const ownerFence = captureWorkspaceRuntimeOwnerFence(
        resolveCurrentWorkspaceRuntimeOwner,
      );

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
            ? shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly(
                workspaceRoot,
                path,
              )
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
      const ownerFence = captureWorkspaceRuntimeOwnerFence(
        resolveCurrentWorkspaceRuntimeOwner,
      );

      if (!ownerFence) {
        return;
      }

      const opened = await openNavigationTarget(
        row.path,
        toEditorPosition(row.location.range.start),
        "reference",
        {
          readOnly: workspaceRoot
            ? shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly(
                workspaceRoot,
                row.path,
              )
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
      shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly,
      workspaceRoot,
    ],
  );

  const openCallHierarchy = useCallback(async () => {
    const ownerFence = captureWorkspaceRuntimeOwnerFence(
      resolveCurrentWorkspaceRuntimeOwner,
    );

    if (!ownerFence) {
      return;
    }

    const document = activeDocumentRef.current;
    if (!document) {
      setMessage(
        "Open a PHP, JavaScript, or TypeScript file to show call hierarchy.",
      );
      return;
    }

    if (!isLanguageServerPanelDocument(document, workspaceRoot)) {
      setMessage(
        "Call hierarchy is available for PHP, JavaScript, and TypeScript files.",
      );
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
    const isRequestedSessionActive = context.isSessionActive;

    closeSymbolPanels();

    try {
      await context.flushPendingChange(requestedPath);

      if (!isRequestedSessionActive()) {
        return;
      }

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
    const ownerFence = captureWorkspaceRuntimeOwnerFence(
      resolveCurrentWorkspaceRuntimeOwner,
    );

    if (!ownerFence) {
      return;
    }

    const document = activeDocumentRef.current;
    if (!document) {
      setMessage(
        "Open a PHP, JavaScript, or TypeScript file to show type hierarchy.",
      );
      return;
    }

    if (!isLanguageServerPanelDocument(document, workspaceRoot)) {
      setMessage(
        "Type hierarchy is available for PHP, JavaScript, and TypeScript files.",
      );
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
    const isRequestedSessionActive = context.isSessionActive;

    closeSymbolPanels();

    try {
      await context.flushPendingChange(requestedPath);

      if (!isRequestedSessionActive()) {
        return;
      }

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
    const ownerFence = captureWorkspaceRuntimeOwnerFence(
      resolveCurrentWorkspaceRuntimeOwner,
    );

    if (!ownerFence) {
      return;
    }

    const document = activeDocumentRef.current;
    if (!document) {
      setMessage(
        "Open a PHP, JavaScript, or TypeScript file to find references.",
      );
      return;
    }

    if (!isLanguageServerPanelDocument(document, workspaceRoot)) {
      setMessage(
        "Find references is available for PHP, JavaScript, and TypeScript files.",
      );
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

    const symbolName =
      identifierAtEditorPosition(document.content, editorPosition) ??
      "symbol";
    const requestedRoot = workspaceRoot;
    const requestedPath = document.path;
    const isRequestedSessionActive = context.isSessionActive;

    closeSymbolPanels();

    try {
      await context.flushPendingChange(requestedPath);

      if (!isRequestedSessionActive()) {
        return;
      }

      const locations = await context.featuresGateway.references(
        requestedRoot,
        toLanguageServerTextDocumentPosition(requestedPath, editorPosition),
      );

      if (!isRequestedSessionActive()) {
        return;
      }

      if (locations.length === 0) {
        setReferencesView({ locations: [], symbol: symbolName });
        setMessage(`No references found for ${symbolName}.`);
        return;
      }

      setReferencesView({ locations, symbol: symbolName });
      setMessage(null);
    } catch (error) {
      if (!isRequestedSessionActive()) {
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
    workspaceRoot,
  ]);

  const openFileReferencesPanel = useCallback(async () => {
    const ownerFence = captureWorkspaceRuntimeOwnerFence(
      resolveCurrentWorkspaceRuntimeOwner,
    );

    if (!ownerFence) {
      return;
    }

    const document = activeDocumentRef.current;

    if (!document || !workspaceRoot) {
      setMessage("Open a JavaScript or TypeScript file to find file references.");
      return;
    }

    if (!isJavaScriptTypeScriptLanguageServerDocument(document)) {
      setMessage(
        "Find File References is available for JavaScript and TypeScript files.",
      );
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
    const requestedSessionId =
      javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;
    const isRequestedSessionActive = () =>
      ownerFence.isCurrent() &&
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
        requestedRoot,
        requestedSessionId,
        ownerFence.owner,
      );

    closeSymbolPanels();

    try {
      await flushPendingJavaScriptTypeScriptDocumentChange(requestedPath);

      if (!isRequestedSessionActive()) {
        return;
      }

      const locations =
        await javaScriptTypeScriptLanguageServerFeaturesGateway.executeCommandLocations(
          requestedRoot,
          findAllFileReferencesCommand(requestedPath),
        );

      if (!isRequestedSessionActive()) {
        return;
      }

      const workspaceLocations = filterFileReferenceLocationsToWorkspace(
        locations,
        requestedRoot,
      );
      const symbol = document.name;

      if (workspaceLocations.length === 0) {
        setReferencesView({ locations: [], symbol });
        setMessage(`No file references found for ${symbol}.`);
        return;
      }

      setReferencesView({ locations: workspaceLocations, symbol });
      setMessage(null);
    } catch (error) {
      if (!isRequestedSessionActive()) {
        return;
      }

      reportError("Find File References", error);
    }
  }, [
    activeDocumentRef,
    closeSymbolPanels,
    flushPendingJavaScriptTypeScriptDocumentChange,
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    reportError,
    resolveCurrentWorkspaceRuntimeOwner,
    setMessage,
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
    (isLanguageServerDocument(document) ||
      isJavaScriptTypeScriptLanguageServerDocument(document))
  );
}

function identifierAtEditorPosition(
  source: string,
  position: EditorPosition,
): string | null {
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

  const rootedStatus =
    status.rootPath ?? (status.kind === "stopped" ? statusRoot : null);

  return (
    Boolean(rootedStatus) && workspaceRootKeysEqual(rootedStatus, workspaceRoot)
  );
}
