import {
  MAX_AGENT_ATTACHMENT_NAME_BYTES,
  MAX_AGENT_ATTACHMENT_PATH_BYTES,
  MAX_AGENT_FILE_BYTES,
  MAX_AGENT_TURN_ATTACHMENTS,
  isAgentAttachmentId,
  isAgentAttachmentName,
  isAgentAttachmentPath,
  isAgentImageDimension,
  isAgentImageMime,
  type AgentImageMime,
} from "../domain/agentAttachment";
import { MAX_AGENT_IMAGE_SOURCE_BYTES } from "../domain/agentAttachmentIntake";
import { AGENT_TASK_ID_PATTERN, MAX_AGENT_TASK_WORKSPACE_ID_BYTES } from "../domain/agentTask";
import type {
  AgentAttachmentCandidateInspection,
  AgentAttachmentCandidateRequest,
  AgentAttachmentReferenceRequest,
  ClaimAgentAttachmentsRequest,
  ClaimedAgentAttachment,
  StageAgentAttachmentBytesRequest,
  StageAgentAttachmentFromPathRequest,
  StagedAgentAttachment,
  StoredAgentAttachmentRequest,
} from "../application/agentAttachmentPorts";

export const STAGE_AGENT_ATTACHMENT_BYTES_IPC_COMMAND = "stage_agent_attachment_bytes" as const;
export const STAGE_AGENT_ATTACHMENT_FROM_PATH_IPC_COMMAND =
  "stage_agent_attachment_from_path" as const;
export const INSPECT_AGENT_ATTACHMENT_CANDIDATE_IPC_COMMAND =
  "inspect_agent_attachment_candidate" as const;
export const READ_AGENT_ATTACHMENT_CANDIDATE_IPC_COMMAND =
  "read_agent_attachment_candidate" as const;
export const CLAIM_AGENT_ATTACHMENTS_IPC_COMMAND = "claim_agent_attachments" as const;
export const RELEASE_AGENT_ATTACHMENT_IPC_COMMAND = "release_agent_attachment" as const;
export const READ_AGENT_ATTACHMENT_IPC_COMMAND = "read_agent_attachment" as const;
export const REVEAL_AGENT_ATTACHMENT_IPC_COMMAND = "reveal_agent_attachment" as const;

/**
 * Raw-body staging carries its metadata in one ASCII-escaped JSON header so the
 * binary payload stays a single copy on the wire.
 */
export const AGENT_ATTACHMENT_REQUEST_HEADER = "x-agent-attachment" as const;

export const MAX_AGENT_ATTACHMENT_PROMPT_LINE_BYTES = 8 * 1_024;

export type InvokeAgentAttachmentCommand = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export type InvokeAgentAttachmentRawCommand = (
  command: string,
  body: Uint8Array,
  headers: Readonly<Record<string, string>>,
) => Promise<unknown>;

const UTF8_ENCODER = new TextEncoder();

export function agentAttachmentRequestHeaders(
  request: StageAgentAttachmentBytesRequest,
): Readonly<Record<string, string>> {
  return {
    [AGENT_ATTACHMENT_REQUEST_HEADER]: asciiJson({
      workspaceId: workspaceId(request.workspaceId, "request.workspaceId"),
      kind: stagedKind(request.kind, "request.kind"),
      name: attachmentName(request.name, "request.name"),
      mime: optionalImageMime(request.mime, "request.mime"),
      width: optionalDimension(request.width, "request.width"),
      height: optionalDimension(request.height, "request.height"),
    }),
  };
}

export async function invokeStageAgentAttachmentBytesIpc(
  invokeRaw: InvokeAgentAttachmentRawCommand,
  request: StageAgentAttachmentBytesRequest,
): Promise<StagedAgentAttachment> {
  const headers = agentAttachmentRequestHeaders(request);
  const body = stagedBody(request);
  return parseStagedAgentAttachment(
    await invokeRaw(STAGE_AGENT_ATTACHMENT_BYTES_IPC_COMMAND, body, headers),
  );
}

