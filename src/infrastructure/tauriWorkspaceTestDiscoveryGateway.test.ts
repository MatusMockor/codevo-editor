import { describe, expect, it, vi } from "vitest";
import type { WorkspaceIdentityDescriptorResolver } from "./tauriWorkspaceIdentityGateway";
import { TauriWorkspaceTestDiscoveryGateway } from "./tauriWorkspaceTestDiscoveryGateway";
import type { InvokeWorkspaceTestDiscoveryCommand } from "./tauriWorkspaceTestDiscoveryIpcContract";

const ROOT = "/workspace/project";

function identities(): WorkspaceIdentityDescriptorResolver {
  return {
    descriptorForPath: () => null,
    matchForPath: (path) => path === ROOT ? {
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
    } : null,
  };
}

describe("TauriWorkspaceTestDiscoveryGateway", () => {
  it("scopes enumeration and reads to the opened workspace id", async () => {
    const invokeCommand = vi.fn<InvokeWorkspaceTestDiscoveryCommand>()
      .mockResolvedValueOnce({ files: [], truncated: false, visited: 1 })
      .mockResolvedValueOnce({ status: "ok", content: "test('x', () => {})" });
    const gateway = new TauriWorkspaceTestDiscoveryGateway(identities(), invokeCommand);
    await gateway.enumerateJsTestFiles(ROOT, { maxFiles: 100, maxVisited: 1000 });
    await gateway.readTextFileBounded(ROOT, "src/a.test.ts", 4096);
    expect(invokeCommand).toHaveBeenNthCalledWith(1, "workspace_enumerate_js_test_files", {
      workspaceId: "ws-1", maxFiles: 100, maxVisited: 1000,
    });
    expect(invokeCommand).toHaveBeenNthCalledWith(2, "workspace_read_text_file_bounded", {
      workspaceId: "ws-1", relativePath: "src/a.test.ts", maxBytes: 4096,
    });
  });

  it("rejects unopened or nested roots before IPC", async () => {
    const invokeCommand = vi.fn<InvokeWorkspaceTestDiscoveryCommand>();
    const gateway = new TauriWorkspaceTestDiscoveryGateway(identities(), invokeCommand);
    expect(() =>
      gateway.enumerateJsTestFiles("/other", { maxFiles: 1, maxVisited: 1 }),
    ).toThrow("opened native workspace root");
    expect(invokeCommand).not.toHaveBeenCalled();
  });
});
