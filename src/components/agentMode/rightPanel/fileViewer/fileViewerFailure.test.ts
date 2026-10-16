import { describe, expect, it } from "vitest";
import {
  filePreviewFailureMessage,
  type FilePreviewFailureKind,
} from "../../../../application/filePreview/filePreviewReader";

const COPY = {
  notFound: "This file doesn't exist in this project or worktree.",
  notRegularFile:
    "This path can't be previewed as a regular file. It may be a folder or an unsupported file.",
  unreadable: "This file couldn't be read. Check its permissions and try again.",
  operationFailed: "This file couldn't be opened. Try again.",
} satisfies Readonly<Record<FilePreviewFailureKind, string>>;

describe("file preview failure copy", () => {
  it("maps every failure kind to bounded product copy", () => {
    for (const kind of Object.keys(COPY) as FilePreviewFailureKind[]) {
      expect(filePreviewFailureMessage(kind)).toBe(COPY[kind]);
      expect(filePreviewFailureMessage(kind).length).toBeLessThan(100);
    }
  });
});
