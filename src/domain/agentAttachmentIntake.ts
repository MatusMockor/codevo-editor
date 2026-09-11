import {
  MAX_AGENT_ATTACHMENT_NAME_BYTES,
  MAX_AGENT_ATTACHMENT_PATH_BYTES,
  MAX_AGENT_FILE_BYTES,
  MAX_AGENT_IMAGE_BYTES,
  MAX_AGENT_TURN_ATTACHMENTS,
  MAX_AGENT_TURN_IMAGE_BYTES,
  isAgentImageMime,
  type AgentAttachment,
  type AgentAttachmentKind,
  type AgentImageMime,
} from "./agentAttachment";
import { MAX_AGENT_TASK_PROMPT_BYTES } from "./agentTask";

export const MAX_AGENT_IMAGE_SOURCE_BYTES = 50 * 1_024 * 1_024;

export const AGENT_ATTACHMENT_COUNT_REFUSAL = "Up to 8 attachments per message.";
export const AGENT_ATTACHMENT_TURN_IMAGE_BYTES_REFUSAL = "Images in this message exceed 40 MiB.";
export const AGENT_ATTACHMENT_IMAGE_BYTES_REFUSAL = "Image cannot be shrunk to 10 MiB.";
export const AGENT_ATTACHMENT_FILE_BYTES_REFUSAL = "File is larger than 50 MiB.";
export const AGENT_ATTACHMENT_IMAGE_SOURCE_BYTES_REFUSAL = "Image is larger than 50 MiB.";
export const AGENT_ATTACHMENT_PATH_REFUSAL = "Path is not attachable.";
export const AGENT_ATTACHMENT_OVERSIZED_IMAGE_NOTICE =
  "Too large to attach as an image, inserted as a path";

export const FALLBACK_AGENT_ATTACHMENT_NAME = "attachment";

export type AgentIntakeImageMime = AgentImageMime | "image/heic" | "image/heif";

export interface AgentAttachmentCandidate {
  readonly name: string;
  readonly mime: string;
  readonly hasPath: boolean;
  readonly bytes: number;
}

export type AgentAttachmentCandidateType =
  { readonly kind: "image"; readonly mime: AgentIntakeImageMime } | { readonly kind: "path" };

export type AgentAttachmentIntakePlan =
  | { readonly kind: "image"; readonly sourceMime: AgentIntakeImageMime; readonly hasPath: boolean }
  | { readonly kind: "file" }
  | { readonly kind: "reference"; readonly notice: string | null }
  | { readonly kind: "refused"; readonly reason: string };

export type AgentPasteClaim = "claim" | "pass-through";

export interface AgentAttachmentSizing {
  readonly kind: AgentAttachmentKind;
  readonly bytes: number;
}

export type AgentAttachmentAdmission =
  { readonly kind: "accepted" } | { readonly kind: "refused"; readonly reason: string };

const UTF8_ENCODER = new TextEncoder();

