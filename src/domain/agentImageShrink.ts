import {
  AGENT_IMAGE_MAX_MODEL_BYTES,
  AGENT_IMAGE_MIMES,
  MAX_AGENT_IMAGE_DIMENSION,
  isAgentImageDimension,
  isAgentImageMime,
  type AgentImageMime,
} from "./agentAttachment";
import { MAX_AGENT_IMAGE_SOURCE_BYTES } from "./agentAttachmentIntake";

export const AGENT_IMAGE_MAX_EDGE = 1_568;
export const AGENT_IMAGE_LOSSLESS_MAX_BYTES = 1_500_000;
export const AGENT_IMAGE_LOSSLESS_QUALITY = 1;
export const AGENT_IMAGE_QUALITY_LADDER: ReadonlyArray<number> = [0.92, 0.85, 0.78, 0.68];
export const AGENT_IMAGE_SCALE_LADDER: ReadonlyArray<number> = [1, 0.75, 0.55];

export type AgentImageEncodeMime = "image/png" | "image/webp" | "image/jpeg";

const LOSSLESS_SOURCE_MIMES: ReadonlyArray<string> = ["image/png", "image/gif", "image/webp"];

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

export interface AgentImageOutputPolicy {
  readonly maxBytes: number;
  readonly maxDimension: number;
  readonly acceptedMimes: ReadonlyArray<AgentImageMime>;
  readonly encodeMime: AgentImageEncodeMime;
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
  | { readonly kind: "refused"; readonly reason: AgentImageShrinkRefusal };

export type AgentImageShrinkRefusal = "unreadable" | "too-large" | "oversized";

export async function shrinkAgentImageToFit(
  request: AgentImageShrinkRequest,
  surface: AgentImageSurfacePort,
  policy?: AgentImageOutputPolicy,
): Promise<AgentImageShrinkOutcome> {
  if (request.bytes.byteLength === 0) return refused("unreadable");
  if (request.bytes.byteLength > MAX_AGENT_IMAGE_SOURCE_BYTES) return refused("too-large");
  const decoded = await decodeOrNull(request, surface);
  if (decoded === null) return refused("unreadable");
  try {
    if (!isAgentImageDimension(decoded.width) || !isAgentImageDimension(decoded.height)) {
      return refused(exceedsAgentImageDimensions(decoded) ? "oversized" : "unreadable");
    }
    const limits = modelImageLimits(policy);
    if (
      request.bytes.byteLength <= limits.maxBytes &&
      isAgentImageMime(request.mime) &&
      limits.acceptedMimes.includes(request.mime) &&
      decoded.width <= limits.maxEdge &&
      decoded.height <= limits.maxEdge
    ) {
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
    return await reencodeAgentImage(request, decoded, surface, limits, policy);
  } finally {
    surface.release(decoded);
  }
}

export function agentShrunkAttachmentName(name: string, mime: AgentImageEncodeMime): string {
  const extension = encodedExtension(mime);
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

interface ModelImageLimits {
  readonly maxBytes: number;
  readonly maxEdge: number;
  readonly acceptedMimes: ReadonlyArray<AgentImageMime>;
}

interface EncodePass {
  readonly width: number;
  readonly height: number;
  readonly mime: AgentImageEncodeMime;
  readonly quality: number;
  readonly maxBytes: number;
}

function modelImageLimits(policy?: AgentImageOutputPolicy): ModelImageLimits {
  return {
    maxBytes: Math.min(
      AGENT_IMAGE_MAX_MODEL_BYTES,
      policy?.maxBytes ?? AGENT_IMAGE_MAX_MODEL_BYTES,
    ),
    maxEdge: Math.min(AGENT_IMAGE_MAX_EDGE, policy?.maxDimension ?? AGENT_IMAGE_MAX_EDGE),
    acceptedMimes: policy?.acceptedMimes ?? AGENT_IMAGE_MIMES,
  };
}

async function reencodeAgentImage(
  request: AgentImageShrinkRequest,
  decoded: AgentImageSource,
  surface: AgentImageSurfacePort,
  limits: ModelImageLimits,
  policy?: AgentImageOutputPolicy,
): Promise<AgentImageShrinkOutcome> {
  const encodeMime = policy?.encodeMime ?? (await encodeMimeOrNull(surface));
  if (encodeMime === null) return refused("unreadable");
  const base = agentImageFitBox(decoded.width, decoded.height, limits.maxEdge);
  let encoded = false;
  for (const pass of encodePasses(request.mime, base, encodeMime, limits)) {
    const bytes = await encodeOrNull(surface, decoded, pass);
    if (bytes === null) continue;
    encoded = true;
    if (bytes.byteLength === 0 || bytes.byteLength > pass.maxBytes) continue;
    return {
      kind: "ready",
      name: agentShrunkAttachmentName(request.name, pass.mime),
      mime: pass.mime,
      bytes,
      width: pass.width,
      height: pass.height,
      reencoded: true,
    };
  }
  return refused(encoded ? "too-large" : "unreadable");
}

function encodePasses(
  sourceMime: string,
  base: { readonly width: number; readonly height: number },
  lossyMime: AgentImageEncodeMime,
  limits: ModelImageLimits,
): ReadonlyArray<EncodePass> {
  const lossless: EncodePass[] =
    LOSSLESS_SOURCE_MIMES.includes(sourceMime) && limits.acceptedMimes.includes("image/png")
      ? [
          {
            ...base,
            mime: "image/png",
            quality: AGENT_IMAGE_LOSSLESS_QUALITY,
            maxBytes: Math.min(limits.maxBytes, AGENT_IMAGE_LOSSLESS_MAX_BYTES),
          },
        ]
      : [];
  const lossy = AGENT_IMAGE_SCALE_LADDER.flatMap((scale) =>
    AGENT_IMAGE_QUALITY_LADDER.map((quality) => ({
      width: scaledEdge(base.width, scale),
      height: scaledEdge(base.height, scale),
      mime: lossyMime,
      quality,
      maxBytes: limits.maxBytes,
    })),
  );
  return [...lossless, ...lossy];
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
  pass: EncodePass,
): Promise<ArrayBuffer | null> {
  try {
    return await surface.encode(source, pass.width, pass.height, pass.mime, pass.quality);
  } catch {
    return null;
  }
}

function encodedExtension(mime: AgentImageEncodeMime): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/jpeg":
      return "jpg";
    default:
      return unsupportedEncodeMime(mime);
  }
}

function unsupportedEncodeMime(mime: never): never {
  throw new TypeError(`Unsupported agent image encode mime: ${String(mime)}.`);
}

function scaledEdge(edge: number, ratio: number): number {
  return Math.max(1, Math.round(edge * ratio));
}

function exceedsAgentImageDimensions(decoded: AgentImageSource): boolean {
  return decoded.width > MAX_AGENT_IMAGE_DIMENSION || decoded.height > MAX_AGENT_IMAGE_DIMENSION;
}

function refused(reason: AgentImageShrinkRefusal): AgentImageShrinkOutcome {
  return { kind: "refused", reason };
}
