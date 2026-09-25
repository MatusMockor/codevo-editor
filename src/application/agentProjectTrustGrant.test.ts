import { describe, expect, it, vi } from "vitest";
import { confirmAndGrantAgentProjectTrust } from "./agentProjectTrustGrant";

function gateway(confirmed: boolean) {
  return {
    confirmGrant: vi.fn(async () => confirmed),
    setTrust: vi.fn(async (rootPath: string, trusted: boolean) => ({ rootPath, trusted })),
  };
}
const origin = { kind: "clone" as const, host: "github.com", path: "acme/web" };

describe("confirmAndGrantAgentProjectTrust", () => {
  it("grants through setTrust only after confirmation", async () => {
    const port = gateway(true);
    await expect(
      confirmAndGrantAgentProjectTrust({
        rootPath: "/code/web",
        label: "web",
        origin,
        gateway: port,
        isCurrent: () => true,
      }),
    ).resolves.toBe("granted");
    expect(port.confirmGrant).toHaveBeenCalledWith({ rootPath: "/code/web", label: "web", origin });
    expect(port.setTrust).toHaveBeenCalledExactlyOnceWith("/code/web", true);
  });

  it("does nothing when declined or when no confirmation capability exists", async () => {
    const declined = gateway(false);
    await expect(
      confirmAndGrantAgentProjectTrust({
        rootPath: "/a",
        label: "a",
        origin,
        gateway: declined,
        isCurrent: () => true,
      }),
    ).resolves.toBe("declined");
    expect(declined.setTrust).not.toHaveBeenCalled();
    const setTrust = vi.fn();
    await expect(
      confirmAndGrantAgentProjectTrust({
        rootPath: "/a",
        label: "a",
        origin,
        gateway: { setTrust },
        isCurrent: () => true,
      }),
    ).resolves.toBe("declined");
    expect(setTrust).not.toHaveBeenCalled();
  });

  it("does not grant when the project generation changed during the prompt", async () => {
    let current = true;
    const port = {
      confirmGrant: vi.fn(async () => {
        current = false;
        return true;
      }),
      setTrust: vi.fn(),
    };
    await expect(
      confirmAndGrantAgentProjectTrust({
        rootPath: "/a",
        label: "a",
        origin,
        gateway: port,
        isCurrent: () => current,
      }),
    ).resolves.toBe("stale");
    expect(port.setTrust).not.toHaveBeenCalled();
  });

  it("reports stale when the owner changes while the grant is in flight", async () => {
    let current = true;
    const port = {
      confirmGrant: vi.fn(async () => true),
      setTrust: vi.fn(async (rootPath: string) => {
        current = false;
        return { rootPath, trusted: true };
      }),
    };
    await expect(
      confirmAndGrantAgentProjectTrust({
        rootPath: "/a",
        label: "a",
        origin,
        gateway: port,
        isCurrent: () => current,
      }),
    ).resolves.toBe("stale");
  });

  it("reports refused, not declined, when the backend kept the project untrusted", async () => {
    const port = {
      confirmGrant: vi.fn(async () => true),
      setTrust: vi.fn(async (rootPath: string) => ({ rootPath, trusted: false })),
    };
    await expect(
      confirmAndGrantAgentProjectTrust({
        rootPath: "/a",
        label: "a",
        origin,
        gateway: port,
        isCurrent: () => true,
      }),
    ).resolves.toBe("refused");
  });
});
