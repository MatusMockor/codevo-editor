import type { MouseEvent } from "react";
import {
  isSafeExternalMarkdownUrl,
  type MarkdownPreviewTab,
} from "../domain/markdownPreview";

interface MarkdownPreviewProps {
  openExternal?: (url: string) => Promise<void>;
  preview: MarkdownPreviewTab;
}

export function MarkdownPreview({
  openExternal = openExternalUrl,
  preview,
}: MarkdownPreviewProps) {
  function handleClick(event: MouseEvent<HTMLElement>) {
    const target = event.target;

    if (!(target instanceof Element)) {
      return;
    }

    const link = target.closest<HTMLAnchorElement>("a[href]");

    if (!link) {
      return;
    }

    event.preventDefault();
    const href = link.getAttribute("href");

    if (!href || !isSafeExternalMarkdownUrl(href)) {
      return;
    }

    void openExternal(href);
  }

  return (
    <section
      aria-label={`Markdown preview: ${preview.name}`}
      className="markdown-preview"
      onAuxClick={handleClick}
      onClick={handleClick}
    >
      <article
        className="markdown-preview-content"
        dangerouslySetInnerHTML={{ __html: preview.html }}
      />
    </section>
  );
}

async function openExternalUrl(url: string): Promise<void> {
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}
