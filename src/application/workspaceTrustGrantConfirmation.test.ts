import { describe, expect, it, vi } from "vitest";
import {
  confirmWorkspaceTrustGrant,
  workspaceTrustChangeMessage,
} from "./workspaceTrustGrantConfirmation";

describe("confirmWorkspaceTrustGrant", () => {
  it("passes through gateways without a confirmation capability", async () => {
    await expect(confirmWorkspaceTrustGrant({}, "/a", () => true)).resolves.toBe(true);
  });

  it("asks with the project label and a local origin", async () => {
    const confirmGrant = vi.fn(async () => true);
    await expect(
      confirmWorkspaceTrustGrant({ confirmGrant }, "/Users/dev/app/", () => true),
    ).resolves.toBe(true);
    expect(confirmGrant).toHaveBeenCalledWith({
      rootPath: "/Users/dev/app/",
      label: "app",
      origin: { kind: "local" },
    });
  });

  it("ignores a confirmation after the workspace changed", async () => {
    let current = true;
    const confirmGrant = vi.fn(async () => {
      current = false;
      return true;
    });
    await expect(confirmWorkspaceTrustGrant({ confirmGrant }, "/a", () => current)).resolves.toBe(
      false,
    );
  });

  it("ignores a confirmation for A after switching A -> B -> A during the prompt", async () => {
    let revision = 1;
    let activeRoot = "/a";
    const captured = revision;
    const confirmGrant = vi.fn(async () => {
      activeRoot = "/b";
      revision += 1;
      activeRoot = "/a";
      revision += 1;
      return true;
    });
    await expect(
      confirmWorkspaceTrustGrant(
        { confirmGrant },
        "/a",
        () => revision === captured && activeRoot === "/a",
      ),
    ).resolves.toBe(false);
  });

  it("returns false when declined", async () => {
    await expect(
      confirmWorkspaceTrustGrant({ confirmGrant: async () => false }, "/a", () => true),
    ).resolves.toBe(false);
  });
});

describe("workspaceTrustChangeMessage", () => {
  it("reports a grant, a revocation and a refused grant truthfully", () => {
    expect(workspaceTrustChangeMessage(true, { rootPath: "/a", trusted: true })).toBe(
      "Workspace trusted.",
    );
    expect(workspaceTrustChangeMessage(false, { rootPath: "/a", trusted: false })).toBe(
      "Workspace trust revoked.",
    );
    expect(workspaceTrustChangeMessage(true, { rootPath: "/a", trusted: false })).toBe(
      "Trust was refused.",
    );
  });
});
