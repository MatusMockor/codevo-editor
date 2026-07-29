import type { ResolveDocumentSaveOwnership } from "../documentSaveIdentity";
import { admittedDocumentSaveOwnership } from "../admittedDocumentSaveOwnership";
import type { WorkspaceSettingsIdentity } from "../../domain/settings";
import type {
  WorkspaceIdentityDescriptor,
  WorkspaceIdentityDescriptorResolver,
  WorkspaceIdentityGateway,
} from "../workspaceIdentityGatewayPort";
import { workspaceRelativePathForDescriptor } from "../workspaceIdentityPath";

export function admittedWorkspaceIdentityForRoot(
  identities: Record<string, WorkspaceIdentityDescriptor>,
  identityGateway: WorkspaceIdentityGateway,
  rootPath: string,
): WorkspaceIdentityDescriptor | null {
  const admitted = Object.values(identities);
  const identityResolver = identityGateway as WorkspaceIdentityGateway &
    Partial<WorkspaceIdentityDescriptorResolver>;
  const gatewayMatch = identityResolver.matchForPath?.(rootPath);
  const gatewayAdmittedDescriptor = gatewayMatch
    ? admitted.find((descriptor) => descriptor.workspaceId === gatewayMatch.descriptor.workspaceId)
    : null;
  if (gatewayAdmittedDescriptor) {
    return gatewayAdmittedDescriptor;
  }

  const mapped = identities[rootPath];
  if (mapped) {
    return mapped;
  }

  return (
    admitted.find(
      (descriptor) => workspaceRelativePathForDescriptor(descriptor, rootPath) === "",
    ) ?? null
  );
}

export function resolveAdmittedDocumentSaveOwnership(
  identities: Record<string, WorkspaceIdentityDescriptor>,
  identityGateway: WorkspaceIdentityGateway,
  rootPath: string,
  path: string,
): ReturnType<ResolveDocumentSaveOwnership> {
  const descriptor = admittedWorkspaceIdentityForRoot(identities, identityGateway, rootPath);
  return admittedDocumentSaveOwnership(descriptor, identityGateway, rootPath, path);
}

export function workspaceSettingsIdentity(
  canonicalKey: string,
  selectedRoot: string,
): WorkspaceSettingsIdentity {
  return {
    canonicalKey,
    legacyRawKeys: [...new Set([canonicalKey, selectedRoot])],
  };
}

export function removeWorkspaceIdentityMappings(
  identities: Record<string, WorkspaceIdentityDescriptor>,
  descriptor: WorkspaceIdentityDescriptor,
): void {
  for (const [root, registered] of Object.entries(identities)) {
    if (registered.workspaceId === descriptor.workspaceId) {
      delete identities[root];
    }
  }
}

export async function withWorkspaceIdentityLease(
  descriptor: WorkspaceIdentityDescriptor,
  unregister: (workspaceId: string) => Promise<void>,
  useLease: (adopt: () => void) => Promise<void>,
): Promise<void> {
  let adopted = false;
  try {
    await useLease(() => {
      adopted = true;
    });
  } finally {
    if (!adopted) {
      await unregister(descriptor.workspaceId);
    }
  }
}

export function adoptLegacyCachedWorkspaceState<
  T extends {
    workspaceIdentityDescriptor: WorkspaceIdentityDescriptor | null;
  },
>(identityDescriptor: WorkspaceIdentityDescriptor, candidates: ReadonlyArray<T | null>): T | null {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const cachedWorkspaceId = candidate.workspaceIdentityDescriptor?.workspaceId;
    if (cachedWorkspaceId && cachedWorkspaceId !== identityDescriptor.workspaceId) {
      continue;
    }

    candidate.workspaceIdentityDescriptor = identityDescriptor;
    return candidate;
  }

  return null;
}
