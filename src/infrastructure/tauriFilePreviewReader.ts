import { invoke } from "@tauri-apps/api/core";
import {
  FilePreviewReadError,
  type FilePreviewReader,
} from "../application/filePreview/filePreviewReader";
import {
  parseFilePreviewPayload,
  parseFilePreviewRequest,
  type FilePreview,
} from "../domain/filePreview";

export const FILE_PREVIEW_IPC_COMMAND = "workspace_read_file_preview";

export type InvokeFilePreviewCommand = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export function createTauriFilePreviewReader(
  invokeCommand: InvokeFilePreviewCommand = invoke,
): FilePreviewReader {
  return {
    async read(workspaceRoot, relativePath, signal): Promise<FilePreview> {
      throwIfAborted(signal);
      const request = parseFilePreviewRequest(workspaceRoot, relativePath);
      const payload = await invokeCommand(FILE_PREVIEW_IPC_COMMAND, {
        request: {
          workspaceRoot: request.workspaceRoot,
          relativePath: request.relativePath,
        },
      }).catch((error: unknown) => {
        throw readFailure(error);
      });
      throwIfAborted(signal);
      return parseFilePreviewPayload(payload, request.relativePath);
    },
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw new DOMException("File preview read was aborted.", "AbortError");
}

function readFailure(error: unknown): FilePreviewReadError {
  if (typeof error !== "object" || error === null || Array.isArray(error)) {
    return new FilePreviewReadError("operationFailed");
  }
  if (Object.keys(error).length !== 1 || !("kind" in error)) {
    return new FilePreviewReadError("operationFailed");
  }
  switch (error.kind) {
    case "notFound":
    case "notRegularFile":
    case "unreadable":
    case "operationFailed":
      return new FilePreviewReadError(error.kind);
    default:
      return new FilePreviewReadError("operationFailed");
  }
}
