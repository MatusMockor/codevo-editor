import {
  MAX_AGENT_TURN_ATTACHMENTS,
  isAgentAttachmentId,
  isAgentImageMime,
  type AgentAttachment,
  type AgentImageMime,
} from "../../domain/agentAttachment";
import type {
  ExternalSessionAttachment,
  ExternalSessionExchange,
} from "../../domain/externalAgentSession";

export const AGENT_IMPORTED_IMAGE_LABEL = "Image (from session file)";
export const AGENT_ATTACHMENT_UNAVAILABLE_LABEL = "Image unavailable";
export const AGENT_ATTACHMENT_LOADING_LABEL = "Loading image";
export const AGENT_ATTACHMENT_UNRESOLVABLE_REASON = "The image reference is not valid.";
export const AGENT_ATTACHMENT_NO_IMAGES_REASON = "Images cannot be shown here.";
export const AGENT_ATTACHMENT_DECODE_FAILED_REASON = "The image bytes could not be decoded.";
export const AGENT_ATTACHMENT_IMAGE_MAX_WIDTH = 320;
export const AGENT_ATTACHMENT_IMAGE_MAX_HEIGHT = 240;
export const AGENT_LIGHTBOX_VIEWPORT_WIDTH_FRACTION = 92;
export const AGENT_LIGHTBOX_VIEWPORT_HEIGHT_FRACTION = 86;

export type AgentTurnAttachmentGlyph = "image" | "file" | "reference";

export type AgentTurnAttachmentView =
  | {
      readonly kind: "image";
      readonly key: string;
      readonly name: string;
      readonly attachmentId: string;
      readonly mime: AgentImageMime;
      readonly width?: number;
      readonly height?: number;
    }
  | {
      readonly kind: "chip";
      readonly key: string;
      readonly name: string;
      readonly glyph: AgentTurnAttachmentGlyph;
    };

export type AgentTurnAttachmentImageView = Extract<
  AgentTurnAttachmentView,
  { readonly kind: "image" }
>;

export function agentTurnAttachmentViews(
  attachments: ReadonlyArray<AgentAttachment> | undefined,
): ReadonlyArray<AgentTurnAttachmentView> {
  if (attachments === undefined) return NO_ATTACHMENT_VIEWS;
  return attachments
    .slice(0, MAX_AGENT_TURN_ATTACHMENTS)
    .map((attachment, index) => turnAttachmentView(attachment, index));
}

export function agentImportedAttachmentViews(
  exchange: Pick<ExternalSessionExchange, "attachments">,
): ReadonlyArray<AgentTurnAttachmentView> {
  const attachments = exchange.attachments;
  if (attachments === undefined) return NO_ATTACHMENT_VIEWS;
  return attachments
    .slice(0, MAX_AGENT_TURN_ATTACHMENTS)
    .map((attachment, index) => importedAttachmentView(attachment, index));
}

export function formatAgentAttachmentBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1_024) return `${Math.round(bytes)} B`;
  if (bytes < 1_024 * 1_024) return `${roundedUnit(bytes / 1_024)} KiB`;
  return `${roundedUnit(bytes / (1_024 * 1_024))} MiB`;
}

export interface AgentAttachmentPlaceholderSize {
  readonly width: number;
  readonly height: number;
}

export function agentAttachmentPlaceholderSize(
  view: AgentTurnAttachmentImageView,
): AgentAttachmentPlaceholderSize | null {
  const { width, height } = view;
  if (width === undefined || height === undefined) return null;
  if (!isPositiveDimension(width) || !isPositiveDimension(height)) return null;
  const scale = Math.min(
    1,
    AGENT_ATTACHMENT_IMAGE_MAX_WIDTH / width,
    AGENT_ATTACHMENT_IMAGE_MAX_HEIGHT / height,
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface AgentAttachmentLightboxFit {
  readonly maxWidth: string;
  readonly maxHeight: string;
}

export function agentAttachmentLightboxFit(
  view: Pick<AgentTurnAttachmentImageView, "width" | "height">,
): AgentAttachmentLightboxFit | null {
  const { width, height } = view;
  if (width === undefined || height === undefined) return null;
  if (!isPositiveDimension(width) || !isPositiveDimension(height)) return null;
  return {
    maxWidth: `min(${AGENT_LIGHTBOX_VIEWPORT_WIDTH_FRACTION}vw, ${Math.round(width)}px)`,
    maxHeight: `min(${AGENT_LIGHTBOX_VIEWPORT_HEIGHT_FRACTION}vh, ${Math.round(height)}px)`,
  };
}

export type AgentLightboxStep = -1 | 1;

export function agentLightboxNeighborIndex(
  items: ReadonlyArray<Pick<AgentTurnAttachmentImageView, "attachmentId">>,
  index: number,
  step: AgentLightboxStep,
  ready: (attachmentId: string) => boolean,
): number | null {
  if (!Number.isInteger(index) || index < 0 || index >= items.length) return null;
  for (
    let candidate = index + step;
    candidate >= 0 && candidate < items.length;
    candidate += step
  ) {
    const item = items[candidate];
    if (item === undefined) return null;
    if (ready(item.attachmentId)) return candidate;
  }
  return null;
}

function isPositiveDimension(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

const NO_ATTACHMENT_VIEWS: ReadonlyArray<AgentTurnAttachmentView> = [];

function turnAttachmentView(attachment: AgentAttachment, index: number): AgentTurnAttachmentView {
  switch (attachment.kind) {
    case "image":
      return {
        kind: "image",
        key: attachment.attachmentId,
        name: attachment.name,
        attachmentId: attachment.attachmentId,
        mime: attachment.mime,
        width: attachment.width,
        height: attachment.height,
      };
    case "file":
      return {
        kind: "chip",
        key: attachment.attachmentId,
        name: attachment.name,
        glyph: "file",
      };
    case "reference":
      return {
        kind: "chip",
        key: `reference-${index}-${attachment.path}`,
        name: attachment.name,
        glyph: "reference",
      };
    default:
      return unsupportedAttachment(attachment);
  }
}

function importedAttachmentView(
  attachment: ExternalSessionAttachment,
  index: number,
): AgentTurnAttachmentView {
  const key = `imported-${index}`;
  switch (attachment.kind) {
    case "image":
      return { kind: "chip", key, name: importedImageName(attachment), glyph: "image" };
    case "file":
      return { kind: "chip", key, name: attachment.name, glyph: "file" };
    default:
      return unsupportedAttachment(attachment);
  }
}

function importedImageName(
  attachment: Extract<ExternalSessionAttachment, { readonly kind: "image" }>,
): string {
  if (attachment.name !== undefined) return attachment.name;
  if (attachment.path === undefined) return AGENT_IMPORTED_IMAGE_LABEL;
  const name = attachment.path.slice(attachment.path.lastIndexOf("/") + 1);
  return name === "" ? AGENT_IMPORTED_IMAGE_LABEL : name;
}

export function agentAttachmentImageIsResolvable(view: AgentTurnAttachmentView): boolean {
  if (view.kind !== "image") return false;
  return isAgentAttachmentId(view.attachmentId) && isAgentImageMime(view.mime);
}

function roundedUnit(value: number): string {
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1);
}

function unsupportedAttachment(attachment: never): never {
  throw new TypeError(`Unsupported agent attachment: ${JSON.stringify(attachment)}.`);
}
