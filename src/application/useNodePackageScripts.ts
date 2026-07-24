import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_NODE_PACKAGE_DISCOVERY_MANIFESTS,
  MAX_NODE_PACKAGE_DISCOVERY_SCRIPTS,
  MAX_NODE_PACKAGE_DISCOVERY_VISITED,
  type NodePackageScript,
  type NodePackageScriptsGateway,
} from "../domain/nodePackageScripts";

const DISCOVERY_LIMITS = {
  maxManifests: MAX_NODE_PACKAGE_DISCOVERY_MANIFESTS,
  maxScripts: MAX_NODE_PACKAGE_DISCOVERY_SCRIPTS,
  maxVisited: MAX_NODE_PACKAGE_DISCOVERY_VISITED,
} as const;

interface StoredNodePackageScriptsState {
  readonly error: string | null;
  readonly loading: boolean;
  readonly ownerKey: string;
  readonly scripts: readonly NodePackageScript[];
  readonly total: number;
  readonly truncated: boolean;
  readonly visited: number;
}

export interface UseNodePackageScriptsOptions {
  readonly discoveryEnabled: boolean;
  readonly discoveryVersion: number;
  readonly gateway: NodePackageScriptsGateway;
  readonly rootPath: string | null;
  readonly workspaceId: string | null;
}

export interface NodePackageScriptsState {
  readonly error: string | null;
  readonly loading: boolean;
  readonly scripts: readonly NodePackageScript[];
  readonly total: number;
  readonly truncated: boolean;
  readonly visited: number;
  refresh(): Promise<boolean>;
}

export function useNodePackageScripts({
  discoveryEnabled,
  discoveryVersion,
  gateway,
  rootPath,
  workspaceId,
}: UseNodePackageScriptsOptions): NodePackageScriptsState {
  const ownerKey = `${workspaceId ?? ""}\0${rootPath ?? ""}`;
  const [stored, setStored] = useState<StoredNodePackageScriptsState>(() => emptyState(ownerKey));
  const requestSequenceRef = useRef(0);
  const mountedRef = useRef(false);
  const ownerRef = useRef({ discoveryEnabled, ownerKey, rootPath, workspaceId });
  ownerRef.current = { discoveryEnabled, ownerKey, rootPath, workspaceId };

  const state =
    discoveryEnabled && rootPath && workspaceId && stored.ownerKey === ownerKey
      ? stored
      : emptyState(ownerKey);

  const update = useCallback(
    (values: Partial<Omit<StoredNodePackageScriptsState, "ownerKey">>) => {
      if (!mountedRef.current) return;
      setStored((current) => ({
        ...(current.ownerKey === ownerKey ? current : emptyState(ownerKey)),
        ...values,
        ownerKey,
      }));
    },
    [ownerKey],
  );

  const refresh = useCallback(async (): Promise<boolean> => {
    const capturedRoot = rootPath;
    const capturedWorkspaceId = workspaceId;
    const capturedOwnerKey = ownerKey;
    if (!discoveryEnabled || !capturedRoot || !capturedWorkspaceId || !mountedRef.current)
      return false;

    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    const isCurrent = () => {
      const current = ownerRef.current;
      return (
        mountedRef.current &&
        current.discoveryEnabled &&
        current.ownerKey === capturedOwnerKey &&
        current.rootPath === capturedRoot &&
        current.workspaceId === capturedWorkspaceId &&
        requestSequenceRef.current === sequence
      );
    };
    update({ error: null, loading: true });

    try {
      const result = await gateway.listNodePackageScripts(capturedRoot, DISCOVERY_LIMITS);
      if (!isCurrent()) return false;
      update({
        error: null,
        loading: false,
        scripts: result.scripts,
        total: result.total,
        truncated: result.truncated,
        visited: result.visited,
      });
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      update({ error: errorMessage(error), loading: false });
      return false;
    }
  }, [discoveryEnabled, gateway, ownerKey, rootPath, update, workspaceId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestSequenceRef.current += 1;
    };
  }, []);

  useEffect(() => {
    requestSequenceRef.current += 1;
    if (discoveryEnabled && rootPath && workspaceId) void refresh();
  }, [discoveryEnabled, discoveryVersion, refresh, rootPath, workspaceId]);

  return { ...state, refresh };
}

function emptyState(ownerKey: string): StoredNodePackageScriptsState {
  return {
    error: null,
    loading: false,
    ownerKey,
    scripts: [],
    total: 0,
    truncated: false,
    visited: 0,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Could not discover Node package scripts.";
}
