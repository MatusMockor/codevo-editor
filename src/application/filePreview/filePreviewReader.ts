import type { FilePreview } from "../../domain/filePreview";

export interface FilePreviewReader {
  read(workspaceRoot: string, relativePath: string, signal?: AbortSignal): Promise<FilePreview>;
}

export type FilePreviewFailureKind =
  "notFound" | "notRegularFile" | "unreadable" | "operationFailed";

export class FilePreviewReadError extends Error {
  constructor(readonly kind: FilePreviewFailureKind) {
    super(filePreviewFailureMessage(kind));
    this.name = "FilePreviewReadError";
  }
}

export function filePreviewFailureMessage(kind: FilePreviewFailureKind): string {
  switch (kind) {
    case "notFound":
      return "This file doesn't exist in this project or worktree.";
    case "notRegularFile":
      return "This path can't be previewed as a regular file. It may be a folder or an unsupported file.";
    case "unreadable":
      return "This file couldn't be read. Check its permissions and try again.";
    case "operationFailed":
      return "This file couldn't be opened. Try again.";
    default:
      return unsupportedFailure(kind);
  }
}

function unsupportedFailure(kind: never): never {
  throw new Error(`Unsupported file preview failure: ${String(kind)}`);
}
