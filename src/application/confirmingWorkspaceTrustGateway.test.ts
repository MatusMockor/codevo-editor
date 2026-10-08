import { describe, expect, it, vi } from "vitest";
import type { WorkspaceTrustGateway } from "../domain/trust";
import { ConfirmingWorkspaceTrustGateway } from "./confirmingWorkspaceTrustGateway";

describe("ConfirmingWorkspaceTrustGateway", () => {
  it("delegates trust IO unchanged and maps the dialog decision", async () => {
    const inner: WorkspaceTrustGateway = {
      getTrust: vi.fn(async (rootPath: string) => ({ rootPath, trusted: false })),
      setTrust: vi.fn(async (rootPath: string, trusted: boolean) => ({ rootPath, trusted })),
      grantOpenedProject: vi.fn(async (identity) => ({
        rootPath: identity.canonicalRoot,
        trusted: true,
      })),
      revokeOpenedProject: vi.fn(async (identity) => ({
        rootPath: identity.canonicalRoot,
        trusted: false,
      })),
    };
    const prompt = {
      request: vi.fn().mockResolvedValueOnce("trust").mockResolvedValueOnce("notNow"),
    };
    const gateway = new ConfirmingWorkspaceTrustGateway(inner, prompt);
    const confirmation = { rootPath: "/a", label: "a", origin: { kind: "local" as const } };
    await expect(gateway.confirmGrant(confirmation)).resolves.toBe(true);
    await expect(gateway.confirmGrant(confirmation)).resolves.toBe(false);
    await expect(gateway.setTrust("/a", true)).resolves.toEqual({ rootPath: "/a", trusted: true });
    await expect(gateway.getTrust("/a")).resolves.toEqual({ rootPath: "/a", trusted: false });
    await gateway.grantOpenedProject?.({
      workspaceId: "w",
      admissionToken: 1,
      selectedPath: "/a",
      canonicalRoot: "/a",
    });
    const revocation = { workspaceId: "w", admissionToken: 1, canonicalRoot: "/a" };
    await expect(gateway.revokeOpenedProject?.(revocation)).resolves.toEqual({
      rootPath: "/a",
      trusted: false,
    });
    expect(inner.revokeOpenedProject).toHaveBeenCalledExactlyOnceWith(revocation);
    expect(inner.grantOpenedProject).toHaveBeenCalledTimes(1);
    expect(inner.setTrust).toHaveBeenCalledTimes(1);
    expect(prompt.request).toHaveBeenCalledTimes(2);
  });

  it("does not invent opened project operations the inner gateway lacks", () => {
    const gateway = new ConfirmingWorkspaceTrustGateway(
      { getTrust: vi.fn(), setTrust: vi.fn() },
      { request: vi.fn() },
    );
    expect(gateway.grantOpenedProject).toBeUndefined();
    expect(gateway.revokeOpenedProject).toBeUndefined();
  });
});
