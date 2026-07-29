import {
  createEditorSessionOwnerKey,
  createLegacyEditorSessionOwnerKey,
  type EditorSessionOwnerKey,
} from "../domain/editorSessionOwnerKey";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { DocumentSessionOwnerInput } from "./documentSessionStorePort";
import type { ResolveDocumentSaveOwnership } from "./documentSaveIdentity";
import type { WorkspaceIdentityDescriptor } from "./workspaceIdentityGatewayPort";

interface DocumentSessionAuthorityLifecyclePort {
  activate(
    input: DocumentSessionOwnerInput,
    resolveOwnership: ResolveDocumentSaveOwnership,
    documents: Readonly<Record<string, EditorDocument>>,
  ): boolean;
  deactivate(): void;
}

export interface DocumentSessionAuthorityActivation {
  readonly descriptor: WorkspaceIdentityDescriptor | null;
  readonly documents: Readonly<Record<string, EditorDocument>>;
  readonly isCurrent: () => boolean;
  readonly ownerKey: EditorSessionOwnerKey | null;
  readonly resolveOwnership: ResolveDocumentSaveOwnership;
  readonly rootPath: string;
}

export function resolveDocumentSessionWorkspaceTransition(
  previousRootPath: string | null,
  previousDescriptor: WorkspaceIdentityDescriptor | null,
  nextRootPath: string,
  nextDescriptor: WorkspaceIdentityDescriptor | null,
) {
  const previousOwnerKey = previousRootPath
    ? previousDescriptor
      ? createEditorSessionOwnerKey(
          previousDescriptor.workspaceId,
          previousDescriptor.canonicalRoot,
        )
      : createLegacyEditorSessionOwnerKey(previousRootPath)
    : null;
  const nextOwnerKey = nextDescriptor
    ? createEditorSessionOwnerKey(nextDescriptor.workspaceId, nextDescriptor.canonicalRoot)
    : createLegacyEditorSessionOwnerKey(nextRootPath);
  const sameRoot = Boolean(
    previousRootPath && workspaceRootKeysEqual(previousRootPath, nextRootPath),
  );
  return {
    nextOwnerKey,
    replacingOwnerAtSameRoot: sameRoot && previousOwnerKey !== nextOwnerKey,
    switchingWorkspace: Boolean(
      previousRootPath && (!sameRoot || previousOwnerKey !== nextOwnerKey),
    ),
  };
}

export function workspaceIdentityAliasPaths(
  identities: Readonly<Record<string, WorkspaceIdentityDescriptor>>,
  descriptor: WorkspaceIdentityDescriptor,
  cachedDescriptor: WorkspaceIdentityDescriptor | null,
): string[] {
  const aliases = [descriptor.selectedPath, descriptor.canonicalRoot];
  if (cachedDescriptor?.workspaceId === descriptor.workspaceId) {
    aliases.push(cachedDescriptor.selectedPath, cachedDescriptor.canonicalRoot);
  }
  for (const [rootPath, registered] of Object.entries(identities)) {
    if (registered.workspaceId === descriptor.workspaceId) {
      aliases.push(rootPath, registered.selectedPath, registered.canonicalRoot);
    }
  }
  return [...new Set(aliases)];
}

export function workspaceTabsWithPath(
  tabs: string[],
  path: string,
  identityAliasPaths: readonly string[] = [],
): string[] {
  const replacedTabIndex = tabs.findIndex((tabPath) =>
    identityAliasPaths.some((aliasPath) => workspaceRootKeysEqual(aliasPath, tabPath)),
  );
  if (replacedTabIndex >= 0) {
    const nextTabs = tabs.filter(
      (tabPath) =>
        !identityAliasPaths.some((aliasPath) => workspaceRootKeysEqual(aliasPath, tabPath)),
    );
    nextTabs.splice(Math.min(replacedTabIndex, nextTabs.length), 0, path);
    return nextTabs;
  }
  return tabs.some((tabPath) => workspaceRootKeysEqual(tabPath, path)) ? tabs : [...tabs, path];
}

/**
 * Owns the narrow workspace-level lifecycle of the document authority sidecar.
 * Document topology remains owned by the editor session; unsupported bypasses
 * therefore fail closed instead of being reconciled from ambient render state.
 */
export class DocumentSessionAuthorityLifecycleCoordinator {
  constructor(private readonly port: DocumentSessionAuthorityLifecyclePort) {}

  deactivate(): void {
    this.port.deactivate();
  }

  deactivateActiveClose(
    rootPath: string,
    descriptor: WorkspaceIdentityDescriptor | null,
    currentRootPath: string | null,
    currentOwnerKey: EditorSessionOwnerKey | null,
  ): void {
    if (
      descriptor &&
      currentOwnerKey ===
        createEditorSessionOwnerKey(descriptor.workspaceId, descriptor.canonicalRoot) &&
      workspaceRootKeysEqual(currentRootPath, rootPath)
    ) {
      this.port.deactivate();
    }
  }

  activate(activation: DocumentSessionAuthorityActivation): boolean {
    const { descriptor, ownerKey } = activation;
    if (!descriptor || !ownerKey || !activation.isCurrent() || !activation.isCurrent()) {
      return false;
    }

    this.port.deactivate();
    let activated = false;
    try {
      activated = this.port.activate(
        {
          canonicalRoot: descriptor.canonicalRoot,
          ownerKey,
          rootPath: activation.rootPath,
          workspaceId: descriptor.workspaceId,
        },
        activation.resolveOwnership,
        activation.documents,
      );
    } catch {
      this.port.deactivate();
      return false;
    }

    if (!activated || !activation.isCurrent()) {
      this.port.deactivate();
      return false;
    }
    return true;
  }
}
