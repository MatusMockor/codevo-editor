import { useState } from "react";
import type { ImageTab } from "../domain/workspace";

interface ImageViewerProps {
  image: ImageTab;
  naturalWidth?: number;
  naturalHeight?: number;
}

export function ImageViewer({
  image,
  naturalWidth,
  naturalHeight,
}: ImageViewerProps) {
  const [dimensions, setDimensions] = useState(() =>
    naturalWidth && naturalHeight
      ? { width: naturalWidth, height: naturalHeight }
      : null,
  );

  return (
    <section className="image-viewer" aria-label={`Image viewer: ${image.name}`}>
      <div className="image-viewer-canvas">
        <img
          alt={image.name}
          className="image-viewer-image"
          onLoad={(event) => {
            setDimensions({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            });
          }}
          src={image.dataUrl}
        />
      </div>
      <footer className="image-viewer-footer">
        <span>{dimensions ? `${dimensions.width} × ${dimensions.height}` : "Loading dimensions…"}</span>
        <span>{formatByteLength(image.byteLength)}</span>
      </footer>
    </section>
  );
}

function formatByteLength(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${formatUnit(bytes / 1024)} KiB`;
  }
  return `${formatUnit(bytes / (1024 * 1024))} MiB`;
}

function formatUnit(value: number): string {
  return value >= 10 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "");
}
