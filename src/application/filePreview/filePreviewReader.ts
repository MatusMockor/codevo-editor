import type { FilePreview } from "../../domain/filePreview";

export interface FilePreviewReader {
  read(workspaceRoot: string, relativePath: string, signal?: AbortSignal): Promise<FilePreview>;
}
