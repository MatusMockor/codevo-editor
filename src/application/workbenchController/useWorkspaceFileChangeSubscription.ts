import {
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type {
  WorkspaceFileChangeEvent,
  WorkspaceFileChangeGateway,
  WorkspaceFileChangeUnsubscribeFn,
} from "../../domain/workspaceFileChange";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import { refreshEditorConfigForFileChange } from "../editorConfigInvalidation";
import {
  beginReportedWorkspaceFileTombstoneEvent,
  reconcileExternallyRemovedDocumentEvent,
} from "./externallyRemovedDocumentTombstones";

export type IsCurrentWorkspaceFileChangeSubscription = () => boolean;
export type WorkspaceFileChangeSubscriptionHandler = (
  event: WorkspaceFileChangeEvent,
  isCurrent: IsCurrentWorkspaceFileChangeSubscription,
) => void;

interface WorkspaceFileChangeSubscriptionInput {
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly eventHandlerRef: MutableRefObject<WorkspaceFileChangeSubscriptionHandler>;
  readonly gateway: WorkspaceFileChangeGateway;
  readonly reportError: (source: string, error: unknown) => void;
  readonly workspaceRoot: string | null;
}

interface WorkbenchWorkspaceFileChangeSubscriptionInput {
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly externallyRemovedDocumentRootByPathRef: MutableRefObject<Record<string, string>>;
  readonly gateway: WorkspaceFileChangeGateway;
  readonly handleExternalFileChange: (event: WorkspaceFileChangeEvent) => Promise<unknown>;
  readonly handleWorkspaceDiscoveryFileChange: (event: WorkspaceFileChangeEvent) => void;
  readonly handleWorkspaceFileChange: (event: WorkspaceFileChangeEvent) => void;
  readonly markExternallyRemovedDocumentPath: (rootPath: string, path: string) => void;
  readonly refreshEditorConfigRoot: (rootPath: string) => void;
  readonly reportError: (source: string, error: unknown) => void;
  readonly setMessage: Dispatch<SetStateAction<string | null>>;
  readonly workspaceRoot: string | null;
}

/** Connects the stable subscription lifecycle to the workbench's current event policies. */
export function useWorkbenchWorkspaceFileChangeSubscription({
  currentWorkspaceRootRef,
  externallyRemovedDocumentRootByPathRef,
  gateway,
  handleExternalFileChange,
  handleWorkspaceDiscoveryFileChange,
  handleWorkspaceFileChange,
  markExternallyRemovedDocumentPath,
  refreshEditorConfigRoot,
  reportError,
  setMessage,
  workspaceRoot,
}: WorkbenchWorkspaceFileChangeSubscriptionInput): void {
  const eventHandlerRef = useRef<WorkspaceFileChangeSubscriptionHandler>(() => undefined);
  eventHandlerRef.current = (event, isCurrent) => {
    const removedEventToken = beginReportedWorkspaceFileTombstoneEvent(
      externallyRemovedDocumentRootByPathRef.current,
      event,
      setMessage,
    );

    handleWorkspaceDiscoveryFileChange(event);
    refreshEditorConfigForFileChange(event, refreshEditorConfigRoot);

    void handleExternalFileChange(event).then((consumed) => {
      const removalStillCurrent =
        !removedEventToken ||
        reconcileExternallyRemovedDocumentEvent(
          externallyRemovedDocumentRootByPathRef.current,
          removedEventToken,
        );
      if (!isCurrent()) return;
      if (
        consumed &&
        removalStillCurrent &&
        (event.kind === "deleted" || event.kind === "renamed")
      ) {
        const removedPath = event.kind === "renamed" ? event.previousPath : event.path;
        if (removedPath) markExternallyRemovedDocumentPath(event.rootPath, removedPath);
      }
      if (!consumed) handleWorkspaceFileChange(event);
    });
  };

  useWorkspaceFileChangeSubscription({
    currentWorkspaceRootRef,
    eventHandlerRef,
    gateway,
    reportError,
    workspaceRoot,
  });
}

/**
 * Owns one filesystem-watch subscription for the active workspace root.
 *
 * Event behavior is read through a ref so ordinary controller renders can
 * update the handler without tearing down and recreating the native watcher.
 */
export function useWorkspaceFileChangeSubscription({
  currentWorkspaceRootRef,
  eventHandlerRef,
  gateway,
  reportError,
  workspaceRoot,
}: WorkspaceFileChangeSubscriptionInput): void {
  const generationRef = useRef(0);

  useEffect(() => {
    let active = true;
    let unsubscribe: WorkspaceFileChangeUnsubscribeFn | null = null;
    const subscriptionRoot = workspaceRoot;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const isCurrent = () =>
      active &&
      generationRef.current === generation &&
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, subscriptionRoot);

    if (!subscriptionRoot) {
      return () => {
        active = false;
      };
    }

    void gateway.startWatching(subscriptionRoot).catch((error) => {
      if (isCurrent()) reportError("Workspace", error);
    });

    void gateway
      .subscribeFileChanges((event) => {
        if (!isCurrent() || !workspaceRootKeysEqual(event.rootPath, subscriptionRoot)) return;
        eventHandlerRef.current(event, isCurrent);
      })
      .then((dispose) => {
        if (!active) {
          dispose();
          return;
        }
        unsubscribe = dispose;
      })
      .catch((error) => {
        if (isCurrent()) reportError("Workspace", error);
      });

    return () => {
      active = false;
      generationRef.current += 1;
      unsubscribe?.();
    };
  }, [currentWorkspaceRootRef, eventHandlerRef, gateway, reportError, workspaceRoot]);
}
