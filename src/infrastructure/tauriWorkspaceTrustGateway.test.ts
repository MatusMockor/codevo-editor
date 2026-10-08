import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import contract from "../../contracts/workspace-trust-errors.json";
import { AgentOpenedProjectAdmission } from "../application/agentOpenedProjectAdmission";
import type { WorkspaceIdentityDescriptor } from "../application/workspaceIdentityGatewayPort";
import { TauriWorkspaceTrustGateway } from "./tauriWorkspaceTrustGateway";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const identity = {
  workspaceId: "ws-a",
  admissionToken: 4,
  selectedPath: "/alias",
  canonicalRoot: "/real",
};

beforeEach(() => vi.mocked(invoke).mockReset());

describe("opened project trust admission", () => {
  it("keeps the captured root authority when the caller mutates its descriptor", async () => {
    const mutableIdentity = { ...identity };
    vi.mocked(invoke).mockImplementation(async () => {
      mutableIdentity.canonicalRoot = "/other";
      return { rootPath: "/other", trusted: true };
    });
    await expect(
      new TauriWorkspaceTrustGateway().grantOpenedProject(mutableIdentity),
    ).rejects.toThrow();
  });

  it("sends the exact descriptor admission and accepts its matching result", async () => {
    vi.mocked(invoke).mockResolvedValue({ rootPath: "/real", trusted: true });
    await expect(new TauriWorkspaceTrustGateway().grantOpenedProject(identity)).resolves.toEqual({
      rootPath: "/real",
      trusted: true,
    });
    expect(invoke).toHaveBeenCalledWith("grant_opened_project_trust", {
      target: {
        workspaceId: "ws-a",
        admissionToken: 4,
        selectedRootPath: "/alias",
        canonicalRootPath: "/real",
      },
    });
  });

  it.each([undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid admission %s before IPC",
    async (admissionToken) => {
      await expect(
        new TauriWorkspaceTrustGateway().grantOpenedProject({ ...identity, admissionToken }),
      ).rejects.toThrow();
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it.each(["relative", "/bad\u0000", "/" + "é".repeat(4096)])(
    "rejects invalid roots before IPC",
    async (canonicalRoot) => {
      await expect(
        new TauriWorkspaceTrustGateway().grantOpenedProject({ ...identity, canonicalRoot }),
      ).rejects.toThrow();
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    { rootPath: "/other", trusted: true },
    { rootPath: "/real", trusted: false },
    { rootPath: "/real", trusted: true, extra: 1 },
  ])("rejects mismatched or malformed response %j", async (result) => {
    vi.mocked(invoke).mockResolvedValue(result);
    await expect(new TauriWorkspaceTrustGateway().grantOpenedProject(identity)).rejects.toThrow();
  });

  it("keeps a clone-origin root refused by the backend untrusted instead of auto-admitting it", async () => {
    vi.mocked(invoke)
      .mockRejectedValueOnce(contract.revokedRefusal)
      .mockRejectedValueOnce(contract.revokedRefusal);
    const gateway = new TauriWorkspaceTrustGateway();
    const descriptor: WorkspaceIdentityDescriptor = {
      ...identity,
      caseSensitive: true,
      unicodeNormalizationPolicy: "preserved",
      policy: { caseSensitive: true, unicodeNormalization: "none" },
    };

    await expect(
      new AgentOpenedProjectAdmission().authorize(
        descriptor,
        { rootPath: "/real", trusted: false },
        gateway,
        () => true,
      ),
    ).resolves.toBeNull();
    await expect(gateway.grantOpenedProject(identity)).rejects.toBe(contract.revokedRefusal);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenCalledWith("grant_opened_project_trust", {
      target: {
        workspaceId: "ws-a",
        admissionToken: 4,
        selectedRootPath: "/alias",
        canonicalRootPath: "/real",
      },
    });
  });
});

describe("opened project trust revocation", () => {
  const revocation = { workspaceId: "ws-a", admissionToken: 4, canonicalRoot: "/real" };

  it("sends the pinned identity contract and accepts its matching result", async () => {
    vi.mocked(invoke).mockResolvedValue({ rootPath: "/real", trusted: false });

    await expect(new TauriWorkspaceTrustGateway().revokeOpenedProject(revocation)).resolves.toEqual(
      { rootPath: "/real", trusted: false },
    );

    expect(invoke).toHaveBeenCalledExactlyOnceWith("revoke_opened_project_trust", {
      target: contract.openedProjectRevocationTarget,
    });
  });

  it("sends only the closed identity fields of a wider descriptor", async () => {
    vi.mocked(invoke).mockResolvedValue({ rootPath: "/real", trusted: false });

    await new TauriWorkspaceTrustGateway().revokeOpenedProject({ ...identity, admissionToken: 4 });

    expect(invoke).toHaveBeenCalledExactlyOnceWith("revoke_opened_project_trust", {
      target: contract.openedProjectRevocationTarget,
    });
  });

  it.each([
    { ...revocation, admissionToken: 0 },
    { ...revocation, admissionToken: 1.5 },
    { ...revocation, admissionToken: Number.MAX_SAFE_INTEGER + 1 },
    { ...revocation, workspaceId: "" },
    { ...revocation, canonicalRoot: "relative" },
    { ...revocation, canonicalRoot: "/bad\u0000" },
    { ...revocation, canonicalRoot: "/" + "é".repeat(4096) },
  ])("rejects an invalid identity before IPC: %j", async (invalid) => {
    await expect(new TauriWorkspaceTrustGateway().revokeOpenedProject(invalid)).rejects.toThrow(
      "Invalid opened project identity.",
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    { rootPath: "/other", trusted: false },
    { rootPath: "/real", trusted: true },
    { rootPath: "/real", trusted: false, workspaceId: "ws-a" },
    null,
  ])("rejects a response that does not describe the revoked project: %j", async (response) => {
    vi.mocked(invoke).mockResolvedValue(response);

    await expect(new TauriWorkspaceTrustGateway().revokeOpenedProject(revocation)).rejects.toThrow(
      "Opened project trust response does not match its identity.",
    );
  });

  it("reports the backend refusal of a replaced identity unchanged", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(contract.openedProjectIdentityReplaced);

    await expect(new TauriWorkspaceTrustGateway().revokeOpenedProject(revocation)).rejects.toBe(
      contract.openedProjectIdentityReplaced,
    );
  });
});