export async function invokeStageAgentAttachmentFromPathIpc(
  invokeCommand: InvokeAgentAttachmentCommand,
  request: StageAgentAttachmentFromPathRequest,
): Promise<StagedAgentAttachment> {
  const validated = {
    workspaceId: workspaceId(request.workspaceId, "request.workspaceId"),
    kind: imageKind(request.kind, "request.kind"),
    name: attachmentName(request.name, "request.name"),
    mime: imageMime(request.mime, "request.mime"),
    path: attachmentPath(request.path, "request.path"),
  };
  return parseStagedAgentAttachment(
    await invokeCommand(STAGE_AGENT_ATTACHMENT_FROM_PATH_IPC_COMMAND, { request: validated }),
  );
}

export async function invokeInspectAgentAttachmentCandidateIpc(
  invokeCommand: InvokeAgentAttachmentCommand,
  request: AgentAttachmentCandidateRequest,
): Promise<AgentAttachmentCandidateInspection> {
  const value = await invokeCommand(INSPECT_AGENT_ATTACHMENT_CANDIDATE_IPC_COMMAND, {
    request: candidateRequest(request),
  });
  const result = record(value, "result");
  exactKeys(result, ["bytes", "isRegularFile", "extensionMime"], "result");
  return {
    bytes: boundedBytes(result.bytes, "result.bytes", Number.MAX_SAFE_INTEGER),
    isRegularFile: booleanFlag(result.isRegularFile, "result.isRegularFile"),
    extensionMime: optionalMimeText(result.extensionMime, "result.extensionMime"),
  };
}

export async function invokeReadAgentAttachmentCandidateIpc(
  invokeCommand: InvokeAgentAttachmentCommand,
  request: AgentAttachmentCandidateRequest,
): Promise<ArrayBuffer> {
  const value = await invokeCommand(READ_AGENT_ATTACHMENT_CANDIDATE_IPC_COMMAND, {
    request: candidateRequest(request),
  });
  return attachmentBytes(value, MAX_AGENT_IMAGE_SOURCE_BYTES);
}

export async function invokeClaimAgentAttachmentsIpc(
  invokeCommand: InvokeAgentAttachmentCommand,
  request: ClaimAgentAttachmentsRequest,
): Promise<ReadonlyArray<ClaimedAgentAttachment>> {
  const attachmentIds = request.attachmentIds.map((value, index) =>
    attachmentId(value, `request.attachmentIds[${index}]`),
  );
  if (attachmentIds.length === 0 || attachmentIds.length > MAX_AGENT_TURN_ATTACHMENTS) {
    invalid("request.attachmentIds", `between 1 and ${MAX_AGENT_TURN_ATTACHMENTS} attachment ids`);
  }
  if (new Set(attachmentIds).size !== attachmentIds.length) {
    invalid("request.attachmentIds", "distinct attachment ids");
  }
  const value = await invokeCommand(CLAIM_AGENT_ATTACHMENTS_IPC_COMMAND, {
    request: {
      workspaceId: workspaceId(request.workspaceId, "request.workspaceId"),
      threadId: threadId(request.threadId, "request.threadId"),
      attachmentIds,
    },
  });
  return parseClaimedAgentAttachments(value, attachmentIds);
}

export async function invokeReleaseAgentAttachmentIpc(
  invokeCommand: InvokeAgentAttachmentCommand,
  request: AgentAttachmentReferenceRequest,
): Promise<void> {
  const value = await invokeCommand(RELEASE_AGENT_ATTACHMENT_IPC_COMMAND, {
    request: {
      workspaceId: workspaceId(request.workspaceId, "request.workspaceId"),
      attachmentId: attachmentId(request.attachmentId, "request.attachmentId"),
    },
  });
  expectNull(value);
}

