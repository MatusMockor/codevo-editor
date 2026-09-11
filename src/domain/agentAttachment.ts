export const MAX_AGENT_TURN_ATTACHMENTS = 8;
export const MAX_AGENT_ATTACHMENT_NAME_BYTES = 255;
export const MAX_AGENT_ATTACHMENT_PATH_BYTES = 4_096;
export const MAX_AGENT_IMAGE_BYTES = 10 * 1_024 * 1_024;
export const MAX_AGENT_FILE_BYTES = 50 * 1_024 * 1_024;
export const MAX_AGENT_TURN_IMAGE_BYTES = 40 * 1_024 * 1_024;
export const MAX_AGENT_REFERENCE_BYTES = Number.MAX_SAFE_INTEGER;
export const MIN_AGENT_IMAGE_DIMENSION = 1;
export const MAX_AGENT_IMAGE_DIMENSION = 16_384;

export const AGENT_ATTACHMENT_ID_PATTERN = /^[0-9a-f]{32}$/;
export const AGENT_ATTACHMENT_NAME_FORBIDDEN_PATTERN = /[/\\"]/;

export const AGENT_IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

export type AgentImageMime = (typeof AGENT_IMAGE_MIMES)[number];

export type AgentAttachment =
  | {
      readonly kind: "image";
      readonly attachmentId: string;
      readonly name: string;
      readonly mime: AgentImageMime;
      readonly bytes: number;
      readonly width: number;
      readonly height: number;
      readonly storedPath: string;
    }
  | {
      readonly kind: "file";
      readonly attachmentId: string;
      readonly name: string;
      readonly bytes: number;
      readonly storedPath: string;
    }
  | {
      readonly kind: "reference";
      readonly name: string;
      readonly path: string;
      readonly bytes: number;
    };

export type AgentAttachmentKind = AgentAttachment["kind"];

export function isAgentAttachmentKind(value: unknown): value is AgentAttachmentKind {
  return value === "image" || value === "file" || value === "reference";
}

export function isAgentAttachmentId(value: unknown): value is string {
  return typeof value === "string" && AGENT_ATTACHMENT_ID_PATTERN.test(value);
}

export function isAgentImageMime(value: unknown): value is AgentImageMime {
  return AGENT_IMAGE_MIMES.some((mime) => mime === value);
}

export function isAgentAttachmentName(value: string): boolean {
  return !AGENT_ATTACHMENT_NAME_FORBIDDEN_PATTERN.test(value);
}

export function isAgentAttachmentPath(value: string): boolean {
  return value.startsWith("/");
}

export function isAgentImageDimension(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= MIN_AGENT_IMAGE_DIMENSION &&
    value <= MAX_AGENT_IMAGE_DIMENSION
  );
}

export function maxAgentAttachmentBytes(kind: AgentAttachmentKind): number {
  switch (kind) {
    case "image":
      return MAX_AGENT_IMAGE_BYTES;
    case "file":
      return MAX_AGENT_FILE_BYTES;
    case "reference":
      return MAX_AGENT_REFERENCE_BYTES;
    default:
      return unsupportedAgentAttachmentKind(kind);
  }
}

export function agentTurnImageBytes(attachments: ReadonlyArray<AgentAttachment>): number {
  return attachments.reduce(
    (total, attachment) => (attachment.kind === "image" ? total + attachment.bytes : total),
    0,
  );
}

function unsupportedAgentAttachmentKind(kind: never): never {
  throw new TypeError(`Unsupported agent attachment kind: ${String(kind)}.`);
}
