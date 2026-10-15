import { invoke } from "@tauri-apps/api/core";
import type { FilePreviewReader } from "../application/filePreview/filePreviewReader";
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

function readFailure(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string" && error.length > 0) return new Error(error.slice(0, 1_000));
  return new Error("File preview read failed.");
}
