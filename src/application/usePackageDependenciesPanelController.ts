import { useCallback, useMemo, useRef, useState } from "react";
import {
  buildPackageDependencyTree,
  locatePackageDependencyKey,
  type PackageDependencyTreeItem,
} from "../domain/packageDependencyTree";
import {
  joinWorkspacePath,
  type EditorDocument,
  type NpmPackageDescriptor,
} from "../domain/workspace";
import type { WorkspaceSourceDiscoveryGateway } from "../domain/workspaceSourceDiscovery";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type {
  PackageDependenciesPanelModel,
  PendingPackageOperation,
} from "./packageDependenciesPanelModel";
import type {
  PackageOperation,
  PackageOperationRequest,
  PackageOperationsGateway,
} from "../domain/packageOperations";

const MAX_PACKAGE_JSON_BYTES = 256 * 1024;
const MAX_PACKAGE_NAME_LENGTH = 214;
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const DIRTY_MANIFEST_OPERATION_ERROR =
  "Save or discard package.json changes before running package operations.";

export interface UsePackageDependenciesPanelControllerOptions {
  readonly documents: readonly EditorDocument[];
  readonly gateway: WorkspaceSourceDiscoveryGateway;
  readonly onOpenLocation: (
    path: string,
    line: number,
    column: number,
    shouldCommit: () => boolean,
  ) => Promise<boolean>;
  readonly onRefresh: () => Promise<unknown> | unknown;
  readonly operationsGateway: PackageOperationsGateway;
  readonly packageManager: string | null;
  readonly packages: readonly NpmPackageDescriptor[];
  readonly rootPath: string | null;
  readonly workspaceId: string | null;
  readonly trusted: boolean;
}