const EXTENSION_IMAGE_MIMES: ReadonlyMap<string, AgentImageMime> = new Map([
  ["gif", "image/gif"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
]);

const HEIC_EXTENSIONS: ReadonlySet<string> = new Set(["heic", "heif"]);

export function classifyAgentAttachmentCandidate(
  candidate: AgentAttachmentCandidate,
): AgentAttachmentCandidateType {
  const mime = normalizedMime(candidate.mime);
  const extension = fileExtension(candidate.name);
  if (mime === "image/heic" || mime === "image/heif") return { kind: "image", mime };
  if (mimeIsUnknown(mime) && HEIC_EXTENSIONS.has(extension)) {
    return { kind: "image", mime: extension === "heif" ? "image/heif" : "image/heic" };
  }
  if (mimeIsUnknown(mime)) {
    const inferred = EXTENSION_IMAGE_MIMES.get(extension);
    if (inferred !== undefined) return { kind: "image", mime: inferred };
  }
  if (isAgentImageMime(mime)) return { kind: "image", mime };
  return { kind: "path" };
}

export function planAgentAttachmentIntake(
  candidate: AgentAttachmentCandidate,
): AgentAttachmentIntakePlan {
  const classified = classifyAgentAttachmentCandidate(candidate);
  if (classified.kind === "image") return imageIntakePlan(candidate, classified.mime);
  if (candidate.hasPath) return { kind: "reference", notice: null };
  if (candidate.bytes > MAX_AGENT_FILE_BYTES) {
    return { kind: "refused", reason: AGENT_ATTACHMENT_FILE_BYTES_REFUSAL };
  }
  return { kind: "file" };
}

export function agentPasteClaim(
  files: ReadonlyArray<AgentAttachmentCandidate>,
  plainTextLength: number,
): AgentPasteClaim {
  if (files.some((file) => classifyAgentAttachmentCandidate(file).kind === "image")) return "claim";
  if (plainTextLength > 0) return "pass-through";
  if (files.length > 0) return "claim";
  return "pass-through";
}

export function admitAgentAttachmentCount(
  existing: ReadonlyArray<AgentAttachmentSizing>,
): AgentAttachmentAdmission {
  if (existing.length >= MAX_AGENT_TURN_ATTACHMENTS) {
    return { kind: "refused", reason: AGENT_ATTACHMENT_COUNT_REFUSAL };
  }
  return { kind: "accepted" };
}

export function admitAgentAttachmentToTurn(
  existing: ReadonlyArray<AgentAttachmentSizing>,
  next: AgentAttachmentSizing,
): AgentAttachmentAdmission {
  const counted = admitAgentAttachmentCount(existing);
  if (counted.kind === "refused") return counted;
  if (next.kind !== "image") return { kind: "accepted" };
  if (next.bytes > MAX_AGENT_IMAGE_BYTES) {
    return { kind: "refused", reason: AGENT_ATTACHMENT_IMAGE_BYTES_REFUSAL };
  }
  if (agentAttachmentImageBytes(existing) + next.bytes > MAX_AGENT_TURN_IMAGE_BYTES) {
    return { kind: "refused", reason: AGENT_ATTACHMENT_TURN_IMAGE_BYTES_REFUSAL };
  }
  return { kind: "accepted" };
}

export function sanitizeAgentAttachmentName(raw: string): string {
  const segments = raw.split(/[/\\]/u);
  const base = segments[segments.length - 1] ?? "";
  const cleaned = base
    .replace(/"/gu, "'")
    .replace(/\p{Cc}/gu, "")
    .trim();
  const truncated = truncateToBytes(cleaned, MAX_AGENT_ATTACHMENT_NAME_BYTES);
  return truncated === "" ? FALLBACK_AGENT_ATTACHMENT_NAME : truncated;
}

export function agentAttachmentPromptLine(attachment: AgentAttachment): string {
  switch (attachment.kind) {
    case "image":
      return `[Attached image "${attachment.name}" is saved at: ${attachment.storedPath}]`;
    case "file":
      return `[Attached file "${attachment.name}" is saved at: ${attachment.storedPath}]`;
    case "reference":
      return `[Attached file "${attachment.name}" is at: ${attachment.path}]`;
    default:
      return unsupportedAttachment(attachment);
  }
}

export function agentAttachmentPromptLines(
  attachments: ReadonlyArray<AgentAttachment>,
): ReadonlyArray<string> {
  return attachments.map(agentAttachmentPromptLine);
}

export function agentEffectivePrompt(
  text: string,
  attachments: ReadonlyArray<AgentAttachment>,
): string {
  if (attachments.length === 0) return text;
  const lines = agentAttachmentPromptLines(attachments).join("\n");
  if (text === "") return lines;
  return `${text}\n\n${lines}`;
}

export function agentEffectivePromptByteLength(
  text: string,
  attachments: ReadonlyArray<AgentAttachment>,
): number {
  return UTF8_ENCODER.encode(agentEffectivePrompt(text, attachments)).byteLength;
}

export function agentEffectivePromptWithinCap(
  text: string,
  attachments: ReadonlyArray<AgentAttachment>,
): boolean {
  return agentEffectivePromptByteLength(text, attachments) <= MAX_AGENT_TASK_PROMPT_BYTES;
}

export function agentAttachmentPromptLineIsPresent(prompt: string, line: string): boolean {
  return prompt.split("\n").includes(line);
}

export function isAttachableAgentReferencePath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  if (path.includes("\0")) return false;
  return UTF8_ENCODER.encode(path).byteLength <= MAX_AGENT_ATTACHMENT_PATH_BYTES;
}

function imageIntakePlan(
  candidate: AgentAttachmentCandidate,
  sourceMime: AgentIntakeImageMime,
): AgentAttachmentIntakePlan {
  if (candidate.bytes <= MAX_AGENT_IMAGE_SOURCE_BYTES) {
    return { kind: "image", sourceMime, hasPath: candidate.hasPath };
  }
  if (!candidate.hasPath) {
    return { kind: "refused", reason: AGENT_ATTACHMENT_IMAGE_SOURCE_BYTES_REFUSAL };
  }
  return { kind: "reference", notice: AGENT_ATTACHMENT_OVERSIZED_IMAGE_NOTICE };
}

function agentAttachmentImageBytes(attachments: ReadonlyArray<AgentAttachmentSizing>): number {
  return attachments.reduce(
    (total, attachment) => (attachment.kind === "image" ? total + attachment.bytes : total),
    0,
  );
}

function mimeIsUnknown(mime: string): boolean {
  return mime === "" || mime === "application/octet-stream";
}

function normalizedMime(raw: string): string {
  const withoutParameters = raw.split(";")[0] ?? "";
  return withoutParameters.trim().toLowerCase();
}

function fileExtension(name: string): string {
  const segments = name.split(/[/\\]/u);
  const base = segments[segments.length - 1] ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

function truncateToBytes(value: string, maxBytes: number): string {
  if (UTF8_ENCODER.encode(value).byteLength <= maxBytes) return value;
  let truncated = "";
  let used = 0;
  for (const character of value) {
    const size = UTF8_ENCODER.encode(character).byteLength;
    if (used + size > maxBytes) break;
    truncated += character;
    used += size;
  }
  return truncated;
}

function unsupportedAttachment(attachment: never): never {
  throw new TypeError(`Unsupported agent attachment: ${JSON.stringify(attachment)}.`);
}
