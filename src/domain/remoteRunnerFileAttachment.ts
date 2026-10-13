export const MAX_REMOTE_FILE_ATTACHMENT_BYTES = 52_428_800;
export const MAX_REMOTE_PASTED_TEXT_BYTES = 5 * 1024 * 1024;

export const REMOTE_FILE_ATTACHMENTS_UNSUPPORTED_REFUSAL = "Update this server to attach files.";
export const REMOTE_PASTED_FILE_REFUSAL =
  "Pasted files must be UTF-8 text up to 5 MiB. Use the file picker or drag and drop for other files.";

export const REMOTE_FILE_SOURCE_PATH_ERROR = "Choose a file using an absolute local file path.";
export const REMOTE_FILE_SOURCE_SPECIAL_ERROR =
  "Choose a regular file, not a symbolic link or special file.";
export const REMOTE_FILE_SOURCE_EMPTY_ERROR = "File is empty.";
export const REMOTE_FILE_SOURCE_UNREADABLE_ERROR = "The file could not be read.";
export const REMOTE_FILE_UPLOAD_UNSTAGED_ERROR =
  "The attached file is no longer staged. Attach it again.";
export const REMOTE_FILE_UPLOAD_CHANGED_ERROR = "The attached file changed. Attach it again.";
export const REMOTE_FILE_UPLOAD_STORAGE_FULL_ERROR =
  "The server's attachment storage is full. Try again later.";
export const REMOTE_FILE_UPLOAD_REJECTED_ERROR = "The server does not accept this file.";
export const REMOTE_FILE_UPLOAD_CANCELLED_ERROR = "Attachment upload was cancelled.";
export const REMOTE_FILE_UPLOAD_MISMATCH_ERROR =
  "The server stored a different file than was sent.";
export const REMOTE_FILE_DOWNLOAD_NOT_STORED_ERROR = "The server no longer stores this attachment.";
export const REMOTE_FILE_DOWNLOAD_MISMATCH_ERROR =
  "The downloaded file does not match the attachment.";
export const REMOTE_FILE_DOWNLOAD_WRITE_ERROR = "The file could not be saved.";

type Check = (value: unknown) => boolean;

const UTF8_ENCODER = new TextEncoder();
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SERVER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}$/;
const NAME_FORBIDDEN = /[\\/\x00-\x1f\x7f]/;
const LONE_SURROGATE = /[\uD800-\uDFFF]/u;

const uuid: Check = (value) => typeof value === "string" && UUID_V4.test(value);
const serverId: Check = (value) => typeof value === "string" && SERVER_ID.test(value);
const sha256: Check = (value) => typeof value === "string" && SHA256.test(value);
const boolean: Check = (value) => typeof value === "boolean";
const boundedText =
  (maxBytes: number): Check =>
  (value) =>
    typeof value === "string" &&
    value.trim().length > 0 &&
    UTF8_ENCODER.encode(value).byteLength <= maxBytes &&
    !value.includes("\0");
const byteCount =
  (max: number): Check =>
  (value) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= max;
const timestamp: Check = (value) =>
  boundedText(64)(value) && Number.isFinite(Date.parse(value as string));
const exact =
  (fields: Readonly<Record<string, Check>>): Check =>
  (value) =>
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => Object.prototype.hasOwnProperty.call(fields, key)) &&
    Object.entries(fields).every(([key, check]) => check((value as Record<string, unknown>)[key]));

export function isRemoteRunnerFileAttachmentName(value: unknown): value is string {
  return (
    boundedText(255)(value) &&
    !NAME_FORBIDDEN.test(value as string) &&
    !LONE_SURROGATE.test(value as string)
  );
}

export function isRemoteRunnerFileMediaType(value: unknown): value is string {
  return typeof value === "string" && MEDIA_TYPE.test(value);
}

export const isRemoteRunnerFileAttachment: Check = exact({
  id: uuid,
  runnerId: boundedText(128),
  name: isRemoteRunnerFileAttachmentName,
  bytes: byteCount(MAX_REMOTE_FILE_ATTACHMENT_BYTES),
  sha256,
  createdAt: timestamp,
  kind: (value) => value === "file",
  mediaType: isRemoteRunnerFileMediaType,
});

export const remoteRunnerFileAttachmentChecks = {
  uploadAttachmentFile: {
    request: exact({
      serverId,
      attachmentId: uuid,
      sourceId: uuid,
      name: isRemoteRunnerFileAttachmentName,
    }),
    response: exact({ attachment: isRemoteRunnerFileAttachment, created: boolean }),
  },
  cancelAttachmentUpload: {
    request: exact({ serverId, attachmentId: uuid }),
    response: (value: unknown) => value === null || value === undefined,
  },
  downloadAttachment: {
    request: exact({
      serverId,
      attachmentId: uuid,
      name: boundedText(255),
      bytes: byteCount(MAX_REMOTE_FILE_ATTACHMENT_BYTES),
      sha256,
    }),
    response: exact({ status: (value) => value === "saved" || value === "cancelled" }),
  },
} as const;
