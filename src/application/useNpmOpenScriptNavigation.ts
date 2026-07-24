import { useCallback, useEffect, useRef } from "react";
import {
  MAX_NPM_OPEN_SCRIPT_MANIFEST_BYTES,
  npmOpenScriptLocation,
} from "../domain/npmOpenScriptLocation";
import type { NodePackageScript } from "../domain/nodePackageScripts";
import {
  parseWorkspacePath,
  type WorkspacePathKey,
  type WorkspaceRootDescriptor,
} from "../domain/workspacePath";
import { joinWorkspacePath, type EditorDocument } from "../domain/workspace";
import type { EditorPosition } from "../domain/languageServerFeatures";

export interface NpmOpenScriptNavigationOwner {
  readonly activationEpoch: number;
  readonly ownerKey: string;
  readonly rootPath: string;
  readonly workspaceId: string;
  /** Canonical and selected-path aliases, all issued for this exact workspace owner. */
  readonly workspaceRoots: readonly WorkspaceRootDescriptor[];
}

export type NpmOpenScriptManifestRead =
  | { readonly status: "changed" | "missing" | "tooLarge" }
  | {
      readonly status: "ok";
      readonly content: string;
      readonly revision: string;
      /** Synchronous lease check used immediately before and during navigation commit. */
      isCurrent(): boolean;
    };

export interface NpmOpenScriptNavigationGateway {
  readManifestBounded(request: {
    readonly activationEpoch: number;
    readonly manifestRelativePath: string;
    readonly maxBytes: number;
    readonly ownerKey: string;
    readonly rootPath: string;
    readonly workspaceId: string;
  }): Promise<NpmOpenScriptManifestRead>;
}

export interface NpmOpenScriptGatewayOwner {
  readonly activationEpoch: number;
  readonly nodePackageScriptDiscoveryVersion: number;
  readonly ownerKey: string;
  readonly rootPath: string;
  readonly workspaceId: string;
}

/** A synchronous authority port. Returning null explicitly removes read authority. */
export type NpmOpenScriptGatewayOwnerPort = () => NpmOpenScriptGatewayOwner | null;

export interface NpmOpenScriptNavigationGatewayBinder {
  bindNpmOpenScriptNavigation(
    ownerPort: NpmOpenScriptGatewayOwnerPort | null,
  ): NpmOpenScriptNavigationGateway;
}

export interface UseNpmOpenScriptNavigationOptions {
  readonly documents: readonly EditorDocument[];
  readonly gateway: NpmOpenScriptNavigationGateway;
  readonly owner: NpmOpenScriptNavigationOwner | null;
  openNavigationTarget(
    path: string,
    position: EditorPosition,
    label: string,
    options: {
      readonly activationEpoch: number;
      readonly ownerKey: string;
      readonly shouldCommit: () => boolean;
      readonly workspaceId: string;
    },
  ): Promise<boolean>;
}

interface CurrentAuthority extends UseNpmOpenScriptNavigationOptions {
  readonly generation: number;
  readonly mounted: boolean;
}

type ManifestSnapshot =
  | { readonly kind: "ambiguous" }
  | {
      readonly content: string;
      readonly documentPath: string;
      readonly kind: "document";
      readonly savedContent: string;
    }
  | { readonly kind: "none" };

