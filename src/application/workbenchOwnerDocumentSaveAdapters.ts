import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { editorGroupsUniquePaths } from "../domain/editorGroups";
import { isDirty, type EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import type { WorkspaceIdentityDescriptor } from "../infrastructure/tauriWorkspaceIdentityGateway";
import {
  documentSaveOwnershipKey,
  type ResolveDocumentSaveOwnership,
} from "./documentSaveIdentity";
import {
  OwnerDocumentSaveRepository,
  type OwnerDocumentRepositoryCandidate,
  type RepositoryDocumentSnapshot,
} from "./ownerDocumentSaveRepository";
import type { CachedWorkspaceWorkbenchState } from "./useWorkspaceStateCache";
import type { WorkbenchDirtyCloseTarget } from "./useWorkbenchCloseLifecycle";

interface ActiveRepositoryState {
  readonly documentsRef: MutableRefObject<Record<string, EditorDocument>>;
  readonly owner: WorkspaceRuntimeOwner;
  readonly rootPath: string;
  readonly setDocuments: Dispatch<SetStateAction<Record<string, EditorDocument>>>;
}

export interface WorkbenchOwnerDocumentSaveAdaptersDependencies {
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  documentsRef: MutableRefObject<Record<string, EditorDocument>>;
  editorGroupsRef: MutableRefObject<Parameters<typeof editorGroupsUniquePaths>[0]>;
  setDocuments: Dispatch<SetStateAction<Record<string, EditorDocument>>>;
  workspaceStateCacheRef: MutableRefObject<
    Record<string, CachedWorkspaceWorkbenchState>
  >;
  workspaceIdentityByRootRef: MutableRefObject<
    Record<string, WorkspaceIdentityDescriptor>
  >;
  resolveDocumentSaveOwnership: ResolveDocumentSaveOwnership;
  resolveWorkspaceRuntimeOwner(rootPath: string): WorkspaceRuntimeOwner | null;
  hasExternalFileConflict(rootPath: string, path: string): boolean;
}

interface DocumentIncarnation {
  readonly aliases: readonly EditorDocument[];
  readonly token: object;
}

export class WorkbenchOwnerDocumentSaveAdapters {
  readonly repository: OwnerDocumentSaveRepository;
  private readonly documentIncarnations = new Map<string, DocumentIncarnation>();

  constructor(
    private readonly dependencies: WorkbenchOwnerDocumentSaveAdaptersDependencies,
  ) {
    this.repository = new OwnerDocumentSaveRepository({
      active: () => this.activeCandidate(),
      cached: (owner) => this.cachedCandidate(owner),
    });
  }

  capture(rootPath: string | null): readonly WorkbenchDirtyCloseTarget[] | null {
    const repositories = this.repositories(rootPath);
    if (!repositories) {
      return null;
    }

    const targets: WorkbenchDirtyCloseTarget[] = [];
    const captured = new Set<string>();
    for (const repository of repositories) {
      for (const path of repository.paths) {
        const document = repository.documents[path];
        if (!document || document.readOnly === true) {
          continue;
        }
        if (
          !isDirty(document) &&
          !this.dependencies.hasExternalFileConflict(repository.rootPath, path)
        ) {
          continue;
        }

        const ownership = this.dependencies.resolveDocumentSaveOwnership(
          repository.rootPath,
          path,
        );
        if (!ownership) {
          return null;
        }
        const documentIdentity = documentSaveOwnershipKey(ownership);
        if (!documentIdentity) {
          return null;
        }
        const canonicalDocument = this.documentsForIdentity(
          repository.rootPath,
          documentIdentity,
          repository.documents,
        )[0];
        if (!canonicalDocument) {
          return null;
        }
        const targetId = `${repository.owner.ownerKey}\0${documentIdentity}`;
        if (captured.has(targetId)) {
          continue;
        }

        captured.add(targetId);
        targets.push({
          owner: repository.owner,
          targetId,
          identity: {
            ownership,
            saveTarget: {
              owner: repository.owner,
              documentIdentity,
              document: canonicalDocument,
            },
          },
        });
      }
    }

    return targets;
  }

  isOwnerCurrent(owner: WorkspaceRuntimeOwner): boolean {
    return Boolean(this.candidate(owner));
  }

  private repositories(rootPath: string | null): Array<{
    documents: Record<string, EditorDocument>;
    owner: WorkspaceRuntimeOwner;
    paths: string[];
    rootPath: string;
  }> | null {
    const repositories: Array<{
      documents: Record<string, EditorDocument>;
      owner: WorkspaceRuntimeOwner;
      paths: string[];
      rootPath: string;
    }> = [];
    const capturedOwners = new Set<string>();
    const activeRoot = this.dependencies.currentWorkspaceRootRef.current;
    const activeOwner = activeRoot
      ? this.dependencies.resolveWorkspaceRuntimeOwner(activeRoot)
      : null;
    if (activeRoot && activeOwner && this.matchesRoot(activeRoot, activeOwner, rootPath)) {
      repositories.push({
        documents: this.dependencies.documentsRef.current,
        owner: activeOwner,
        paths: editorGroupsUniquePaths(this.dependencies.editorGroupsRef.current),
        rootPath: activeRoot,
      });
      capturedOwners.add(activeOwner.ownerKey);
    }

    for (const [cacheKey, cached] of Object.entries(
      this.dependencies.workspaceStateCacheRef.current,
    )) {
      const cachedRoot = cached.workspaceIdentityDescriptor?.selectedPath ?? cacheKey;
      const owner = this.ownerForCachedState(cachedRoot, cached);
      if (!owner) {
        if (rootPath && this.cachedStateMatchesRoot(cachedRoot, cached, rootPath)) {
          return null;
        }
        continue;
      }
      if (capturedOwners.has(owner.ownerKey)) {
        continue;
      }
      if (!this.matchesRoot(cachedRoot, owner, rootPath)) {
        continue;
      }

      repositories.push({
        documents: cached.editorSurface.documents,
        owner,
        paths: cached.editorSurface.editorGroups
          ? editorGroupsUniquePaths(cached.editorSurface.editorGroups)
          : [...new Set([
              ...cached.editorSurface.openPaths,
              ...(cached.editorSurface.previewPath
                ? [cached.editorSurface.previewPath]
                : []),
            ])],
        rootPath: cachedRoot,
      });
      capturedOwners.add(owner.ownerKey);
    }

    return repositories;
  }

  private matchesRoot(
    candidateRoot: string,
    owner: WorkspaceRuntimeOwner,
    requestedRoot: string | null,
  ): boolean {
    if (!requestedRoot) {
      return true;
    }
    if (
      workspaceRootKeysEqual(candidateRoot, requestedRoot) ||
      workspaceRootKeysEqual(owner.executionRoot, requestedRoot)
    ) {
      return true;
    }

    const requestedIdentity = this.identityForRoot(requestedRoot);
    return requestedIdentity?.workspaceId === owner.ownerKey;
  }

  private cachedStateMatchesRoot(
    cachedRoot: string,
    cached: CachedWorkspaceWorkbenchState,
    requestedRoot: string,
  ): boolean {
    const identity = cached.workspaceIdentityDescriptor;
    return workspaceRootKeysEqual(cachedRoot, requestedRoot) ||
      workspaceRootKeysEqual(identity?.selectedPath, requestedRoot) ||
      workspaceRootKeysEqual(identity?.canonicalRoot, requestedRoot);
  }

  private ownerForCachedState(
    rootPath: string,
    cached: CachedWorkspaceWorkbenchState,
  ): WorkspaceRuntimeOwner | null {
    const identity = cached.workspaceIdentityDescriptor;
    return this.dependencies.resolveWorkspaceRuntimeOwner(rootPath) ??
      (identity
        ? this.dependencies.resolveWorkspaceRuntimeOwner(identity.canonicalRoot)
        : null);
  }

  private identityForRoot(rootPath: string): WorkspaceIdentityDescriptor | null {
    return this.dependencies.workspaceIdentityByRootRef.current[rootPath] ??
      Object.values(this.dependencies.workspaceIdentityByRootRef.current).find(
        (identity) =>
          workspaceRootKeysEqual(identity.selectedPath, rootPath) ||
          workspaceRootKeysEqual(identity.canonicalRoot, rootPath),
      ) ?? null;
  }

  private candidate(
    owner: WorkspaceRuntimeOwner,
  ): OwnerDocumentRepositoryCandidate | null {
    const active = this.activeCandidate();
    if (active?.owner.ownerKey === owner.ownerKey) {
      return active;
    }

    return this.cachedCandidate(owner);
  }

  private activeCandidate(): OwnerDocumentRepositoryCandidate | null {
    const rootPath = this.dependencies.currentWorkspaceRootRef.current;
    if (!rootPath) {
      return null;
    }
    const owner = this.dependencies.resolveWorkspaceRuntimeOwner(rootPath);
    if (!owner) {
      return null;
    }
    const state: ActiveRepositoryState = {
      documentsRef: this.dependencies.documentsRef,
      owner,
      rootPath,
      setDocuments: this.dependencies.setDocuments,
    };
    return this.repositoryCandidate(
      "active",
      owner,
      rootPath,
      owner,
      () => state.documentsRef.current,
      (documents) => {
        state.documentsRef.current = documents;
        state.setDocuments(documents);
      },
    );
  }

  private cachedCandidate(
    owner: WorkspaceRuntimeOwner,
  ): OwnerDocumentRepositoryCandidate | null {
    for (const cached of Object.values(
      this.dependencies.workspaceStateCacheRef.current,
    )) {
      const rootPath = cached.workspaceIdentityDescriptor?.selectedPath ??
        owner.executionRoot;
      const cachedOwner = this.ownerForCachedState(rootPath, cached);
      if (cachedOwner?.ownerKey !== owner.ownerKey) {
        continue;
      }

      return this.repositoryCandidate(
        "cached",
        cachedOwner,
        rootPath,
        cached,
        () => cached.editorSurface.documents,
        (documents) => {
          cached.editorSurface.documents = documents;
        },
      );
    }

    return null;
  }

  private repositoryCandidate(
    kind: "active" | "cached",
    owner: WorkspaceRuntimeOwner,
    rootPath: string,
    incarnation: object,
    documents: () => Record<string, EditorDocument>,
    replaceDocuments: (documents: Record<string, EditorDocument>) => void,
  ): OwnerDocumentRepositoryCandidate {
    const keyPrefix = `${kind}\0${owner.ownerKey}\0${rootPath}\0`;
    const readDocument = (documentIdentity: string): RepositoryDocumentSnapshot | null => {
      const aliases = this.documentsForIdentity(
        rootPath,
        documentIdentity,
        documents(),
      );
      const document = aliases[0];
      if (!document || !aliases.every((alias) =>
        sameCanonicalSnapshot(document, alias)
      )) {
        return null;
      }
      const key = `${keyPrefix}${documentIdentity}`;
      let tracked = this.documentIncarnations.get(key);
      if (!tracked || !sameDocumentAliases(tracked.aliases, aliases)) {
        tracked = { aliases, token: {} };
        this.documentIncarnations.set(key, tracked);
      }
      return { incarnation: tracked.token, document };
    };

    return {
      kind,
      owner,
      rootPath,
      incarnation,
      readDocument,
      replaceDocument: (
        documentIdentity,
        expectedRepositoryIncarnation,
        expectedDocumentIncarnation,
        expectedDocument,
        nextDocument,
      ) => {
        if (expectedRepositoryIncarnation !== incarnation) {
          return false;
        }
        const snapshot = readDocument(documentIdentity);
        if (
          !snapshot ||
          snapshot.incarnation !== expectedDocumentIncarnation ||
          snapshot.document !== expectedDocument
        ) {
          return false;
        }
        const currentDocuments = documents();
        const aliases = this.documentsForIdentity(
          rootPath,
          documentIdentity,
          currentDocuments,
        );
        if (
          aliases.length === 0 ||
          !aliases.every((alias) => sameCanonicalSnapshot(expectedDocument, alias))
        ) {
          return false;
        }
        const nextDocuments = { ...currentDocuments };
        const nextAliases = aliases.map((alias) => {
          const nextAlias = {
            ...nextDocument,
            name: alias.name,
            path: alias.path,
          };
          nextDocuments[alias.path] = nextAlias;
          return nextAlias;
        });
        replaceDocuments(nextDocuments);
        const key = `${keyPrefix}${documentIdentity}`;
        this.documentIncarnations.set(key, {
          aliases: nextAliases,
          token: expectedDocumentIncarnation,
        });
        return true;
      },
    };
  }

  private documentsForIdentity(
    rootPath: string,
    documentIdentity: string,
    documents: Record<string, EditorDocument>,
  ): EditorDocument[] {
    const matches: EditorDocument[] = [];
    for (const document of Object.values(documents)) {
      const ownership = this.dependencies.resolveDocumentSaveOwnership(
        rootPath,
        document.path,
      );
      if (ownership && documentSaveOwnershipKey(ownership) === documentIdentity) {
        matches.push(document);
      }
    }

    return matches;
  }
}

function sameDocumentAliases(
  first: readonly EditorDocument[],
  second: readonly EditorDocument[],
): boolean {
  return first.length === second.length &&
    first.every((document, index) => document === second[index]);
}

function sameCanonicalSnapshot(
  first: EditorDocument,
  second: EditorDocument,
): boolean {
  return first.content === second.content &&
    first.savedContent === second.savedContent &&
    first.language === second.language &&
    (first.readOnly ?? false) === (second.readOnly ?? false) &&
    sameRevision(first.revision ?? null, second.revision ?? null);
}

function sameRevision(
  first: EditorDocument["revision"],
  second: EditorDocument["revision"],
): boolean {
  if (first === second) {
    return true;
  }
  if (!first || !second) {
    return false;
  }

  return first.device === second.device &&
    first.inode === second.inode &&
    first.size === second.size &&
    first.modifiedSeconds === second.modifiedSeconds &&
    first.modifiedNanoseconds === second.modifiedNanoseconds &&
    first.contentHash === second.contentHash;
}
