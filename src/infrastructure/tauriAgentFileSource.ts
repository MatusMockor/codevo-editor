import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  AgentAttachmentFileSourcePort,
  StagedAgentAttachmentFileSource,
} from "../application/agentAttachmentFileSourcePort";
import { isAgentAttachmentPath, MAX_AGENT_ATTACHMENT_PATH_BYTES } from "../domain/agentAttachment";
import {
  AGENT_ATTACHMENT_FOLDER_SOURCE_ERROR,
  AgentAttachmentFolderSourceError,
} from "../domain/agentAttachmentIntake";
import {
  MAX_REMOTE_FILE_ATTACHMENT_BYTES,
  REMOTE_FILE_SOURCE_PATH_ERROR,
  REMOTE_FILE_SOURCE_UNREADABLE_ERROR,
} from "../domain/remoteRunnerFileAttachment";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_NATIVE_ERROR_BYTES = 512;
const UTF8_ENCODER = new TextEncoder();
const STAGED_KEYS: ReadonlySet<string> = new Set(["sourceId", "name", "bytes"]);

export const tauriAgentFileSource: AgentAttachmentFileSourcePort = {
  stage: stageAgentAttachmentFileSource,
  release: releaseAgentAttachmentFileSource,
};

export async function stageAgentAttachmentFileSource(
  path: string,
): Promise<StagedAgentAttachmentFileSource> {
  if (
    typeof path !== "string" ||
    !isAgentAttachmentPath(path) ||
    /\p{Cc}/u.test(path) ||
    UTF8_ENCODER.encode(path).byteLength > MAX_AGENT_ATTACHMENT_PATH_BYTES
  ) {
    throw new Error(REMOTE_FILE_SOURCE_PATH_ERROR);
  }
  if (!isTauri()) throw new Error("Attachments require the native runtime.");
  let staged: unknown;
  try {
    staged = await invoke("stage_agent_attachment_file_source", { request: { path } });
  } catch (error: unknown) {
    throw nativeFileSourceError(error);
  }
  if (!isStagedFileSource(staged)) throw new Error(REMOTE_FILE_SOURCE_UNREADABLE_ERROR);
  return { sourceId: staged.sourceId, name: staged.name, bytes: staged.bytes };
}

export async function releaseAgentAttachmentFileSource(sourceId: string): Promise<void> {
  if (typeof sourceId !== "string" || !UUID_V4.test(sourceId)) return;
  if (!isTauri()) return;
  await invoke("release_agent_attachment_file_source", { request: { sourceId } });
}

function isStagedFileSource(value: unknown): value is StagedAgentAttachmentFileSource {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  if (!Object.keys(value).every((key) => STAGED_KEYS.has(key))) return false;
  const { sourceId, name, bytes } = value as Record<string, unknown>;
  return (
    typeof sourceId === "string" &&
    UUID_V4.test(sourceId) &&
    typeof name === "string" &&
    name.length > 0 &&
    !name.includes("\0") &&
    UTF8_ENCODER.encode(name).byteLength <= MAX_AGENT_ATTACHMENT_PATH_BYTES &&
    typeof bytes === "number" &&
    Number.isSafeInteger(bytes) &&
    bytes >= 1 &&
    bytes <= MAX_REMOTE_FILE_ATTACHMENT_BYTES
  );
}

function nativeFileSourceError(error: unknown): Error {
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  if (message === AGENT_ATTACHMENT_FOLDER_SOURCE_ERROR)
    return new AgentAttachmentFolderSourceError();
  return new Error(
    message.trim().length > 0 &&
      UTF8_ENCODER.encode(message).byteLength <= MAX_NATIVE_ERROR_BYTES &&
      !/\p{Cc}/u.test(message)
      ? message
      : REMOTE_FILE_SOURCE_UNREADABLE_ERROR,
  );
}
