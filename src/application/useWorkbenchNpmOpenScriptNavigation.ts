import { useCallback, useMemo, useRef } from "react";
import type { EditorDocument } from "../domain/workspace";
import { createWorkspaceRoot, type WorkspacePathPolicy } from "../domain/workspacePath";
import {
  useNpmOpenScriptNavigation,
  type NpmOpenScriptGatewayOwnerPort,
  type NpmOpenScriptNavigationGateway,
  type NpmOpenScriptNavigationGatewayBinder,
  type NpmOpenScriptNavigationOwner,
  type UseNpmOpenScriptNavigationOptions,
} from "./useNpmOpenScriptNavigation";

interface WorkspaceIdentity {
  readonly canonicalRoot: string;
  readonly policy: WorkspacePathPolicy;
  readonly selectedPath: string;
  readonly workspaceId: string;
}

interface UseWorkbenchNpmOpenScriptNavigationOptions {
  readonly discoveryVersion: number;
  readonly documents: readonly EditorDocument[];
  readonly gateway?: NpmOpenScriptNavigationGatewayBinder;
  readonly identity: WorkspaceIdentity | null;
  readonly openNavigationTarget: UseNpmOpenScriptNavigationOptions["openNavigationTarget"];
  readonly rootPath: string | null;
}

const unavailableGateway: NpmOpenScriptNavigationGateway = {
  readManifestBounded: async () => ({ status: "missing" }),
};

/** Composes controller workspace authority with the narrow npm navigation port. */
export function useWorkbenchNpmOpenScriptNavigation({
  discoveryVersion,
  documents,
  gateway,
  identity,
  openNavigationTarget,
  rootPath,
}: UseWorkbenchNpmOpenScriptNavigationOptions) {
  const roots = useMemo(() => {
    if (!identity) return null;
    const selected = createWorkspaceRoot(
      identity.workspaceId,
      identity.selectedPath,
      identity.policy,
    );
    const canonical = createWorkspaceRoot(
      identity.workspaceId,
      identity.canonicalRoot,
      identity.policy,
    );
    if (!selected.ok || !canonical.ok) return null;
    return selected.value.nativePath === canonical.value.nativePath
      ? [selected.value]
      : [selected.value, canonical.value];
  }, [identity]);
  const activationRef = useRef({
    identity: null as WorkspaceIdentity | null,
    epoch: 0,
    rootPath: null as string | null,
    roots,
  });
  if (
    activationRef.current.identity !== identity ||
    activationRef.current.rootPath !== rootPath ||
    activationRef.current.roots !== roots
  ) {
    activationRef.current = {
      identity,
      epoch: activationRef.current.epoch + 1,
      rootPath,
      roots,
    };
  }
  const activationEpoch = activationRef.current.epoch;
  const owner = useMemo<NpmOpenScriptNavigationOwner | null>(() => {
    if (!rootPath || !identity || !roots) return null;
    return {
      activationEpoch,
      ownerKey: `npm-open-script:${identity.workspaceId}:${activationEpoch}`,
      rootPath,
      workspaceId: identity.workspaceId,
      workspaceRoots: roots,
    };
  }, [activationEpoch, identity, rootPath, roots]);
  const gatewayOwnerRef = useRef<ReturnType<NpmOpenScriptGatewayOwnerPort>>(null);
  gatewayOwnerRef.current = owner
    ? {
        activationEpoch: owner.activationEpoch,
        nodePackageScriptDiscoveryVersion: discoveryVersion,
        ownerKey: owner.ownerKey,
        rootPath: owner.rootPath,
        workspaceId: owner.workspaceId,
      }
    : null;
  const readGatewayOwner = useCallback<NpmOpenScriptGatewayOwnerPort>(
    () => gatewayOwnerRef.current,
    [],
  );
  const navigationGateway = useMemo(
    () => gateway?.bindNpmOpenScriptNavigation(readGatewayOwner) ?? unavailableGateway,
    [gateway, readGatewayOwner],
  );
  return useNpmOpenScriptNavigation({
    documents,
    gateway: navigationGateway,
    openNavigationTarget,
    owner,
  });
}
