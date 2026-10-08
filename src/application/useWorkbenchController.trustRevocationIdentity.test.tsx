// @vitest-environment jsdom

import contract from "../../contracts/workspace-trust-errors.json";
import {
  act,
  defaultAppSettings,
  describe,
  expect,
  flushAsyncTurns,
  it,
  setupRegisteredWorkbenchControllerTestHarness,
  vi,
  type WorkspaceTrustGateway,
} from "./useWorkbenchController.preview/testSupport";

const IDENTITY_REJECTION = contract.openedProjectIdentityReplaced;

describe("useWorkbenchController trust revocation identity", () => {
  const { renderController } = setupRegisteredWorkbenchControllerTestHarness();

  function openTrustedWorkspace(
    revokeOpenedProject: NonNullable<WorkspaceTrustGateway["revokeOpenedProject"]>,
  ) {
    const workspaceTrustGateway = {
      getTrust: vi.fn(async (rootPath: string) => ({ rootPath, trusted: true })),
      setTrust: vi.fn(async (rootPath: string, trusted: boolean) => ({ rootPath, trusted })),
      revokeOpenedProject: vi.fn(revokeOpenedProject),
    } satisfies WorkspaceTrustGateway;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a"],
      },
      workspaceTrustGateway,
    });
    return { getWorkbench, workspaceTrustGateway };
  }

  it("revokes the open project through the identity its tab holds, not its path", async () => {
    const { getWorkbench, workspaceTrustGateway } = openTrustedWorkspace(async (identity) => ({
      rootPath: identity.canonicalRoot,
      trusted: false,
    }));
    await flushAsyncTurns();
    expect(getWorkbench().workspaceTrust).toEqual({ rootPath: "/workspace-a", trusted: true });

    await act(async () => {
      await getWorkbench().toggleWorkspaceTrust();
    });

    expect(workspaceTrustGateway.revokeOpenedProject).toHaveBeenCalledExactlyOnceWith({
      workspaceId: "workspace-a",
      admissionToken: 1,
      canonicalRoot: "/workspace-a",
    });
    expect(workspaceTrustGateway.setTrust).not.toHaveBeenCalled();
    expect(getWorkbench().workspaceTrust).toEqual({ rootPath: "/workspace-a", trusted: false });
  });

  it("keeps the project trusted and says why when its identity is rejected", async () => {
    const { getWorkbench, workspaceTrustGateway } = openTrustedWorkspace(async () => {
      throw new Error(IDENTITY_REJECTION);
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().toggleWorkspaceTrust();
    });
    await flushAsyncTurns();

    expect(workspaceTrustGateway.revokeOpenedProject).toHaveBeenCalledTimes(1);
    expect(workspaceTrustGateway.setTrust).not.toHaveBeenCalled();
    expect(getWorkbench().workspaceTrust).toEqual({ rootPath: "/workspace-a", trusted: true });
    expect(getWorkbench().notices.filter((notice) => notice.source === "Workspace Trust")).toEqual([
      expect.objectContaining({ message: expect.stringContaining(IDENTITY_REJECTION) }),
    ]);
  });
});
