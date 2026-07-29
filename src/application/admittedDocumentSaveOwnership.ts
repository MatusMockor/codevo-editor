import type {
  WorkspaceIdentityDescriptor,
  WorkspaceIdentityDescriptorResolver,
  WorkspaceIdentityGateway,
} from "./workspaceIdentityGatewayPort";
import { workspaceRelativePathForDescriptor } from "./workspaceIdentityPath";
import {
  createRegisteredDocumentSaveIdentity,
  legacyDocumentSaveOwnership,
  type ResolveDocumentSaveOwnership,
} from "./documentSaveIdentity";

/** Converts one already-admitted descriptor into immutable save ownership. */
export function admittedDocumentSaveOwnership(
  descriptor: WorkspaceIdentityDescriptor | null,
  identityGateway: WorkspaceIdentityGateway,
  rootPath: string,
  path: string,
): ReturnType<ResolveDocumentSaveOwnership> {
  if (!descriptor) {
    return legacyDocumentSaveOwnership(rootPath, path);
  }

  const identityResolver = identityGateway as WorkspaceIdentityGateway &
    Partial<WorkspaceIdentityDescriptorResolver>;
  const match = identityResolver.matchForPath?.(path, descriptor.workspaceId);
  const relativePath =
    match?.descriptor.workspaceId === descriptor.workspaceId
      ? match.relativePath
      : workspaceRelativePathForDescriptor(descriptor, path);
  if (!relativePath) {
    return null;
  }

  return createRegisteredDocumentSaveIdentity(
    descriptor.workspaceId,
    descriptor.canonicalRoot,
    relativePath,
    descriptor.policy,
  );
}
