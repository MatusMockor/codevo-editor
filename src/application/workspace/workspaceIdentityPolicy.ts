import type { WorkspaceSettingsIdentity } from "../../domain/settings";
import type { WorkspaceIdentityDescriptor } from "../workspaceIdentityGatewayPort";

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
  release: (descriptor: WorkspaceIdentityDescriptor) => Promise<void>,
  useLease: (adopt: () => void) => Promise<void>,
): Promise<void> {
  let adopted = false;
  try {
    await useLease(() => {
      adopted = true;
    });
  } finally {
    if (!adopted) {
      await release(descriptor);
    }
  }
}
