import type {
  AgentImageEncodeMime,
  AgentImageSource,
  AgentImageSurfacePort,
} from "../domain/agentImageShrink";

const WHITE_MATTE = "#ffffff";

export class WebviewAgentImageSurface implements AgentImageSurfacePort {
  private encodeMimePromise: Promise<AgentImageEncodeMime> | null = null;

  async decode(bytes: ArrayBuffer, mime: string): Promise<AgentImageSource> {
    return createImageBitmap(new Blob([bytes], { type: mime }));
  }

  encodeMime(): Promise<AgentImageEncodeMime> {
    this.encodeMimePromise ??= probeEncodeMime();
    return this.encodeMimePromise;
  }

  async encode(
    source: AgentImageSource,
    width: number,
    height: number,
    mime: AgentImageEncodeMime,
    quality: number,
  ): Promise<ArrayBuffer> {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("The image canvas context is unavailable.");
    if (mime === "image/jpeg") {
      context.fillStyle = WHITE_MATTE;
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(asCanvasImageSource(source), 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: mime, quality });
    if (blob.type !== mime) throw new Error(`The image encoder refused ${mime}.`);
    return blob.arrayBuffer();
  }

  release(source: AgentImageSource): void {
    if (source instanceof ImageBitmap) source.close();
  }
}

async function probeEncodeMime(): Promise<AgentImageEncodeMime> {
  try {
    const probe = new OffscreenCanvas(1, 1);
    const blob = await probe.convertToBlob({ type: "image/webp", quality: 0.92 });
    if (blob.type === "image/webp") return "image/webp";
  } catch {
    return "image/jpeg";
  }
  return "image/jpeg";
}

function asCanvasImageSource(source: AgentImageSource): CanvasImageSource {
  if (source instanceof ImageBitmap) return source;
  throw new Error("The decoded image is not drawable.");
}