/** Opens an npm script key under an explicit, versioned workspace authority. */
export function useNpmOpenScriptNavigation({
  documents,
  gateway,
  openNavigationTarget,
  owner,
}: UseNpmOpenScriptNavigationOptions): (
  script: Pick<NodePackageScript, "manifestRelativePath" | "scriptName">,
) => Promise<boolean> {
  const authorityRef = useRef<CurrentAuthority>({
    documents,
    gateway,
    generation: 0,
    mounted: false,
    openNavigationTarget,
    owner,
  });
  const previousAuthority = authorityRef.current;
  const authorityChanged =
    previousAuthority.gateway !== gateway ||
    previousAuthority.openNavigationTarget !== openNavigationTarget ||
    previousAuthority.owner?.activationEpoch !== owner?.activationEpoch ||
    previousAuthority.owner?.ownerKey !== owner?.ownerKey ||
    previousAuthority.owner?.rootPath !== owner?.rootPath ||
    previousAuthority.owner?.workspaceId !== owner?.workspaceId ||
    previousAuthority.owner?.workspaceRoots !== owner?.workspaceRoots;
  authorityRef.current = {
    documents,
    gateway,
    generation: previousAuthority.generation + (authorityChanged ? 1 : 0),
    mounted: authorityRef.current.mounted,
    openNavigationTarget,
    owner,
  };
  const capturedAuthorityGeneration = authorityRef.current.generation;
  const requestSequenceRef = useRef(0);

  useEffect(() => {
    authorityRef.current = { ...authorityRef.current, mounted: true };
    return () => {
      authorityRef.current = { ...authorityRef.current, mounted: false };
      requestSequenceRef.current += 1;
    };
  }, []);

  const capturedActivationEpoch = owner?.activationEpoch ?? null;
  const capturedOwnerKey = owner?.ownerKey ?? null;
  const capturedRootPath = owner?.rootPath ?? null;
  const capturedWorkspaceId = owner?.workspaceId ?? null;
  const capturedWorkspaceRoots = owner?.workspaceRoots ?? null;

  return useCallback(
    async (
      selected: Pick<NodePackageScript, "manifestRelativePath" | "scriptName">,
    ): Promise<boolean> => {
      if (
        capturedActivationEpoch === null ||
        capturedOwnerKey === null ||
        capturedRootPath === null ||
        capturedWorkspaceId === null ||
        capturedWorkspaceRoots === null
      ) {
        return false;
      }
      const requestedOwner: NpmOpenScriptNavigationOwner = {
        activationEpoch: capturedActivationEpoch,
        ownerKey: capturedOwnerKey,
        rootPath: capturedRootPath,
        workspaceId: capturedWorkspaceId,
        workspaceRoots: capturedWorkspaceRoots,
      };
      const requestedGateway = gateway;
      const requestedOpener = openNavigationTarget;
      const manifestRelativePath = selected.manifestRelativePath;
      const scriptName = selected.scriptName;
      const isCapturedAuthorityCurrent = () => {
        const current = authorityRef.current;
        return (
          current.mounted &&
          current.generation === capturedAuthorityGeneration &&
          current.gateway === requestedGateway &&
          current.openNavigationTarget === requestedOpener &&
          current.owner?.ownerKey === requestedOwner.ownerKey &&
          current.owner.activationEpoch === requestedOwner.activationEpoch &&
          current.owner.rootPath === requestedOwner.rootPath &&
          current.owner.workspaceId === requestedOwner.workspaceId &&
          current.owner.workspaceRoots === requestedOwner.workspaceRoots
        );
      };
      if (!validOwner(requestedOwner) || !isCapturedAuthorityCurrent()) return false;
      const requestToken = ++requestSequenceRef.current;
      const isAuthorityCurrent = () => {
        return isCapturedAuthorityCurrent() && requestSequenceRef.current === requestToken;
      };

      const root = rootForExecutionPath(requestedOwner);
      if (!root) return false;
      const manifestPath = joinWorkspacePath(requestedOwner.rootPath, manifestRelativePath);
      const target = parseWorkspacePath(root, manifestPath);
      if (!target.ok || target.value.relativePath !== manifestRelativePath) return false;

      let snapshot = manifestSnapshot(
        authorityRef.current.documents,
        requestedOwner.workspaceRoots,
        target.value.key,
      );
      if (snapshot.kind === "ambiguous") return false;
      let source: string;
      let readLease: Extract<NpmOpenScriptManifestRead, { status: "ok" }> | null = null;
      if (snapshot.kind === "document") {
        source = snapshot.content;
      } else {
        try {
          const read = await requestedGateway.readManifestBounded({
            activationEpoch: requestedOwner.activationEpoch,
            manifestRelativePath,
            maxBytes: MAX_NPM_OPEN_SCRIPT_MANIFEST_BYTES,
            ownerKey: requestedOwner.ownerKey,
            rootPath: requestedOwner.rootPath,
            workspaceId: requestedOwner.workspaceId,
          });
          if (!isAuthorityCurrent() || read.status !== "ok" || !validLease(read)) return false;
          snapshot = manifestSnapshot(
            authorityRef.current.documents,
            requestedOwner.workspaceRoots,
            target.value.key,
          );
          if (snapshot.kind === "ambiguous") return false;
          if (snapshot.kind === "document") {
            source = snapshot.content;
          } else {
            readLease = read;
            source = read.content;
          }
        } catch {
          return false;
        }
      }
      if (!isAuthorityCurrent() || byteLength(source) > MAX_NPM_OPEN_SCRIPT_MANIFEST_BYTES) {
        return false;
      }

      const isSourceCurrent = () => {
        if (!isAuthorityCurrent()) return false;
        const currentSnapshot = manifestSnapshot(
          authorityRef.current.documents,
          requestedOwner.workspaceRoots,
          target.value.key,
        );
        if (snapshot.kind === "document") {
          return (
            currentSnapshot.kind === "document" &&
            currentSnapshot.documentPath === snapshot.documentPath &&
            currentSnapshot.content === snapshot.content &&
            currentSnapshot.savedContent === snapshot.savedContent
          );
        }
        return currentSnapshot.kind === "none" && readLease !== null && leaseCurrent(readLease);
      };
      if (!isSourceCurrent()) return false;
      const location = npmOpenScriptLocation({
        manifestContent: source,
        manifestRelativePath,
        scriptName,
      });
      if (!location || !isAuthorityCurrent() || !isSourceCurrent()) return false;

      try {
        const opened = await requestedOpener(manifestPath, location.start, scriptName, {
          activationEpoch: requestedOwner.activationEpoch,
          ownerKey: requestedOwner.ownerKey,
          shouldCommit: isSourceCurrent,
          workspaceId: requestedOwner.workspaceId,
        });
        return isAuthorityCurrent() && isSourceCurrent() && opened;
      } catch {
        return false;
      }
    },
    [
      capturedActivationEpoch,
      capturedAuthorityGeneration,
      capturedOwnerKey,
      capturedRootPath,
      capturedWorkspaceId,
      capturedWorkspaceRoots,
      gateway,
      openNavigationTarget,
    ],
  );
}

