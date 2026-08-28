import { useCallback, useMemo, useRef, type MutableRefObject } from "react";
import type { LanguageServerRuntimeStatus } from "../../domain/languageServerRuntime";
import type { WorkspaceRuntimeOwner } from "../../domain/workspaceRuntimeOwner";
import { normalizedWorkspaceRootKey, workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import { DocumentSessionAuthorityLifecycleCoordinator } from "../documentSessionAuthorityLifecycleCoordinator";
import type { ResolveDocumentSaveOwnership } from "../documentSaveIdentity";
import { DocumentSelfWriteCoordinator } from "../documentSelfWriteCoordinator";
import type { DocumentLifecycleWorkspaceAuthority } from "../useDocumentCloseLifecycle";
import type { WorkspaceIdentityGateway } from "../workspaceIdentityGatewayPort";
import type { WorkspaceSettingsByRootSnapshot } from "../workspaceSettingsForRoot";
import { WorkspaceRuntimeOwnerClaimRegistry } from "../workspaceRuntimeOwnerClaimRegistry";
import type { WorkspaceTrustIntentCoordinator } from "../workspaceTrustIntentCoordinator";
import { useManagedWorkspaceIdentityOwnership } from "./useManagedWorkspaceIdentityOwnership";
import { useWorkbenchLanguageRuntimeEventOwnerResolver } from "./useWorkbenchLanguageRuntimeSubscriptionsCoordinator";
import {
  admittedWorkspaceIdentityForRoot,
  resolveAdmittedDocumentSaveOwnership,
} from "./workspaceIdentityPolicy";
import type { EditorSessionOwnerKey } from "../../domain/editorSessionOwnerKey";
import type { EditorDocument } from "../../domain/workspace";
import type { DocumentSessionOwnerInput } from "../documentSessionStorePort";
import type { WorkspaceIdentityDescriptor } from "../workspaceIdentityGatewayPort";
import type { WorkspaceRequestTokenRegistry } from "./workspaceRequestTokenRegistry";

interface WorkspaceIdentityAuthorityDependencies {
  readonly deferredWorkspaceIdentityCleanupIdsRef: MutableRefObject<Set<string>>;
  readonly latestWorkspaceIdentityAdmissionGenerationByIdRef: MutableRefObject<
    Record<string, number>
  >;
  readonly ownedWorkspaceIdentityGenerationByIdRef: MutableRefObject<Record<string, number>>;
  readonly ownedWorkspaceIdentityIdsRef: MutableRefObject<Set<string>>;
  readonly pendingWorkspaceIdentityAdmissionsRef: MutableRefObject<Record<string, Set<number>>>;
  readonly pendingWorkspaceIdentityRequestTokensRef: MutableRefObject<WorkspaceRequestTokenRegistry>;
  readonly releasedWorkspaceIdentityIdsRef: MutableRefObject<Set<string>>;
  readonly workspaceIdentityAdmissionGenerationRef: MutableRefObject<number>;
  readonly workspaceIdentityReleaseGenerationByIdRef: MutableRefObject<Record<string, number>>;
  readonly workspaceIdentityUnregisterByIdRef: MutableRefObject<Record<string, Promise<void>>>;
}

interface WorkbenchControllerAuthorityDependencies {
  readonly activateDocumentSessionAuthority: (
    input: DocumentSessionOwnerInput,
    resolveOwnership: ResolveDocumentSaveOwnership,
    documents: Readonly<Record<string, EditorDocument>>,
  ) => boolean;
  readonly currentEditorSessionOwnerKeyRef: MutableRefObject<EditorSessionOwnerKey | null>;
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly deactivateDocumentSessionAuthority: () => void;
  readonly identityGateway: WorkspaceIdentityGateway;
  readonly javaScriptTypeScriptRuntimeStatusByRootRef: MutableRefObject<
    Record<string, LanguageServerRuntimeStatus>
  >;
  readonly javaScriptTypeScriptTrustAutostartRef: MutableRefObject<{
    readonly owner: WorkspaceRuntimeOwner;
  } | null>;
  readonly languageServerRuntimeStatusByRootRef: MutableRefObject<
    Record<string, LanguageServerRuntimeStatus>
  >;
  readonly openWorkspaceRequestTokenRef: MutableRefObject<number>;
  readonly reportError: (source: string, error: unknown) => void;
  readonly resolveWorkspaceRuntimeOwner: (rootPath: string) => WorkspaceRuntimeOwner | null;
  readonly workbenchMountedRef: MutableRefObject<boolean>;
  readonly workspaceIdentityAuthority: WorkspaceIdentityAuthorityDependencies;
  readonly workspaceRuntimeOwnerGenerationForIndexRef: MutableRefObject<
    (ownerKey: string) => number | null | undefined
  >;
  readonly workspaceRuntimeOwnerRef: MutableRefObject<WorkspaceRuntimeOwner | null>;
  readonly workspaceSettingsByRoot: WorkspaceSettingsByRootSnapshot;
  readonly workspaceTrustIntentCoordinatorRef: MutableRefObject<WorkspaceTrustIntentCoordinator>;
  readonly workspaceTrustRevisionByOwnerRef: MutableRefObject<Record<string, number>>;
}

export function useWorkbenchControllerAuthorityCoordinator(
  dependencies: WorkbenchControllerAuthorityDependencies,
) {
  const {
    activateDocumentSessionAuthority,
    currentEditorSessionOwnerKeyRef,
    currentWorkspaceRootRef,
    deactivateDocumentSessionAuthority,
    identityGateway,
    javaScriptTypeScriptRuntimeStatusByRootRef,
    javaScriptTypeScriptTrustAutostartRef,
    languageServerRuntimeStatusByRootRef,
    openWorkspaceRequestTokenRef,
    reportError,
    resolveWorkspaceRuntimeOwner,
    workbenchMountedRef,
    workspaceIdentityAuthority,
    workspaceRuntimeOwnerGenerationForIndexRef,
    workspaceRuntimeOwnerRef,
    workspaceSettingsByRoot,
    workspaceTrustIntentCoordinatorRef,
    workspaceTrustRevisionByOwnerRef,
  } = dependencies;
  const workspaceIdentityByRootRef = useRef<Record<string, WorkspaceIdentityDescriptor>>({});
  const resolveDocumentSaveOwnership = useCallback<ResolveDocumentSaveOwnership>(
    (rootPath, path) =>
      resolveAdmittedDocumentSaveOwnership(
        workspaceIdentityByRootRef.current,
        identityGateway,
        rootPath,
        path,
      ),
    [identityGateway],
  );
  const documentSessionAuthorityLifecycle = useMemo(
    () =>
      new DocumentSessionAuthorityLifecycleCoordinator({
        activate: activateDocumentSessionAuthority,
        deactivate: deactivateDocumentSessionAuthority,
      }),
    [activateDocumentSessionAuthority, deactivateDocumentSessionAuthority],
  );
  const documentSelfWrites = useMemo(() => new DocumentSelfWriteCoordinator(), []);
  const canonicalDocumentSaveRoot = useCallback(
    (rootPath: string) =>
      admittedWorkspaceIdentityForRoot(
        workspaceIdentityByRootRef.current,
        identityGateway,
        rootPath,
      )?.canonicalRoot ?? rootPath,
    [identityGateway],
  );
  const resolveWorkspaceSettingsForDiagnosticsRoot = useCallback(
    (rootPath: string) => {
      const descriptor = admittedWorkspaceIdentityForRoot(
        workspaceIdentityByRootRef.current,
        identityGateway,
        rootPath,
      );
      return workspaceSettingsByRoot.resolve(descriptor?.canonicalRoot ?? rootPath);
    },
    [identityGateway, workspaceSettingsByRoot],
  );
  const workspaceRuntimeOwnerClaimsRef = useRef(new WorkspaceRuntimeOwnerClaimRegistry());
  const resolveDocumentLifecycleWorkspaceOwner = useCallback(
    (rootPath: string) =>
      resolveWorkspaceRuntimeOwner(rootPath) ??
      (workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)
        ? workspaceRuntimeOwnerRef.current
        : null),
    [currentWorkspaceRootRef, resolveWorkspaceRuntimeOwner, workspaceRuntimeOwnerRef],
  );
  const captureDocumentLifecycleWorkspaceAuthority = useCallback(
    (rootPath: string): DocumentLifecycleWorkspaceAuthority | null => {
      const owner = resolveDocumentLifecycleWorkspaceOwner(rootPath);
      const identity = admittedWorkspaceIdentityForRoot(
        workspaceIdentityByRootRef.current,
        identityGateway,
        rootPath,
      );
      const claimGeneration = owner
        ? workspaceRuntimeOwnerClaimsRef.current.generationFor(owner.ownerKey)
        : undefined;
      if (identity) {
        if (
          !owner ||
          identity.workspaceId !== owner.ownerKey ||
          typeof identity.admissionToken !== "number" ||
          typeof claimGeneration !== "number"
        ) {
          return null;
        }
        return { kind: "registered", claimGeneration, identity, owner, rootPath };
      }
      if (typeof claimGeneration === "number") return null;

      if (owner && owner.ownerKey !== normalizedWorkspaceRootKey(rootPath)) return null;

      return {
        editorSessionOwnerKey: currentEditorSessionOwnerKeyRef.current,
        kind: "legacy",
        owner,
        requestGeneration: openWorkspaceRequestTokenRef.current,
        rootPath,
      };
    },
    [
      currentEditorSessionOwnerKeyRef,
      identityGateway,
      openWorkspaceRequestTokenRef,
      resolveDocumentLifecycleWorkspaceOwner,
    ],
  );
  const isDocumentLifecycleWorkspaceAuthorityCurrent = useCallback(
    (authority: DocumentLifecycleWorkspaceAuthority): boolean => {
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, authority.rootPath)) {
        return false;
      }
      const identity = admittedWorkspaceIdentityForRoot(
        workspaceIdentityByRootRef.current,
        identityGateway,
        authority.rootPath,
      );
      if (authority.kind === "registered") {
        return (
          resolveDocumentLifecycleWorkspaceOwner(authority.rootPath) === authority.owner &&
          identity?.workspaceId === authority.identity.workspaceId &&
          identity.admissionToken === authority.identity.admissionToken &&
          workspaceRootKeysEqual(identity.canonicalRoot, authority.identity.canonicalRoot) &&
          workspaceRuntimeOwnerClaimsRef.current.generationFor(authority.owner.ownerKey) ===
            authority.claimGeneration
        );
      }
      return (
        !identity &&
        currentEditorSessionOwnerKeyRef.current === authority.editorSessionOwnerKey &&
        openWorkspaceRequestTokenRef.current === authority.requestGeneration &&
        (!authority.owner ||
          workspaceRuntimeOwnerClaimsRef.current.generationFor(authority.owner.ownerKey) == null)
      );
    },
    [
      currentEditorSessionOwnerKeyRef,
      currentWorkspaceRootRef,
      identityGateway,
      openWorkspaceRequestTokenRef,
      resolveDocumentLifecycleWorkspaceOwner,
    ],
  );
  workspaceRuntimeOwnerGenerationForIndexRef.current = (ownerKey) =>
    workspaceRuntimeOwnerClaimsRef.current.generationFor(ownerKey);
  const releaseWorkspaceTrustOwner = useCallback(
    (ownerKey: string) => {
      workspaceTrustIntentCoordinatorRef.current.release(ownerKey);
      delete workspaceTrustRevisionByOwnerRef.current[ownerKey];
      if (javaScriptTypeScriptTrustAutostartRef.current?.owner.ownerKey === ownerKey) {
        javaScriptTypeScriptTrustAutostartRef.current = null;
      }
    },
    [
      javaScriptTypeScriptTrustAutostartRef,
      workspaceTrustIntentCoordinatorRef,
      workspaceTrustRevisionByOwnerRef,
    ],
  );
  const retireWorkspaceRuntimeOwnerClaim = useCallback(
    (ownerKey: string, expectedGeneration?: number | null) => {
      const retiredOwner = workspaceRuntimeOwnerClaimsRef.current.retire(
        ownerKey,
        expectedGeneration,
      );
      if (!retiredOwner) return;

      releaseWorkspaceTrustOwner(ownerKey);
    },
    [releaseWorkspaceTrustOwner],
  );
  const resolveWorkspaceRuntimeOwnerForDiagnosticsEvent =
    useWorkbenchLanguageRuntimeEventOwnerResolver({
      javaScriptTypeScriptRuntimeStatusByRootRef: javaScriptTypeScriptRuntimeStatusByRootRef,
      languageServerRuntimeStatusByRootRef: languageServerRuntimeStatusByRootRef,
      workspaceRuntimeOwnerClaimsRef,
    });
  const managedIdentity = useManagedWorkspaceIdentityOwnership({
    deferredCleanupIdsRef: workspaceIdentityAuthority.deferredWorkspaceIdentityCleanupIdsRef,
    identityGateway: identityGateway,
    identityRequestTokensRef: workspaceIdentityAuthority.pendingWorkspaceIdentityRequestTokensRef,
    latestAdmissionGenerationByIdRef:
      workspaceIdentityAuthority.latestWorkspaceIdentityAdmissionGenerationByIdRef,
    mountedRef: workbenchMountedRef,
    nextAdmissionGenerationRef: workspaceIdentityAuthority.workspaceIdentityAdmissionGenerationRef,
    ownedGenerationByIdRef: workspaceIdentityAuthority.ownedWorkspaceIdentityGenerationByIdRef,
    ownedIdsRef: workspaceIdentityAuthority.ownedWorkspaceIdentityIdsRef,
    pendingAdmissionsRef: workspaceIdentityAuthority.pendingWorkspaceIdentityAdmissionsRef,
    releasedIdsRef: workspaceIdentityAuthority.releasedWorkspaceIdentityIdsRef,
    releaseGenerationByIdRef: workspaceIdentityAuthority.workspaceIdentityReleaseGenerationByIdRef,
    reportError: reportError,
    retireRuntimeOwnerClaim: retireWorkspaceRuntimeOwnerClaim,
    runtimeOwnerClaimsRef: workspaceRuntimeOwnerClaimsRef,
    unregisterByIdRef: workspaceIdentityAuthority.workspaceIdentityUnregisterByIdRef,
  });

  return {
    canonicalDocumentSaveRoot,
    captureDocumentLifecycleWorkspaceAuthority,
    documentSelfWrites,
    documentSessionAuthorityLifecycle,
    isDocumentLifecycleWorkspaceAuthorityCurrent,
    managedIdentity,
    releaseWorkspaceTrustOwner,
    resolveDocumentSaveOwnership,
    resolveWorkspaceRuntimeOwnerForDiagnosticsEvent,
    resolveWorkspaceSettingsForDiagnosticsRoot,
    retireWorkspaceRuntimeOwnerClaim,
    workspaceIdentityByRootRef,
    workspaceRuntimeOwnerClaimsRef,
  };
}
