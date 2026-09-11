import {
  MAX_AGENT_IMAGE_BYTES,
  isAgentImageDimension,
  isAgentImageMime,
  type AgentImageMime,
} from "./agentAttachment";
import { MAX_AGENT_IMAGE_SOURCE_BYTES } from "./agentAttachmentIntake";

export const AGENT_IMAGE_MAX_EDGE = 2_048;
export const AGENT_IMAGE_QUALITY_LADDER: ReadonlyArray<number> = [0.92, 0.85, 0.78, 0.68];
export const AGENT_IMAGE_SCALE_LADDER: ReadonlyArray<number> = [1, 0.75, 0.55];

export type AgentImageEncodeMime = "image/webp" | "image/jpeg";

export interface AgentImageSource {
  readonly width: number;
  readonly height: number;
}

export interface AgentImageSurfacePort {
  decode(bytes: ArrayBuffer, mime: string): Promise<AgentImageSource>;
  encodeMime(): Promise<AgentImageEncodeMime>;
  encode(
    source: AgentImageSource,
    width: number,
    height: number,
    mime: AgentImageEncodeMime,
    quality: number,
  ): Promise<ArrayBuffer>;
  release(source: AgentImageSource): void;
}

export interface AgentImageShrinkRequest {
  readonly name: string;
  readonly mime: string;
  readonly bytes: ArrayBuffer;
}

export type AgentImageShrinkOutcome =
  | {
      readonly kind: "ready";
      readonly name: string;
      readonly mime: AgentImageMime;
      readonly bytes: ArrayBuffer;
      readonly width: number;
      readonly height: number;
      readonly reencoded: boolean;
    }
  | { readonly kind: "refused"; readonly reason: "unreadable" | "too-large" };

export async function shrinkAgentImageToFit(
  request: AgentImageShrinkRequest,
  surface: AgentImageSurfacePort,
): Promise<AgentImageShrinkOutcome> {
  if (request.bytes.byteLength === 0) return refused("unreadable");
  if (request.bytes.byteLength > MAX_AGENT_IMAGE_SOURCE_BYTES) return refused("too-large");
  const decoded = await decodeOrNull(request, surface);
  if (decoded === null) return refused("unreadable");
  try {
    if (!isAgentImageDimension(decoded.width) || !isAgentImageDimension(decoded.height)) {
      return refused("unreadable");
    }
    if (request.bytes.byteLength <= MAX_AGENT_IMAGE_BYTES && isAgentImageMime(request.mime)) {
      return {
        kind: "ready",
        name: request.name,
        mime: request.mime,
        bytes: request.bytes,
        width: decoded.width,
        height: decoded.height,
        reencoded: false,
      };
    }
    return await reencodeAgentImage(request.name, decoded, surface);
  } finally {
    surface.release(decoded);
  }
}

export function agentShrunkAttachmentName(name: string, mime: AgentImageEncodeMime): string {
  const extension = mime === "image/webp" ? "webp" : "jpg";
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem}.${extension}`;
}

export function agentImageFitBox(
  width: number,
  height: number,
  maxEdge: number,
): { readonly width: number; readonly height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const ratio = maxEdge / longest;
  return { width: scaledEdge(width, ratio), height: scaledEdge(height, ratio) };
}

async function reencodeAgentImage(
  name: string,
  decoded: AgentImageSource,
  surface: AgentImageSurfacePort,
): Promise<AgentImageShrinkOutcome> {
  const encodeMime = await encodeMimeOrNull(surface);
  if (encodeMime === null) return refused("unreadable");
  const base = agentImageFitBox(decoded.width, decoded.height, AGENT_IMAGE_MAX_EDGE);
  let encoded = false;
  for (const scale of AGENT_IMAGE_SCALE_LADDER) {
    const width = scaledEdge(base.width, scale);
    const height = scaledEdge(base.height, scale);
    for (const quality of AGENT_IMAGE_QUALITY_LADDER) {
      const bytes = await encodeOrNull(surface, decoded, width, height, encodeMime, quality);
      if (bytes === null) continue;
      encoded = true;
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_AGENT_IMAGE_BYTES) continue;
      return {
        kind: "ready",
        name: agentShrunkAttachmentName(name, encodeMime),
        mime: encodeMime,
        bytes,
        width,
        height,
        reencoded: true,
      };
    }
  }
  return refused(encoded ? "too-large" : "unreadable");
}

async function decodeOrNull(
  request: AgentImageShrinkRequest,
  surface: AgentImageSurfacePort,
): Promise<AgentImageSource | null> {
  try {
    return await surface.decode(request.bytes, request.mime);
  } catch {
    return null;
  }
}

async function encodeMimeOrNull(
  surface: AgentImageSurfacePort,
): Promise<AgentImageEncodeMime | null> {
  try {
    return await surface.encodeMime();
  } catch {
    return null;
  }
}

async function encodeOrNull(
  surface: AgentImageSurfacePort,
  source: AgentImageSource,
  width: number,
  height: number,
  mime: AgentImageEncodeMime,
  quality: number,
): Promise<ArrayBuffer | null> {
  try {
    return await surface.encode(source, width, height, mime, quality);
  } catch {
    return null;
  }
}

function scaledEdge(edge: number, ratio: number): number {
  return Math.max(1, Math.round(edge * ratio));
}

function refused(reason: "unreadable" | "too-large"): AgentImageShrinkOutcome {
  return { kind: "refused", reason };
}
