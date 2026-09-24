import { describe, expect, it } from "vitest";
import {
  queuedEditAttachmentDraft,
  queuedEditImageRequests,
  withQueuedEditImagePreviews,
  type AgentComposerQueuedEdit,
} from "./agentComposerQueuedEdit";

const IMAGE_ID = "0".repeat(31) + "1";
const FILE_ID = "0".repeat(31) + "2";

function edit(): AgentComposerQueuedEdit {
  return {
    threadId: "agt-1-0a1b",
    lease: 1,
    prompt: "Describe the image",
    attachments: [
      queuedEditAttachmentDraft({
        key: "attachment-0",
        attachment: {
          kind: "image",
          attachmentId: IMAGE_ID,
          name: "pripona.png",
          mime: "image/png",
          bytes: 3,
          width: 1,
          height: 1,
          storedPath: "/data/pripona.png",
        },
      }),
      queuedEditAttachmentDraft({
        key: "attachment-1",
        attachment: {
          kind: "file",
          attachmentId: FILE_ID,
          name: "notes.txt",
          bytes: 5,
          storedPath: "/data/notes.txt",
        },
      }),
    ],
    onRemoveAttachment: () => undefined,
    onCancel: () => undefined,
    commit: async () => true,
  };
}

describe("queued edit image previews", () => {
  it("requests only stored images with a known media type", () => {
    expect(queuedEditImageRequests(edit().attachments)).toEqual([
      { attachmentId: IMAGE_ID, mime: "image/png" },
    ]);
  });

  it("fills a ready thumbnail and leaves other drafts untouched", () => {
    const original = edit();
    const previewed = withQueuedEditImagePreviews(original, (id) =>
      id === IMAGE_ID ? { kind: "ready", url: "blob:queued-0" } : undefined,
    );
    expect(previewed.attachments[0]?.previewUrl).toBe("blob:queued-0");
    expect(previewed.attachments[1]).toBe(original.attachments[1]);
    expect(previewed.onRemoveAttachment).toBe(original.onRemoveAttachment);
  });

  it("returns the same edit while nothing is ready", () => {
    const original = edit();
    expect(withQueuedEditImagePreviews(original, () => ({ kind: "loading" }))).toBe(original);
    expect(
      withQueuedEditImagePreviews(original, () => ({ kind: "unavailable", reason: "gone" })),
    ).toBe(original);
  });
});
