import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
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
});
