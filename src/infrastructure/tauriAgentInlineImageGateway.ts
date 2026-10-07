import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  AgentInlineImageGateway,
  AgentInlineImageRequest,
} from "../application/agentInlineImagePorts";
import {
  MAX_AGENT_INLINE_IMAGE_BYTES,
  MAX_AGENT_INLINE_IMAGE_PATH_BYTES,
} from "../domain/agentMarkdown/agentInlineImage";
import { AGENT_TASK_ID_PATTERN, MAX_AGENT_TASK_WORKSPACE_ID_BYTES } from "../domain/agentTask";

export const READ_AGENT_INLINE_IMAGE_IPC_COMMAND = "read_agent_inline_image" as const;
export const AGENT_INLINE_IMAGE_RUNTIME_UNAVAILABLE =
  "Inline images require the native runtime." as const;

export type InvokeAgentInlineImageCommand = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export type AgentInlineImageRuntimeDetector = () => boolean;

const UTF8_ENCODER = new TextEncoder();
const CONTROL_CHARACTER = /\p{Cc}/u;

const invokeAgentInlineImageCommand: InvokeAgentInlineImageCommand = (command, args) =>
  invoke(command, args);

export async function invokeReadAgentInlineImageIpc(
  invokeCommand: InvokeAgentInlineImageCommand,
  request: AgentInlineImageRequest,
): Promise<ArrayBuffer> {
  const value = await invokeCommand(READ_AGENT_INLINE_IMAGE_IPC_COMMAND, {
    request: {
      workspaceId: workspaceId(request.workspaceId),
      threadId: threadId(request.threadId),
      path: imagePath(request.path),
    },
  });
  return imageBytes(value);
}

export class TauriAgentInlineImageGateway implements AgentInlineImageGateway {
  constructor(
    private readonly invokeCommand: InvokeAgentInlineImageCommand = invokeAgentInlineImageCommand,
    private readonly isRuntimeAvailable: AgentInlineImageRuntimeDetector = isTauri,
  ) {}

  async readAgentInlineImage(request: AgentInlineImageRequest): Promise<ArrayBuffer> {
    if (!this.isRuntimeAvailable()) throw new Error(AGENT_INLINE_IMAGE_RUNTIME_UNAVAILABLE);
    return invokeReadAgentInlineImageIpc(this.invokeCommand, request);
  }
}

function workspaceId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    CONTROL_CHARACTER.test(value) ||
    UTF8_ENCODER.encode(value).byteLength > MAX_AGENT_TASK_WORKSPACE_ID_BYTES
  ) {
    invalid("request.workspaceId", "a bounded workspace id");
  }
  return value;
}

function threadId(value: unknown): string {
  if (typeof value !== "string" || !AGENT_TASK_ID_PATTERN.test(value)) {
    invalid("request.threadId", "a safe agent thread id");
  }
  return value;
}

function imagePath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    CONTROL_CHARACTER.test(value) ||
    UTF8_ENCODER.encode(value).byteLength > MAX_AGENT_INLINE_IMAGE_PATH_BYTES
  ) {
    invalid(
      "request.path",
      `an absolute path of at most ${MAX_AGENT_INLINE_IMAGE_PATH_BYTES} bytes without control characters`,
    );
  }
  return value;
}

function imageBytes(value: unknown): ArrayBuffer {
  if (value instanceof Uint8Array) {
    boundedByteLength(value.byteLength);
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
  }
  if (!(value instanceof ArrayBuffer)) invalid("result", "raw image bytes");
  boundedByteLength(value.byteLength);
  return value;
}

function boundedByteLength(byteLength: number): void {
  if (byteLength > 0 && byteLength <= MAX_AGENT_INLINE_IMAGE_BYTES) return;
  invalid("result", `between 1 and ${MAX_AGENT_INLINE_IMAGE_BYTES} image bytes`);
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(`Invalid agent inline image value at ${path}: expected ${expectation}.`);
}
