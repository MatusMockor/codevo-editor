import { describe, expect, it, vi } from "vitest";
import type { WorkspaceIdentityDescriptor } from "./workspaceIdentityGatewayPort";
import { resolveAdmittedDocumentSaveOwnership } from "./useWorkbenchController";

describe("resolveAdmittedDocumentSaveOwnership", () => {
  it("resolves registered ownership from an admitted remembered alias", () => {
    const descriptor = trustedDescriptor("ws-save-alias", "/selected/workspace", "/real/workspace");
    const rememberedRoot = "/remembered/workspace";
    const rememberedPath = `${rememberedRoot}/src/User.php`;
    const matchForPath = vi.fn((path: string, workspaceId?: string) => {
      if (workspaceId && workspaceId !== descriptor.workspaceId) return null;
      if (path === rememberedRoot) {
        return { descriptor, matchedRoot: rememberedRoot, relativePath: "" };
      }
      return path === rememberedPath
        ? {
            descriptor,
            matchedRoot: rememberedRoot,
            relativePath: "src/User.php",
          }
        : null;
    });
    const identityGateway = gateway(matchForPath);

    expect(
      resolveAdmittedDocumentSaveOwnership(
        { [descriptor.canonicalRoot]: descriptor },
        identityGateway,
        rememberedRoot,
        rememberedPath,
      ),
    ).toEqual({
      canonicalRoot: descriptor.canonicalRoot,
      workspaceId: descriptor.workspaceId,
      workspaceRelativePath: "src/User.php",
    });
    expect(matchForPath).toHaveBeenNthCalledWith(1, rememberedRoot);
    expect(matchForPath).toHaveBeenNthCalledWith(2, rememberedPath, descriptor.workspaceId);
  });

  it("uses the admitted descriptor and rejects paths outside it", () => {
    const descriptor = trustedDescriptor("ws-save-map", "/selected/workspace", "/real/workspace");
    const identities = { [descriptor.selectedPath]: descriptor };
    const identityGateway = gateway();

    expect(
      resolveAdmittedDocumentSaveOwnership(
        identities,
        identityGateway,
        descriptor.selectedPath,
        `${descriptor.selectedPath}/src/User.php`,
      ),
    ).toEqual({
      canonicalRoot: descriptor.canonicalRoot,
      workspaceId: descriptor.workspaceId,
      workspaceRelativePath: "src/User.php",
    });
    expect(
      resolveAdmittedDocumentSaveOwnership(
        identities,
        identityGateway,
        descriptor.selectedPath,
        "/outside/User.php",
      ),
    ).toBeNull();
  });
});

function gateway(matchForPath?: ReturnType<typeof vi.fn>) {
  return {
    getDescriptor: vi.fn(),
    matchForPath,
    openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
    unregister: vi.fn(async () => undefined),
  };
}

function trustedDescriptor(
  workspaceId: string,
  selectedPath: string,
  canonicalRoot: string,
): WorkspaceIdentityDescriptor {
  return {
    canonicalRoot,
    caseSensitive: true,
    policy: { caseSensitive: true, unicodeNormalization: "none" },
    selectedPath,
    unicodeNormalizationPolicy: "preserved",
    workspaceId,
  };
}
