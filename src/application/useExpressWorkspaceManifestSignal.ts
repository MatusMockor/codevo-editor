import { useEffect, useRef, useState } from "react";
import type { WorkspaceSourceDiscoveryGateway } from "../domain/workspaceSourceDiscovery";
import { hasExpressWorkspaceSignal } from "../domain/expressWorkspaceSignal";
import { useDirtyExpressRoutesDocumentSnapshots } from "./useDirtyExpressRoutesDocumentSnapshots";

const MAX_PACKAGE_JSON_BYTES = 256 * 1024;

interface ExpressWorkspaceManifestSignal {
  readonly attemptKey: string;
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
  const attemptKey = manifestAttemptKey(workspaceId, rootPath, discoveryVersion);
  const attemptSequenceRef = useRef(0);
  const currentAttemptKeyRef = useRef(attemptKey);
  const effectActiveRef = useRef(false);
  const gatewayRef = useRef(gateway);
  const lastAttemptedKeyRef = useRef<string | null>(null);
  currentAttemptKeyRef.current = attemptKey;
  gatewayRef.current = gateway;

  useEffect(() => {
    effectActiveRef.current = true;
    const capturedAttemptKey = attemptKey;
    const capturedGateway = gatewayRef.current;
    const capturedRoot = rootPath;
    const deactivate = () => {
      effectActiveRef.current = false;
    };
    if (!capturedAttemptKey || !capturedRoot) {
      if (lastAttemptedKeyRef.current !== null) {
        lastAttemptedKeyRef.current = null;
        attemptSequenceRef.current += 1;
      }
      return deactivate;
    }
    if (lastAttemptedKeyRef.current === capturedAttemptKey) return deactivate;
    lastAttemptedKeyRef.current = capturedAttemptKey;
    const capturedAttemptSequence = attemptSequenceRef.current + 1;
    attemptSequenceRef.current = capturedAttemptSequence;
    const isCurrent = () =>
      effectActiveRef.current &&
      currentAttemptKeyRef.current === capturedAttemptKey &&
      attemptSequenceRef.current === capturedAttemptSequence;
    const settle = (value: boolean) => {
      if (!isCurrent()) return;
      setSignal((current) => {
        const currentValue = current?.attemptKey === capturedAttemptKey ? current.value : false;
        if (currentValue === value) return current;
        return { attemptKey: capturedAttemptKey, value };
      });
    };

    const readManifest = async () => {
      try {
        const read: unknown = await capturedGateway.readSourceTextBounded(
          capturedRoot,
          "package.json",
          MAX_PACKAGE_JSON_BYTES,
        );
        if (!isCurrent()) return;
        if (!isManifestRead(read)) return settle(false);
        settle(
          hasExpressWorkspaceSignal({
            manifest: JSON.parse(read.content) as unknown,
            routes: [],
          }),
        );
      } catch {
        settle(false);
      }
    };

    void readManifest();
    return deactivate;
  }, [attemptKey, rootPath]);

  if (signal?.attemptKey !== attemptKey) return false;
  return signal.value;
}

function manifestAttemptKey(
  workspaceId: string | null,
  rootPath: string | null,
  discoveryVersion: number,
): string | null {
  if (typeof workspaceId !== "string" || workspaceId.length === 0) return null;
  if (typeof rootPath !== "string" || rootPath.length === 0) return null;
  if (!Number.isSafeInteger(discoveryVersion) || discoveryVersion < 0) return null;
  return JSON.stringify([workspaceId, rootPath, discoveryVersion]);
}

function isManifestRead(read: unknown): read is { readonly content: string } {
  if (!read || typeof read !== "object" || Array.isArray(read)) return false;
  const candidate = read as Record<string, unknown>;
  return candidate.status === "ok" && typeof candidate.content === "string";
}