export async function invokeReadAgentAttachmentIpc(
  invokeCommand: InvokeAgentAttachmentCommand,
  request: StoredAgentAttachmentRequest,
): Promise<ArrayBuffer> {
  const value = await invokeCommand(READ_AGENT_ATTACHMENT_IPC_COMMAND, {
    request: storedRequest(request),
  });
  return attachmentBytes(value, MAX_AGENT_FILE_BYTES);
}

export async function invokeRevealAgentAttachmentIpc(
  invokeCommand: InvokeAgentAttachmentCommand,
  request: StoredAgentAttachmentRequest,
): Promise<void> {
  const value = await invokeCommand(REVEAL_AGENT_ATTACHMENT_IPC_COMMAND, {
    request: storedRequest(request),
  });
  expectNull(value);
}

export function parseStagedAgentAttachment(value: unknown): StagedAgentAttachment {
  const result = record(value, "result");
  exactKeys(
    result,
    ["attachmentId", "name", "mime", "bytes", "width", "height", "promptLineBytesMax"],
    "result",
  );
  const mime = optionalImageMime(result.mime, "result.mime");
  const width = optionalDimension(result.width, "result.width");
  const height = optionalDimension(result.height, "result.height");
  if (mime === null ? width !== null || height !== null : width === null || height === null) {
    invalid("result", "an image mime together with both image dimensions, or neither");
  }
  return {
    attachmentId: attachmentId(result.attachmentId, "result.attachmentId"),
    name: attachmentName(result.name, "result.name"),
    mime,
    bytes: boundedBytes(result.bytes, "result.bytes", MAX_AGENT_FILE_BYTES),
    width,
    height,
    promptLineBytesMax: boundedBytes(
      result.promptLineBytesMax,
      "result.promptLineBytesMax",
      MAX_AGENT_ATTACHMENT_PROMPT_LINE_BYTES,
    ),
  };
}

export function parseClaimedAgentAttachments(
  value: unknown,
  requested: ReadonlyArray<string>,
): ReadonlyArray<ClaimedAgentAttachment> {
  if (!Array.isArray(value)) invalid("result", "an array of claimed attachments");
  if (value.length !== requested.length) {
    invalid("result", "one claimed attachment per requested attachment id");
  }
  return value.map((entry, index) => {
    const path = `result[${index}]`;
    const claimed = record(entry, path);
    exactKeys(claimed, ["attachmentId", "storedPath", "promptLine"], path);
    const id = attachmentId(claimed.attachmentId, `${path}.attachmentId`);
    if (id !== requested[index]) invalid(`${path}.attachmentId`, "the requested attachment id");
    return {
      attachmentId: id,
      storedPath: attachmentPath(claimed.storedPath, `${path}.storedPath`),
      promptLine: promptLine(claimed.promptLine, `${path}.promptLine`),
    };
  });
}

function stagedBody(request: StageAgentAttachmentBytesRequest): Uint8Array {
  const limit = request.kind === "image" ? MAX_AGENT_IMAGE_SOURCE_BYTES : MAX_AGENT_FILE_BYTES;
  if (request.bytes.byteLength === 0 || request.bytes.byteLength > limit) {
    invalid("request.bytes", `between 1 and ${limit} bytes`);
  }
  return new Uint8Array(request.bytes);
}

function candidateRequest(request: AgentAttachmentCandidateRequest): Record<string, unknown> {
  return {
    workspaceId: workspaceId(request.workspaceId, "request.workspaceId"),
    path: attachmentPath(request.path, "request.path"),
  };
}

function storedRequest(request: StoredAgentAttachmentRequest): Record<string, unknown> {
  return {
    workspaceId: workspaceId(request.workspaceId, "request.workspaceId"),
    threadId: threadId(request.threadId, "request.threadId"),
    attachmentId: attachmentId(request.attachmentId, "request.attachmentId"),
  };
}

