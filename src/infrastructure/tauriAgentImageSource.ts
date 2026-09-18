import { invoke, isTauri } from "@tauri-apps/api/core";
import { isAgentAttachmentPath, MAX_AGENT_ATTACHMENT_PATH_BYTES } from "../domain/agentAttachment";
import { MAX_AGENT_IMAGE_SOURCE_BYTES } from "../domain/agentAttachmentIntake";

/** Reads only an explicit picker/drop source; the destination owns staging and upload. */
export async function readAgentAttachmentImagePath(path: string): Promise<ArrayBuffer> {
  if (
    typeof path !== "string" ||
    !isAgentAttachmentPath(path) ||
    /\p{Cc}/u.test(path) ||
    new TextEncoder().encode(path).byteLength > MAX_AGENT_ATTACHMENT_PATH_BYTES
  ) {
    throw new Error("Choose an image using an absolute local file path.");
  }
  if (!isTauri()) throw new Error("Attachments require the native runtime.");
  let bytes: unknown;
  try {
    bytes = await invoke("read_agent_attachment_image_source", { request: { path } });
  } catch (error: unknown) {
    throw nativeImageError(error);
  }
  if (
    !(bytes instanceof ArrayBuffer) ||
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_AGENT_IMAGE_SOURCE_BYTES
  ) {
    throw new Error("The selected image could not be read safely.");
  }
  return bytes;
}

function nativeImageError(error: unknown): Error {
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  return new Error(
    message.trim().length > 0 &&
      new TextEncoder().encode(message).byteLength <= 512 &&
      !/\p{Cc}/u.test(message)
      ? message
      : "The selected image could not be read safely.",
  );
}