function validOwner(owner: NpmOpenScriptNavigationOwner): boolean {
  return (
    owner.ownerKey.length > 0 &&
    Number.isSafeInteger(owner.activationEpoch) &&
    owner.activationEpoch >= 0 &&
    owner.rootPath.length > 0 &&
    owner.workspaceId.length > 0 &&
    owner.workspaceRoots.length > 0 &&
    owner.workspaceRoots.every((root) => root.workspaceId === owner.workspaceId)
  );
}

function rootForExecutionPath(owner: NpmOpenScriptNavigationOwner): WorkspaceRootDescriptor | null {
  for (const root of owner.workspaceRoots) {
    const parsed = parseWorkspacePath(root, owner.rootPath);
    if (parsed.ok && parsed.value.relativePath === "") return root;
  }
  return null;
}

function manifestSnapshot(
  documents: readonly EditorDocument[],
  roots: readonly WorkspaceRootDescriptor[],
  targetKey: WorkspacePathKey,
): ManifestSnapshot {
  const matches: EditorDocument[] = [];
  for (const document of documents) {
    if (
      roots.some((root) => {
        const path = parseWorkspacePath(root, document.path);
        return path.ok && path.value.key === targetKey;
      })
    ) {
      matches.push(document);
    }
  }
  if (matches.length > 1) return { kind: "ambiguous" };
  const document = matches[0];
  return document
    ? {
        content: document.content,
        documentPath: document.path,
        kind: "document",
        savedContent: document.savedContent,
      }
    : { kind: "none" };
}

function validLease(lease: Extract<NpmOpenScriptManifestRead, { status: "ok" }>): boolean {
  return lease.revision.length > 0 && leaseCurrent(lease);
}

function leaseCurrent(lease: Extract<NpmOpenScriptManifestRead, { status: "ok" }>): boolean {
  try {
    return lease.isCurrent();
  } catch {
    return false;
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