function attachmentBytes(value: unknown, maxBytes: number): ArrayBuffer {
  const buffer =
    value instanceof ArrayBuffer
      ? value
      : ArrayBuffer.isView(value)
        ? viewBuffer(value)
        : arrayBufferFromNumbers(value);
  if (buffer.byteLength > maxBytes) {
    invalid("result", `at most ${maxBytes} attachment bytes`);
  }
  return buffer;
}

function viewBuffer(view: ArrayBufferView): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

function arrayBufferFromNumbers(value: unknown): ArrayBuffer {
  if (!Array.isArray(value)) invalid("result", "attachment bytes");
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const byte: unknown = value[index];
    if (!Number.isInteger(byte) || (byte as number) < 0 || (byte as number) > 255) {
      invalid(`result[${index}]`, "a byte between 0 and 255");
    }
    bytes[index] = byte as number;
  }
  return bytes.buffer;
}

function asciiJson(value: Record<string, unknown>): string {
  return JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function stagedKind(value: unknown, path: string): "image" | "file" {
  if (value !== "image" && value !== "file") invalid(path, "image or file");
  return value;
}

function imageKind(value: unknown, path: string): "image" {
  if (value !== "image") invalid(path, "image");
  return value;
}

function imageMime(value: unknown, path: string): AgentImageMime {
  if (!isAgentImageMime(value)) invalid(path, "a supported agent image mime");
  return value;
}

function optionalImageMime(value: unknown, path: string): AgentImageMime | null {
  if (value === null || value === undefined) return null;
  return imageMime(value, path);
}

function optionalMimeText(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > 255) {
    invalid(path, "null or a bounded mime string");
  }
  return value;
}

function optionalDimension(value: unknown, path: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !isAgentImageDimension(value)) {
    invalid(path, "null or an image dimension within 1 and 16384");
  }
  return value;
}

function attachmentName(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    /\p{Cc}/u.test(value) ||
    !isAgentAttachmentName(value) ||
    UTF8_ENCODER.encode(value).byteLength > MAX_AGENT_ATTACHMENT_NAME_BYTES
  ) {
    invalid(path, "a sanitised attachment name of at most 255 bytes");
  }
  return value;
}

function attachmentPath(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.includes("\0") ||
    !isAgentAttachmentPath(value) ||
    UTF8_ENCODER.encode(value).byteLength > MAX_AGENT_ATTACHMENT_PATH_BYTES
  ) {
    invalid(path, "an absolute path of at most 4096 bytes");
  }
  return value;
}

function promptLine(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\n") ||
    value.includes("\0") ||
    UTF8_ENCODER.encode(value).byteLength > MAX_AGENT_ATTACHMENT_PROMPT_LINE_BYTES
  ) {
    invalid(path, "a single bounded prompt line");
  }
  return value;
}

function attachmentId(value: unknown, path: string): string {
  if (!isAgentAttachmentId(value)) invalid(path, "32 lowercase hexadecimal characters");
  return value;
}

function threadId(value: unknown, path: string): string {
  if (typeof value !== "string" || !AGENT_TASK_ID_PATTERN.test(value)) {
    invalid(path, "a safe agent thread id");
  }
  return value;
}

function workspaceId(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    /\p{Cc}/u.test(value) ||
    UTF8_ENCODER.encode(value).byteLength > MAX_AGENT_TASK_WORKSPACE_ID_BYTES
  ) {
    invalid(path, "a bounded workspace id");
  }
  return value;
}

function boundedBytes(value: unknown, path: string, maxBytes: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maxBytes) {
    invalid(path, `a byte count between 0 and ${maxBytes}`);
  }
  return value as number;
}

function booleanFlag(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path, "a boolean");
  return value;
}

function expectNull(value: unknown): void {
  if (value !== null) invalid("result", "null");
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value);
  if (actual.some((key) => !expected.includes(key))) {
    invalid(path, `only the fields ${expected.join(", ")}`);
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(path, "an object");
  }
  return value as Record<string, unknown>;
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(`Invalid agent attachment value at ${path}: expected ${expectation}.`);
}
