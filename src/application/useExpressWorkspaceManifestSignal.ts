import { useEffect, useRef, useState } from "react";
import type { WorkspaceSourceDiscoveryGateway } from "../domain/workspaceSourceDiscovery";
import { hasExpressWorkspaceSignal } from "../domain/expressWorkspaceSignal";
import { useDirtyExpressRoutesDocumentSnapshots } from "./useDirtyExpressRoutesDocumentSnapshots";

const MAX_PACKAGE_JSON_BYTES = 256 * 1024;

interface ExpressWorkspaceManifestSignal {
  readonly discoveryVersion: number;
  readonly workspaceKey: string;
  readonly value: boolean;
}

type DirtySnapshotsArguments = Parameters<typeof useDirtyExpressRoutesDocumentSnapshots>;

interface ExpressWorkspaceWorkbench {
  readonly activeDocument: DirtySnapshotsArguments[1];
  readonly expressRouteDiscoveryVersion: number;
  readonly openDocuments: DirtySnapshotsArguments[0];
  readonly workspaceDescriptor?: {
    readonly javaScriptTypeScript?: unknown;
  } | null;
  readonly workspaceIdentityDescriptor?: {
    readonly workspaceId?: string;
  } | null;
  readonly workspaceRoot: string | null;
}

export function useAppExpressWorkspaceSignals(
  workbench: ExpressWorkspaceWorkbench,
  gateway: WorkspaceSourceDiscoveryGateway,
) {
  const rootPath = workbench.workspaceDescriptor?.javaScriptTypeScript
    ? workbench.workspaceRoot
    : null;
  return [
    useDirtyExpressRoutesDocumentSnapshots(
      workbench.openDocuments,
      workbench.activeDocument,
      workbench.workspaceRoot,
    ),
    useExpressWorkspaceManifestSignal(
      gateway,
      rootPath,
      workbench.workspaceIdentityDescriptor?.workspaceId ?? null,
      workbench.expressRouteDiscoveryVersion,
    ),
  ] as const;
}

export function useExpressWorkspaceManifestSignal(
  gateway: WorkspaceSourceDiscoveryGateway,
  rootPath: string | null,
  workspaceId: string | null,
  discoveryVersion: number,
): boolean {
  const [signal, setSignal] = useState<ExpressWorkspaceManifestSignal | null>(null);
  const workspaceKey = workspaceId && rootPath ? `${workspaceId}\u0000${rootPath}` : null;
  const currentKeyRef = useRef(workspaceKey);
  const requestSequenceRef = useRef(0);
  currentKeyRef.current = workspaceKey;

  useEffect(() => {
    const capturedRoot = rootPath;
    const capturedWorkspaceKey = workspaceKey;
    const requestSequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestSequence;
    if (!capturedRoot || !capturedWorkspaceKey) return;
    const isCurrent = () =>
      currentKeyRef.current === capturedWorkspaceKey &&
      requestSequenceRef.current === requestSequence;

    const readManifest = async () => {
      let value = false;
      try {
        const read = await gateway.readSourceTextBounded(
          capturedRoot,
          "package.json",
          MAX_PACKAGE_JSON_BYTES,
        );
        if (!isCurrent()) return;
        if (read.status === "ok") {
          value = hasExpressWorkspaceSignal({
            manifest: JSON.parse(read.content) as unknown,
            routes: [],
          });
        }
      } catch {
        value = false;
      }
      if (!isCurrent()) return;
      setSignal({ discoveryVersion, value, workspaceKey: capturedWorkspaceKey });
    };

    void readManifest();
    return () => {
      if (requestSequenceRef.current !== requestSequence) return;
      requestSequenceRef.current += 1;
    };
  }, [discoveryVersion, gateway, rootPath, workspaceKey]);

  if (signal?.workspaceKey !== workspaceKey) return false;
  if (signal.discoveryVersion !== discoveryVersion) return false;
  return signal.value;
}
