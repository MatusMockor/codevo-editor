// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { MAX_AGENT_FILE_BYTES } from "../../domain/agentAttachment";
import {
  AGENT_ATTACHMENT_FILE_BYTES_REFUSAL,
  AGENT_ATTACHMENT_IMAGE_SOURCE_BYTES_REFUSAL,
} from "../../domain/agentAttachmentIntake";
import {
  AGENT_ATTACHMENT_PASTE_READ_FAILURE,
  MAX_AGENT_COMPOSER_PASTED_FILES,
  agentAttachmentPasteFailureMessage,
  agentAttachmentSourcesFromFiles,
} from "./agentComposerAttachmentPorts";

function clipboardFile(name: string, type: string, size: number) {
  const file = new File([], name, { type });
  const arrayBuffer = vi.fn(async () => new ArrayBuffer(4));
  Object.defineProperties(file, {
    size: { value: size },
    arrayBuffer: { value: arrayBuffer },
  });
  return { file, arrayBuffer };
}

describe("clipboard attachment metadata admission", () => {
  it.each([
    ["large.png", "image/png", AGENT_ATTACHMENT_IMAGE_SOURCE_BYTES_REFUSAL],
    ["large.heic", "", AGENT_ATTACHMENT_IMAGE_SOURCE_BYTES_REFUSAL],
    ["large.bin", "application/octet-stream", AGENT_ATTACHMENT_FILE_BYTES_REFUSAL],
  ])("refuses %s before reading any files and retains the reason", async (name, type, reason) => {
    const small = clipboardFile("small.txt", "text/plain", 4);
    const large = clipboardFile(name, type, MAX_AGENT_FILE_BYTES + 1);

    const result = await agentAttachmentSourcesFromFiles([small.file, large.file]).catch(
      agentAttachmentPasteFailureMessage,
    );

    expect(result).toBe(reason);
    expect(small.arrayBuffer).not.toHaveBeenCalled();
    expect(large.arrayBuffer).not.toHaveBeenCalled();
  });

  it("accepts exactly 50 MiB for authoritative downstream byte validation", async () => {
    const admitted = clipboardFile("boundary.png", "image/png", MAX_AGENT_FILE_BYTES);
    const sources = await agentAttachmentSourcesFromFiles([admitted.file]);
    expect(admitted.arrayBuffer).toHaveBeenCalledOnce();
    expect(sources).toEqual([
      { kind: "bytes", name: "boundary.png", mime: "image/png", bytes: new ArrayBuffer(4) },
    ]);
  });

  it("retains the ninth source so the existing eight-attachment admission can explain refusal", async () => {
    const files = Array.from({ length: MAX_AGENT_COMPOSER_PASTED_FILES }, (_, index) =>
      clipboardFile(`${index}.txt`, "text/plain", 4),
    );
    const ignored = clipboardFile("ignored.bin", "", MAX_AGENT_FILE_BYTES + 1);
    const sources = await agentAttachmentSourcesFromFiles([
      ...files.map(({ file }) => file),
      ignored.file,
    ]);
    expect(sources).toHaveLength(9);
    expect(ignored.arrayBuffer).not.toHaveBeenCalled();
  });

  it("keeps unexpected clipboard read errors behind the safe generic explanation", async () => {
    const broken = clipboardFile("broken.txt", "text/plain", 4);
    broken.arrayBuffer.mockRejectedValue(new Error("private clipboard details"));
    expect(
      await agentAttachmentSourcesFromFiles([broken.file]).catch(
        agentAttachmentPasteFailureMessage,
      ),
    ).toBe(AGENT_ATTACHMENT_PASTE_READ_FAILURE);
  });
});
