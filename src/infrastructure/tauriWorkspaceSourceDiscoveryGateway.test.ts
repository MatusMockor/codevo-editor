import { describe, expect, it, vi } from "vitest";
import type { NpmOpenScriptGatewayOwner } from "../application/useNpmOpenScriptNavigation";
import type { WorkspaceIdentityDescriptorResolver } from "./tauriWorkspaceIdentityGateway";
import { TauriWorkspaceSourceDiscoveryGateway } from "./tauriWorkspaceSourceDiscoveryGateway";
import type { InvokeWorkspaceSourceDiscoveryCommand } from "./tauriWorkspaceSourceDiscoveryIpcContract";

const ROOT = "/workspace/project";

function identities(): WorkspaceIdentityDescriptorResolver {
  return {
    descriptorForPath: () => null,
    matchForPath: (path) =>
      path === ROOT
        ? {
            descriptor: {
              workspaceId: "ws-1",
              selectedPath: ROOT,
              canonicalRoot: ROOT,
              caseSensitive: true,
              unicodeNormalizationPolicy: "preserved",
              policy: { caseSensitive: true, unicodeNormalization: "none" },
            },
            matchedRoot: ROOT,
            relativePath: "",
          }
        : null,
  };
}

describe("TauriWorkspaceSourceDiscoveryGateway", () => {
  it("scopes source enumeration and bounded reads to the opened workspace id", async () => {
    const invokeCommand = vi
      .fn<InvokeWorkspaceSourceDiscoveryCommand>()
      .mockResolvedValueOnce({ files: ["src/a.ts"], truncated: false, visited: 4 })
      .mockResolvedValueOnce({
        files: ["package.json", "apps/api/package.json"],
        truncated: false,
        visited: 8,
      })
      .mockResolvedValueOnce({ status: "notFound" });
    const gateway = new TauriWorkspaceSourceDiscoveryGateway(identities(), invokeCommand);

    await gateway.enumerateJavaScriptSourceFiles(ROOT, { maxFiles: 2_000, maxVisited: 50_000 });
    await gateway.enumeratePackageJsonFiles(ROOT, { maxFiles: 256, maxVisited: 50_000 });
    await expect(gateway.readSourceTextBounded(ROOT, "src/a.ts", 2_097_152)).resolves.toEqual({
      status: "notFound",
    });

    expect(invokeCommand).toHaveBeenNthCalledWith(1, "workspace_enumerate_js_source_files", {
      workspaceId: "ws-1",
      maxFiles: 2_000,
      maxVisited: 50_000,
    });
    expect(invokeCommand).toHaveBeenNthCalledWith(2, "workspace_enumerate_package_json_files", {
      workspaceId: "ws-1",
      maxFiles: 256,
      maxVisited: 50_000,
    });
    expect(invokeCommand).toHaveBeenNthCalledWith(3, "workspace_read_source_text_bounded", {
      workspaceId: "ws-1",
      relativePath: "src/a.ts",
      maxBytes: 2_097_152,
    });
  });

  it("rejects unopened and nested roots before IPC", () => {
    const invokeCommand = vi.fn<InvokeWorkspaceSourceDiscoveryCommand>();
    const gateway = new TauriWorkspaceSourceDiscoveryGateway(identities(), invokeCommand);
    expect(() =>
      gateway.enumerateJavaScriptSourceFiles("/other", { maxFiles: 1, maxVisited: 1 }),
    ).toThrow("opened native workspace root");
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("binds npm manifest reads to the exact workspace owner and watcher version", async () => {
    const invokeCommand = vi
      .fn<InvokeWorkspaceSourceDiscoveryCommand>()
      .mockResolvedValue({ status: "ok", content: '{"scripts":{"test":"vitest"}}' });
    let owner: NpmOpenScriptGatewayOwner | null = npmOwner();
    const gateway = new TauriWorkspaceSourceDiscoveryGateway(identities(), invokeCommand);
    const reader = gateway.bindNpmOpenScriptNavigation(() => owner);

    const result = await reader.readManifestBounded(npmRequest());

    expect(invokeCommand).toHaveBeenCalledWith("workspace_read_source_text_bounded", {
      workspaceId: "ws-1",
      relativePath: "package.json",
      maxBytes: 256_000,
    });
    expect(result).toMatchObject({ status: "ok" });
    if (result.status !== "ok") throw new Error("expected an owner-bound lease");
    expect(result.revision).toContain('"ws-1"');
    expect(result.isCurrent()).toBe(true);

    owner = npmOwner({ nodePackageScriptDiscoveryVersion: 8 });
    expect(result.isCurrent()).toBe(false);
  });

  it("maps a missing workspace source to the npm manifest missing status", async () => {
    const invokeCommand = vi
      .fn<InvokeWorkspaceSourceDiscoveryCommand>()
      .mockResolvedValue({ status: "notFound" });
    const reader = new TauriWorkspaceSourceDiscoveryGateway(
      identities(),
      invokeCommand,
    ).bindNpmOpenScriptNavigation(() => npmOwner());

    await expect(reader.readManifestBounded(npmRequest())).resolves.toEqual({
      status: "missing",
    });
  });

  it("rejects an in-flight A to B to A return even when the visible path returns", async () => {
    let resolveRead: ((value: unknown) => void) | undefined;
    const invokeCommand = vi.fn<InvokeWorkspaceSourceDiscoveryCommand>().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );
    let owner: NpmOpenScriptGatewayOwner | null = npmOwner({ activationEpoch: 1 });
    const reader = new TauriWorkspaceSourceDiscoveryGateway(
      identities(),
      invokeCommand,
    ).bindNpmOpenScriptNavigation(() => owner);

    const pending = reader.readManifestBounded(npmRequest({ activationEpoch: 1 }));
    await vi.waitFor(() => expect(resolveRead).toBeTypeOf("function"));
    owner = npmOwner({
      activationEpoch: 2,
      ownerKey: "owner-b",
      rootPath: "/workspace/b",
    });
    owner = npmOwner({ activationEpoch: 3 });
    resolveRead?.({ status: "ok", content: "{}" });

    await expect(pending).resolves.toEqual({ status: "changed" });
  });

  it("fails closed without an owner port and never invokes Tauri", async () => {
    const invokeCommand = vi.fn<InvokeWorkspaceSourceDiscoveryCommand>();
    const reader = new TauriWorkspaceSourceDiscoveryGateway(
      identities(),
      invokeCommand,
    ).bindNpmOpenScriptNavigation(null);

    await expect(reader.readManifestBounded(npmRequest())).resolves.toEqual({
      status: "changed",
    });
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("rejects a path match that substitutes a different workspace id", async () => {
    const invokeCommand = vi.fn<InvokeWorkspaceSourceDiscoveryCommand>();
    const wrongIdentities: WorkspaceIdentityDescriptorResolver = {
      descriptorForPath: () => null,
      matchForPath: (path) => ({
        descriptor: {
          workspaceId: "ws-substitute",
          selectedPath: path,
          canonicalRoot: path,
          caseSensitive: true,
          unicodeNormalizationPolicy: "preserved",
          policy: { caseSensitive: true, unicodeNormalization: "none" },
        },
        matchedRoot: path,
        relativePath: "",
      }),
    };
    const reader = new TauriWorkspaceSourceDiscoveryGateway(
      wrongIdentities,
      invokeCommand,
    ).bindNpmOpenScriptNavigation(() => npmOwner());

    await expect(reader.readManifestBounded(npmRequest())).resolves.toEqual({
      status: "changed",
    });
    expect(invokeCommand).not.toHaveBeenCalled();
  });
});

function npmOwner(overrides: Partial<NpmOpenScriptGatewayOwner> = {}): NpmOpenScriptGatewayOwner {
  return {
    activationEpoch: 1,
    nodePackageScriptDiscoveryVersion: 7,
    ownerKey: "owner-a",
    rootPath: ROOT,
    workspaceId: "ws-1",
    ...overrides,
  };
}

function npmRequest(
  overrides: Partial<
    Parameters<
      ReturnType<
        TauriWorkspaceSourceDiscoveryGateway["bindNpmOpenScriptNavigation"]
      >["readManifestBounded"]
    >[0]
  > = {},
) {
  return {
    activationEpoch: 1,
    manifestRelativePath: "package.json",
    maxBytes: 256_000,
    ownerKey: "owner-a",
    rootPath: ROOT,
    workspaceId: "ws-1",
    ...overrides,
  };
}
