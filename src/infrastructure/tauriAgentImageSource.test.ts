import { beforeEach, describe, expect, it, vi } from "vitest";
import contract from "../../contracts/agent-image-source-errors.json";
import {
  AgentAttachmentFolderSourceError,
  MAX_AGENT_IMAGE_SOURCE_BYTES,
} from "../domain/agentAttachmentIntake";
import {
  AGENT_IMAGE_SOURCE_DIRECTORY_ERROR,
  readAgentAttachmentImagePath,
} from "./tauriAgentImageSource";
const { invoke, isTauri } = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri }));
beforeEach(() => {
  vi.clearAllMocks();
  isTauri.mockReturnValue(true);
});
describe("explicit native image sources", () => {
  it("uses a closed source request without requiring local workspace authority", async () => {
    const bytes = new ArrayBuffer(8);
    invoke.mockResolvedValue(bytes);
    expect(await readAgentAttachmentImagePath("/tmp/shot.png")).toBe(bytes);
    expect(invoke).toHaveBeenCalledWith("read_agent_attachment_image_source", {
      request: { path: "/tmp/shot.png" },
    });
  });
  it.each(["relative.png", "/tmp/\0.png", `/${"x".repeat(4096)}.png`])(
    "refuses invalid path %s before IPC",
    async (path) => {
      await expect(readAgentAttachmentImagePath(path)).rejects.toThrow("absolute");
      expect(invoke).not.toHaveBeenCalled();
    },
  );
  it("refuses missing native runtime", async () => {
    isTauri.mockReturnValue(false);
    await expect(readAgentAttachmentImagePath("/tmp/a.png")).rejects.toThrow("native");
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each([null, [1, 2], new ArrayBuffer(0), new ArrayBuffer(MAX_AGENT_IMAGE_SOURCE_BYTES + 1)])(
    "refuses invalid byte response",
    async (value) => {
      invoke.mockResolvedValue(value);
      await expect(readAgentAttachmentImagePath("/tmp/a.png")).rejects.toThrow("safely");
    },
  );
  it("preserves the string refusal returned by Tauri", async () => {
    invoke.mockRejectedValue("The selected image exceeds 50 MiB.");
    await expect(readAgentAttachmentImagePath("/tmp/a.png")).rejects.toThrow("exceeds 50 MiB");
  });
  it.each(["", "x".repeat(513), "bad\nmessage", { message: "untrusted" }])(
    "bounds malformed native errors",
    async (error) => {
      invoke.mockRejectedValue(error);
      await expect(readAgentAttachmentImagePath("/tmp/a.png")).rejects.toThrow("safely");
    },
  );
  it("maps the native directory refusal to the closed folder error", async () => {
    expect(AGENT_IMAGE_SOURCE_DIRECTORY_ERROR).toBe(contract.directorySource);
    for (const refusal of [contract.directorySource, new Error(contract.directorySource)]) {
      invoke.mockRejectedValue(refusal);
      await expect(readAgentAttachmentImagePath("/tmp/invoices")).rejects.toBeInstanceOf(
        AgentAttachmentFolderSourceError,
      );
    }
  });
  it("keeps every other native refusal an ordinary error", async () => {
    invoke.mockRejectedValue("Choose a regular image file, not a folder or symbolic link.");
    const failure = await readAgentAttachmentImagePath("/tmp/link.png").catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(AgentAttachmentFolderSourceError);
  });
  it("preserves native refusal", async () => {
    invoke.mockRejectedValue(new Error("The file does not contain the selected image format."));
    await expect(readAgentAttachmentImagePath("/tmp/a.png")).rejects.toThrow("format");
  });
});
