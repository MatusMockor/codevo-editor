import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentAttachmentFolderSourceError } from "../domain/agentAttachmentIntake";
import {
  MAX_REMOTE_FILE_ATTACHMENT_BYTES,
  REMOTE_FILE_SOURCE_EMPTY_ERROR,
  REMOTE_FILE_SOURCE_PATH_ERROR,
  REMOTE_FILE_SOURCE_SPECIAL_ERROR,
  REMOTE_FILE_SOURCE_UNREADABLE_ERROR,
} from "../domain/remoteRunnerFileAttachment";
import {
  releaseAgentAttachmentFileSource,
  stageAgentAttachmentFileSource,
  tauriAgentFileSource,
} from "./tauriAgentFileSource";

const { invoke, isTauri } = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri }));

const sourceId = "12345678-1234-4234-8234-123456789abc";
const staged = { sourceId, name: "report.pdf", bytes: 2048 };

beforeEach(() => {
  vi.clearAllMocks();
  isTauri.mockReturnValue(true);
});

describe("native attachment file sources", () => {
  it("stages an explicit path through the closed command and returns no content", async () => {
    invoke.mockResolvedValue(staged);
    expect(await tauriAgentFileSource.stage("/Users/dev/report.pdf")).toEqual(staged);
    expect(invoke.mock.calls).toEqual([
      ["stage_agent_attachment_file_source", { request: { path: "/Users/dev/report.pdf" } }],
    ]);
  });

  it.each(["relative.pdf", "", "/tmp/\0.pdf", "/tmp/a\n.pdf", `/${"x".repeat(4096)}.pdf`])(
    "refuses the invalid path %j before IPC",
    async (path) => {
      await expect(stageAgentAttachmentFileSource(path)).rejects.toThrow(
        REMOTE_FILE_SOURCE_PATH_ERROR,
      );
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it("refuses a missing native runtime", async () => {
    isTauri.mockReturnValue(false);
    await expect(stageAgentAttachmentFileSource("/tmp/a.pdf")).rejects.toThrow("native");
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    null,
    "staged",
    [staged],
    { ...staged, path: "/Users/dev/report.pdf" },
    { ...staged, sourceId: "/Users/dev/report.pdf" },
    { ...staged, sourceId: undefined },
    { ...staged, name: "" },
    { ...staged, name: "a\0b" },
    { ...staged, name: 7 },
    { ...staged, bytes: 0 },
    { ...staged, bytes: MAX_REMOTE_FILE_ATTACHMENT_BYTES + 1 },
    { ...staged, bytes: 1.5 },
    { ...staged, bytes: "2048" },
    new ArrayBuffer(8),
  ])("refuses the invalid staging response %j", async (value) => {
    invoke.mockResolvedValue(value);
    await expect(stageAgentAttachmentFileSource("/tmp/a.pdf")).rejects.toThrow(
      REMOTE_FILE_SOURCE_UNREADABLE_ERROR,
    );
  });

  it("accepts a file of exactly 50 MiB", async () => {
    invoke.mockResolvedValue({ ...staged, bytes: MAX_REMOTE_FILE_ATTACHMENT_BYTES });
    await expect(stageAgentAttachmentFileSource("/tmp/a.bin")).resolves.toMatchObject({
      bytes: MAX_REMOTE_FILE_ATTACHMENT_BYTES,
    });
  });

  it("presents a native folder refusal as the closed folder error", async () => {
    invoke.mockRejectedValue("Choose a file, not a folder.");
    await expect(stageAgentAttachmentFileSource("/Users/dev/folder")).rejects.toBeInstanceOf(
      AgentAttachmentFolderSourceError,
    );
  });

  it.each([
    REMOTE_FILE_SOURCE_PATH_ERROR,
    REMOTE_FILE_SOURCE_SPECIAL_ERROR,
    REMOTE_FILE_SOURCE_EMPTY_ERROR,
    "File is larger than 50 MiB.",
    REMOTE_FILE_SOURCE_UNREADABLE_ERROR,
  ])("keeps the exact native refusal %s", async (message) => {
    invoke.mockRejectedValueOnce(message).mockRejectedValueOnce(new Error(message));
    await expect(stageAgentAttachmentFileSource("/tmp/a.pdf")).rejects.toThrow(message);
    await expect(stageAgentAttachmentFileSource("/tmp/a.pdf")).rejects.toThrow(message);
  });

  it.each(["", "   ", "bad\u0000message", "x".repeat(513), 42, null])(
    "replaces the unpresentable native failure %j",
    async (failure) => {
      invoke.mockRejectedValue(failure);
      const refused = stageAgentAttachmentFileSource("/tmp/a.pdf");
      await expect(refused).rejects.toThrow(REMOTE_FILE_SOURCE_UNREADABLE_ERROR);
      await expect(refused).rejects.not.toBeInstanceOf(AgentAttachmentFolderSourceError);
    },
  );

  it("releases a staged source through the closed command", async () => {
    invoke.mockResolvedValue(null);
    await tauriAgentFileSource.release(sourceId);
    expect(invoke.mock.calls).toEqual([
      ["release_agent_attachment_file_source", { request: { sourceId } }],
    ]);
  });

  it.each(["", "/Users/dev/report.pdf", "12345678123442348234123456789abc"])(
    "never sends the malformed source id %j to release",
    async (id) => {
      await releaseAgentAttachmentFileSource(id);
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it("skips release without a native runtime", async () => {
    isTauri.mockReturnValue(false);
    await releaseAgentAttachmentFileSource(sourceId);
    expect(invoke).not.toHaveBeenCalled();
  });
});