export function usePackageDependenciesPanelController({
  documents,
  gateway,
  onOpenLocation,
  onRefresh,
  operationsGateway,
  packageManager,
  packages,
  rootPath,
  workspaceId,
  trusted,
}: UsePackageDependenciesPanelControllerOptions): PackageDependenciesPanelModel {
  const ownerKey = `${workspaceId ?? ""}\0${rootPath ?? ""}`;
  const [storedPanelState, setStoredPanelState] = useState({
    error: null as string | null,
    busy: false,
    ownerKey,
    pendingOperation: null as PendingPackageOperation | null,
    query: "",
    status: null as string | null,
  });
  const panelState =
    storedPanelState.ownerKey === ownerKey
      ? storedPanelState
      : { busy: false, error: null, ownerKey, pendingOperation: null, query: "", status: null };
  const operationActiveRef = useRef(false);
  const updatePanelState = useCallback(
    (update: Partial<Omit<typeof storedPanelState, "ownerKey">>) => {
      setStoredPanelState((current) => ({
        ...(current.ownerKey === ownerKey
          ? current
          : {
              busy: false,
              error: null,
              ownerKey,
              pendingOperation: null,
              query: "",
              status: null,
            }),
        ...update,
        ownerKey,
      }));
    },
    [ownerKey],
  );
  const setCurrentError = useCallback(
    (error: string | null) => {
      updatePanelState({ error });
    },
    [updatePanelState],
  );
  const setCurrentQuery = useCallback(
    (query: string) => {
      setStoredPanelState((current) => ({
        ...(current.ownerKey === ownerKey
          ? current
          : {
              busy: false,
              error: null,
              pendingOperation: null,
              status: null,
            }),
        ownerKey,
        query,
      }));
    },
    [ownerKey],
  );
  const ownerRef = useRef({ rootPath, workspaceId });
  ownerRef.current = { rootPath, workspaceId };
  const packageJsonPath = rootPath ? joinWorkspacePath(rootPath, "package.json") : null;
  const dirtySource = useMemo(() => {
    if (!packageJsonPath) return null;
    const document = documents.find(
      (candidate) =>
        workspaceRootKeysEqual(candidate.path, packageJsonPath) &&
        candidate.content !== candidate.savedContent,
    );
    return document?.content ?? null;
  }, [documents, packageJsonPath]);
  const tree = useMemo(
    () => buildPackageDependencyTree(packages, panelState.query),
    [packages, panelState.query],
  );

  const isOwnerCurrent = useCallback((requestedRoot: string, requestedWorkspaceId: string) => {
    const current = ownerRef.current;
    return (
      workspaceRootKeysEqual(current.rootPath, requestedRoot) &&
      current.workspaceId === requestedWorkspaceId
    );
  }, []);

  const requestOperation = useCallback(
    async (
      operation: PackageOperation,
      packageName?: string,
      development?: boolean,
    ): Promise<boolean> => {
      const requestedRoot = rootPath;
      const requestedWorkspaceId = workspaceId;
      if (!requestedRoot || !requestedWorkspaceId) return false;
      if (!trusted) {
        updatePanelState({ error: "Trust this workspace before running package operations." });
        return false;
      }
      if (dirtySource !== null) {
        updatePanelState({ error: DIRTY_MANIFEST_OPERATION_ERROR });
        return false;
      }
      const normalizedPackageName = packageName?.trim();
      if (
        operation !== "outdated" &&
        (!normalizedPackageName ||
          normalizedPackageName.length > MAX_PACKAGE_NAME_LENGTH ||
          !PACKAGE_NAME_PATTERN.test(normalizedPackageName))
      ) {
        updatePanelState({
          error: "Enter a valid npm package name (up to 214 characters).",
        });
        return false;
      }
      if (operationActiveRef.current || panelState.busy) return false;

      const request: PackageOperationRequest = {
        ...(development === undefined ? {} : { development }),
        operation,
        ...(normalizedPackageName === undefined ? {} : { packageName: normalizedPackageName }),
        workspaceId: requestedWorkspaceId,
      };
      operationActiveRef.current = true;
      updatePanelState({ busy: true, error: null, pendingOperation: null, status: null });
      try {
        const preview = await operationsGateway.previewPackageOperation(request);
        if (!isOwnerCurrent(requestedRoot, requestedWorkspaceId)) return false;
        updatePanelState({ pendingOperation: { preview, request } });
        return true;
      } catch {
        if (!isOwnerCurrent(requestedRoot, requestedWorkspaceId)) return false;
        updatePanelState({ busy: false, error: "Could not prepare the package operation." });
        return false;
      } finally {
        if (isOwnerCurrent(requestedRoot, requestedWorkspaceId)) updatePanelState({ busy: false });
        operationActiveRef.current = false;
      }
    },
    [
      isOwnerCurrent,
      dirtySource,
      operationsGateway,
      panelState.busy,
      rootPath,
      trusted,
      updatePanelState,
      workspaceId,
    ],
  );

  const confirmOperation = useCallback(async (): Promise<boolean> => {
    const pending = panelState.pendingOperation;
    const requestedRoot = rootPath;
    const requestedWorkspaceId = workspaceId;
    if (!pending || !requestedRoot || !requestedWorkspaceId || panelState.busy) return false;
    if (!trusted) {
      updatePanelState({
        error: "Trust this workspace before running package operations.",
        pendingOperation: null,
      });
      return false;
    }
    if (dirtySource !== null) {
      updatePanelState({ error: DIRTY_MANIFEST_OPERATION_ERROR });
      return false;
    }
    if (
      pending.request.workspaceId !== requestedWorkspaceId ||
      !isOwnerCurrent(requestedRoot, requestedWorkspaceId)
    ) {
      return false;
    }

    operationActiveRef.current = true;
    updatePanelState({ busy: true, error: null, status: null });
    try {
      const result = await operationsGateway.runPackageOperation(pending.request);
      if (!isOwnerCurrent(requestedRoot, requestedWorkspaceId)) return false;
      if (result.status !== "ok") {
        updatePanelState({ busy: false, error: result.message });
        return false;
      }
      try {
        await onRefresh();
      } catch {
        if (!isOwnerCurrent(requestedRoot, requestedWorkspaceId)) return false;
        updatePanelState({
          busy: false,
          error: "The operation succeeded, but dependencies could not be refreshed.",
          pendingOperation: null,
          status: result.message,
        });
        return false;
      }
      if (!isOwnerCurrent(requestedRoot, requestedWorkspaceId)) return false;
      updatePanelState({
        busy: false,
        pendingOperation: null,
        status: result.message,
      });
      return true;
    } catch {
      if (!isOwnerCurrent(requestedRoot, requestedWorkspaceId)) return false;
      updatePanelState({ busy: false, error: "Could not run the package operation." });
      return false;
    } finally {
      operationActiveRef.current = false;
    }
  }, [
    isOwnerCurrent,
    dirtySource,
    onRefresh,
    operationsGateway,
    panelState.busy,
    panelState.pendingOperation,
    rootPath,
    trusted,
    updatePanelState,
    workspaceId,
  ]);

  const openDependency = useCallback(
    async (dependency: PackageDependencyTreeItem): Promise<boolean> => {
      const requestedRoot = rootPath;
      const requestedWorkspaceId = workspaceId;
      const isCurrent = () => {
        const current = ownerRef.current;
        return (
          Boolean(requestedRoot && requestedWorkspaceId) &&
          workspaceRootKeysEqual(current.rootPath, requestedRoot) &&
          current.workspaceId === requestedWorkspaceId
        );
      };
      if (!requestedRoot || !requestedWorkspaceId || !isCurrent()) return false;

      setCurrentError(null);
      let source = dirtySource;
      if (source !== null && new TextEncoder().encode(source).byteLength > MAX_PACKAGE_JSON_BYTES) {
        setCurrentError("package.json is too large to navigate safely.");
        return false;
      }
      if (source === null) {
        try {
          const read = await gateway.readSourceTextBounded(
            requestedRoot,
            "package.json",
            MAX_PACKAGE_JSON_BYTES,
          );
          if (!isCurrent()) return false;
          if (read.status !== "ok") {
            setCurrentError(
              read.status === "tooLarge"
                ? "package.json is too large to navigate safely."
                : "package.json changed while it was being read. Try again.",
            );
            return false;
          }
          source = read.content;
          if (new TextEncoder().encode(source).byteLength > MAX_PACKAGE_JSON_BYTES) {
            setCurrentError("package.json is too large to navigate safely.");
            return false;
          }
        } catch {
          if (!isCurrent()) return false;
          setCurrentError("Could not read package.json.");
          return false;
        }
      }

      const location = locatePackageDependencyKey(source, dependency);
      if (!isCurrent()) return false;
      if (!location) {
        setCurrentError(`${dependency.name} is no longer declared in package.json.`);
        return false;
      }

      let opened: boolean;
      try {
        opened = await onOpenLocation(
          joinWorkspacePath(requestedRoot, "package.json"),
          location.lineNumber,
          location.column,
          isCurrent,
        );
      } catch {
        if (!isCurrent()) return false;
        setCurrentError("Could not open package.json.");
        return false;
      }
      if (!isCurrent()) return false;
      if (!opened) setCurrentError("Could not open package.json.");
      return opened;
    },
    [dirtySource, gateway, onOpenLocation, rootPath, setCurrentError, workspaceId],
  );

  return {
    busy: panelState.busy,
    error: panelState.error,
    manager: packageManager,
    onCancelOperation: () => updatePanelState({ pendingOperation: null }),
    onCheckOutdated: () => requestOperation("outdated"),
    onConfirmOperation: confirmOperation,
    onInstallPackage: (packageName, development) =>
      requestOperation("install", packageName, development),
    onOpenDependency: openDependency,
    onQueryChange: setCurrentQuery,
    onRemoveDependency: (dependency) => requestOperation("remove", dependency.name),
    onUpdateDependency: (dependency) => requestOperation("update", dependency.name),
    pendingOperation: panelState.pendingOperation,
    query: panelState.query,
    status: panelState.status,
    tree,
    trusted,
  };
}
