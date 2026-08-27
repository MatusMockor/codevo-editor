import { useCallback, type MutableRefObject } from "react";
import type { WorkspaceRuntimeOwner } from "../../domain/workspaceRuntimeOwner";
import type { EditorDocument } from "../../domain/workspace";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import type { EditorSessionDocumentLifecycleAuthority } from "../editorSessionDocumentAuthority";
import {
  useChangedDocumentSyncScheduling,
  type ChangedDocumentSyncSchedulingDependencies,
} from "../useChangedDocumentSyncScheduling";
import type { WorkspaceIdentityDescriptor } from "../workspaceIdentityGatewayPort";

interface WorkbenchChangedDocumentSyncAuthorityDependencies {
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  isDocumentSessionLifecycleAuthorityCurrent(
    authority: EditorSessionDocumentLifecycleAuthority,
  ): boolean;
  resolveDocumentSessionLifecycleAuthority(
    path: string,
  ): EditorSessionDocumentLifecycleAuthority | null;
  readonly workspaceRuntimeOwnerClaimsRef: {
    readonly current: { generationFor(ownerKey: string): number | null | undefined };
  };
  readonly workspaceIdentityDescriptorRef: MutableRefObject<WorkspaceIdentityDescriptor | null>;
  readonly workspaceRuntimeOwnerRef: MutableRefObject<WorkspaceRuntimeOwner | null>;
}

export interface WorkbenchChangedDocumentSyncCoordinatorDependencies
  extends
    Omit<ChangedDocumentSyncSchedulingDependencies, "captureAuthority">,
    WorkbenchChangedDocumentSyncAuthorityDependencies {}

export function useWorkbenchChangedDocumentSyncCoordinator({
  currentWorkspaceRootRef,
  documentsRef,
  incrementalSyncRef,
  isDocumentSessionLifecycleAuthorityCurrent,
  resolveDocumentSessionLifecycleAuthority,
  scheduleDocumentChange,
  scheduleJavaScriptTypeScriptDocumentChange,
  subscribeChangedDocuments,
  workspaceIdentityDescriptorRef,
  workspaceRuntimeOwnerClaimsRef,
  workspaceRuntimeOwnerRef,
}: WorkbenchChangedDocumentSyncCoordinatorDependencies): void {
  const captureAuthority = useCallback(
    (document: EditorDocument) => {
      const rootPath = currentWorkspaceRootRef.current;
      const identity = workspaceIdentityDescriptorRef.current;
      const owner = workspaceRuntimeOwnerRef.current;
      const lifecycle = resolveDocumentSessionLifecycleAuthority(document.path);
      const ownerGeneration = owner
        ? workspaceRuntimeOwnerClaimsRef.current.generationFor(owner.ownerKey)
        : null;
      if (
        !rootPath ||
        !identity ||
        !owner ||
        !lifecycle ||
        ownerGeneration === null ||
        ownerGeneration === undefined ||
        identity.workspaceId !== owner.ownerKey ||
        !workspaceRootKeysEqual(identity.selectedPath, rootPath) ||
        !workspaceRootKeysEqual(owner.executionRoot, rootPath)
      ) {
        return null;
      }
      const workspaceId = identity.workspaceId;
      const canonicalRoot = identity.canonicalRoot;
      const selectedPath = identity.selectedPath;
      const executionRoot = owner.executionRoot;
      return {
        isCurrent: (latest: EditorDocument) =>
          latest.path === document.path &&
          currentWorkspaceRootRef.current === rootPath &&
          workspaceIdentityDescriptorRef.current === identity &&
          identity.workspaceId === workspaceId &&
          identity.canonicalRoot === canonicalRoot &&
          identity.selectedPath === selectedPath &&
          workspaceRuntimeOwnerRef.current === owner &&
          owner.ownerKey === workspaceId &&
          owner.executionRoot === executionRoot &&
          identity.workspaceId === owner.ownerKey &&
          workspaceRootKeysEqual(identity.selectedPath, currentWorkspaceRootRef.current) &&
          workspaceRootKeysEqual(owner.executionRoot, currentWorkspaceRootRef.current) &&
          workspaceRootKeysEqual(selectedPath, rootPath) &&
          workspaceRootKeysEqual(executionRoot, rootPath) &&
          workspaceRuntimeOwnerClaimsRef.current.generationFor(owner.ownerKey) ===
            ownerGeneration &&
          resolveDocumentSessionLifecycleAuthority(document.path) === lifecycle &&
          isDocumentSessionLifecycleAuthorityCurrent(lifecycle),
      };
    },
    [
      currentWorkspaceRootRef,
      isDocumentSessionLifecycleAuthorityCurrent,
      resolveDocumentSessionLifecycleAuthority,
      workspaceIdentityDescriptorRef,
      workspaceRuntimeOwnerClaimsRef,
      workspaceRuntimeOwnerRef,
    ],
  );
  useChangedDocumentSyncScheduling({
    captureAuthority,
    documentsRef,
    incrementalSyncRef,
    scheduleDocumentChange,
    scheduleJavaScriptTypeScriptDocumentChange,
    subscribeChangedDocuments,
  });
}
